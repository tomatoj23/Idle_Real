/**
 * 炼制页（#5，#46 页面注册表）：配方卡 = 材料着色 + 成功率 + 进度条。
 *
 * 页框零件消费与修炼页同框（statusCard/act 卡/xp 头+chips/锁定句/activity-pct）；
 * 实况刷新（配方进度条）住本页 update（D3）。
 */
import { craftMissingOf, craftSuccessRateOf, levelFromXp, rebirthGateOf } from '@wendao/engine';
import type { GameState, RecipeView } from '@wendao/engine';
import {
  actBarHtml,
  actCardHtml,
  actKeyOf,
  actLockHtml,
  actPctOf,
  actStartBtnHtml,
  actStopBtnHtml,
  actYieldHtml,
  esc,
  levelLockMsgOf,
  refreshActivityBars,
  skillChipHtml,
  statusActHtml,
  statusCardHtml,
  xpReadOf,
  xpSubTextOf,
} from '../pageFrame';
import type { PageCtx, PageEnv, PageView, ShellText } from './types';

export function createCraftPage(env: PageEnv): PageView {
  let selectedCraftSkillId = env.craftSkills[0]?.id ?? '';

  /**
   * 配方自动化控件行（#35）：三态单选（不处理/自动售卖/自动熔炼，互斥）+
   * 稀有度阈值（≤所选档）。两态退化：丹药/材料配方（产出无稀有度）不渲染
   * 熔炼项与阈值项；无器屑经济的包（canSmelt=false）不渲染熔炼项。
   * 注入存量的不可选态（无器屑包的熔炼规则/普通产出的熔炼规则）保留选中态
   * 展示（disabled 选项），防选择器静默换态谎报。
   */
  const autoRowHtml = (st: Readonly<GameState>, index: number, isGear: boolean, T: ShellText): string => {
    const rule = st.recipeAuto[String(index)];
    const mode = rule?.mode ?? 'none';
    const rarities = env.content.rarities;
    const smeltPickable = isGear && env.canSmelt;
    const options = [
      `<option value="none"${mode === 'none' ? ' selected' : ''}>${esc(T('pages.craft.autoNone'))}</option>`,
      `<option value="sell"${mode === 'sell' ? ' selected' : ''}>${esc(T('pages.craft.autoSell'))}</option>`,
    ];
    if (smeltPickable || mode === 'smelt') {
      options.push(
        `<option value="smelt"${mode === 'smelt' ? ' selected' : ''}${smeltPickable ? '' : ' disabled'}>${esc(T('pages.craft.autoSmelt'))}</option>`,
      );
    }
    const cap0 = rarities[0]?.id ?? '';
    const parts = [
      `<select class="auto-mode" data-act="autorule" data-index="${index}">${options.join('')}</select>`,
    ];
    if (isGear && mode !== 'none') {
      const cap = rule?.maxRarity ?? cap0;
      const capOptions = rarities
        .map(
          (r) =>
            `<option value="${esc(r.id)}"${r.id === cap ? ' selected' : ''}>${esc(T('pages.craft.autoCap', { rarity: r.name }))}</option>`,
        )
        .join('');
      parts.push(`<select class="auto-cap" data-act="autorule" data-index="${index}">${capOptions}</select>`);
    }
    return `<div class="craft-auto">${parts.join('')}</div>`;
  };

  const render = (ctx: PageCtx): string => {
    const { st, snap, content, T } = ctx;
    if (env.craftSkills.length === 0 || content.recipes.length === 0) {
      return `<section class="page"><p class="empty">${esc(T('pages.craft.empty'))}</p></section>`;
    }
    const skill = env.craftSkills.find((s) => s.id === selectedCraftSkillId) ?? env.craftSkills[0]!;
    const read = xpReadOf(st.skills[skill.id]?.xp ?? 0, env.prog);

    const act = st.activity;
    const runningHere = act?.skillId === skill.id;
    // 有效间隔单一来源 = 引擎快照映射（#40；craft 动作 = 配方原值）。
    const actInterval = act ? snap.activityIntervals?.[actKeyOf(act)] : undefined;
    const actPct = actPctOf(act?.progress ?? 0, actInterval);

    const chips = env.craftSkills
      .map((s) =>
        skillChipHtml({
          T,
          id: s.id,
          icon: s.icon,
          name: s.name,
          level: levelFromXp(st.skills[s.id]?.xp ?? 0, env.prog),
          selected: s.id === skill.id,
          action: 'craftskill',
        }),
      )
      .join('');

    const statusCard = statusCardHtml({
      T,
      icon: skill.icon,
      name: skill.name,
      level: read.level,
      desc: skill.description,
      expPct: read.pct,
      expSub: xpSubTextOf(T, 'pages.craft', read),
      actHtml: statusActHtml({
        running:
          act && runningHere
            ? {
                label: T('pages.craft.actNow', { name: act.name }),
                key: actKeyOf(act),
                pct: actPct,
                stopLabel: T('pages.craft.stopBtn'),
              }
            : null,
        idleText: T('pages.craft.idle'),
      }),
    });

    const cards = content.recipes
      .map((recipe: RecipeView, index: number) => ({ recipe, index }))
      .filter(({ recipe }) => recipe.skill === skill.id)
      .map(({ recipe, index }) => {
        // 解锁双重门控（#6）：层数门槛 + 道韵解锁表（rebirthGateOf 同源）。
        const yunGate = rebirthGateOf(content, st.daoYunEarned, { skillId: skill.id });
        const unlocked = read.level >= recipe.unlockLevel && !yunGate.locked;
        const lockMsg = levelLockMsgOf(T, yunGate, recipe.unlockLevel);
        const running = runningHere && act?.index === index;
        const out = env.itemById.get(recipe.output.item);
        // 成功率/材料缺口走引擎单一来源（craftSuccessRateOf / craftMissingOf），
        // 壳零公式复算（#5 票评：成功率展示禁二次硬编码，round3 A4）。
        const rate = craftSuccessRateOf(content, st.skills, recipe);
        const ratePct = String(Math.round(rate * 1000) / 10);
        const missing = new Set(craftMissingOf(recipe, st.items));
        const mats = Object.entries(recipe.materials)
          .map(([id, matNeed]) => {
            const mat = env.itemById.get(id);
            const have = st.items[id] ?? 0;
            return `<span class="mat${missing.has(id) ? ' no' : ' ok'}">${esc(mat?.icon ?? T('icons.unknown'))} ${esc(T('pages.craft.matRow', { name: mat?.name ?? id, have, need: matNeed }))}</span>`;
          })
          .join('');
        // 有效间隔单一来源 = 引擎快照映射（#40 口径：基础 interval 复算清退）。
        // 本行曾直读 recipe.interval 与补丁侧（refreshActivityBars）双源——
        // 炼制 interval 一旦被缩放即首帧跳变，#50 复核收口收敛与修炼卡同式。
        const runInterval = running && act ? snap.activityIntervals?.[actKeyOf(act)] : undefined;
        const pct = running && act ? actPctOf(act.progress, runInterval) : 0;
        return actCardHtml({
          title: recipe.name,
          running,
          locked: !unlocked,
          runningBadge: T('pages.craft.running'),
          body: `${actYieldHtml({
            icon: out?.icon ?? T('icons.unknown'),
            name: out?.name ?? recipe.output.item,
            count: recipe.output.count,
            bonusHtml: `<span class="act-bonus">${esc(T('pages.craft.successRate', { rate: ratePct }))}</span>`,
          })}
          <div class="craft-mats">${mats}</div>
          <div class="act-meta">${esc(T('pages.craft.recipeMeta', { interval: env.fmtSeconds(recipe.interval), exp: recipe.exp, level: recipe.unlockLevel }))}</div>
          ${actBarHtml(actKeyOf({ skillId: skill.id, index }), pct)}`,
          op: `<div class="act-op">${
            unlocked
              ? running
                ? actStopBtnHtml(T('pages.craft.stopBtn'))
                : actStartBtnHtml(skill.id, index, T('pages.craft.startBtn'))
              : actLockHtml(lockMsg)
          }${autoRowHtml(st, index, out?.type === 'equip', T)}</div>`,
        });
      })
      .join('');

    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.craft.title'))}</h2>
        <p class="page-sub">${esc(T('pages.craft.subtitle', { level: read.level }))}</p>
        <div class="chips">${chips}</div>
        ${statusCard}
        <div class="act-grid">${cards || `<p class="empty">${esc(T('pages.craft.empty'))}</p>`}</div>
      </section>`;
  };

  const update = (ctx: PageCtx): void => {
    // 实况刷新 = 页框共用体单一实现（D3；本页拥有 update 入口）。
    refreshActivityBars(env.pageEl, ctx.st, ctx.snap);
  };

  return {
    id: 'craft',
    label: 'tabs.craft',
    render,
    update,
    handleAction(action, target) {
      switch (action) {
        case 'craftskill':
          selectedCraftSkillId = target.dataset.skill ?? selectedCraftSkillId;
          env.render();
          return;
        case 'start':
          env.dispatch({
            type: 'activity:start',
            payload: { skillId: target.dataset.skill, index: Number(target.dataset.index) },
          });
          return;
        case 'stop':
          env.dispatch({ type: 'activity:stop' });
          return;
        case 'autorule': {
          // 配方自动化规则派发（#35）：三态单选/阈值共用本动作，整条规则重写
          //（互斥单选 = 单字段覆盖）。装备产出必带阈值（首启默认最低档 = 只折
          // 寻常，高品绝不误折）；普通产出无阈值语义不带。
          const box = target.closest<HTMLElement>('.craft-auto');
          const mode = box?.querySelector<HTMLSelectElement>('.auto-mode')?.value;
          if (mode !== 'none' && mode !== 'sell' && mode !== 'smelt') return;
          const index = Number(target.dataset.index);
          const recipe = env.content.recipes[index];
          const isGear = recipe !== undefined && env.itemById.get(recipe.output.item)?.type === 'equip';
          const capEl = box?.querySelector<HTMLSelectElement>('.auto-cap');
          // 阈值缺选 = 最低档（rarities 数组序首项）；存在性由引擎守卫把关。
          const maxRarity = capEl?.value || env.content.rarities[0]?.id || undefined;
          env.dispatch({
            type: 'craft:auto',
            payload: {
              index,
              mode,
              ...(mode !== 'none' && isGear && maxRarity !== undefined ? { maxRarity } : {}),
            },
          });
          env.render();
          return;
        }
      }
    },
  };
}
