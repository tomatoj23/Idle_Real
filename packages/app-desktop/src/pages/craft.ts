/**
 * 炼制页（#5，#46 页面注册表）：配方卡 = 材料着色 + 成功率 + 进度条。
 *
 * 页框零件消费与修炼页同框（statusCard/act 卡/xp 头+chips/锁定句/activity-pct）；
 * 实况刷新（配方进度条）住本页 update（D3）。
 */
import { craftMissingOf, craftSuccessRateOf, levelFromXp, rebirthGateOf } from '@wendao/engine';
import type { RecipeView } from '@wendao/engine';
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
import type { PageCtx, PageEnv, PageView } from './types';

export function createCraftPage(env: PageEnv): PageView {
  let selectedCraftSkillId = env.craftSkills[0]?.id ?? '';

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
        const pct = running && act ? actPctOf(act.progress, recipe.interval) : 0;
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
          op: unlocked
            ? running
              ? actStopBtnHtml(T('pages.craft.stopBtn'))
              : actStartBtnHtml(skill.id, index, T('pages.craft.startBtn'))
            : actLockHtml(lockMsg),
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
      }
    },
  };
}
