/**
 * 修炼页（#46 页面注册表）：技能 chip + 状态卡 + 活动卡网格。
 *
 * 页框零件消费：statusCard（件1）、act 卡（件2）、xp 头+chips（件3）、
 * 双门锁定句（件4）、activity-pct（件6）；活动进度条实况刷新住本页 update（D3）。
 * 删除本文件 = 修炼整页消失（含实况刷新与 chip 动作）。
 */
import { levelFromXp, rebirthGateOf, realmOf } from '@wendao/engine';
import {
  actBarHtml,
  actCardHtml,
  actKeyOf,
  actLockHtml,
  actPctOf,
  actStartBtnHtml,
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

export function createSkillsPage(env: PageEnv): PageView {
  let selectedSkillId = env.gatherSkills[0]?.id ?? '';

  const render = (ctx: PageCtx): string => {
    const { st, snap, content, T } = ctx;
    const skill = content.skills.find((s) => s.id === selectedSkillId) ?? env.gatherSkills[0];
    if (!skill) return `<section class="page"><p class="empty">${esc(T('pages.skills.empty'))}</p></section>`;

    const read = xpReadOf(st.skills[skill.id]?.xp ?? 0, env.prog);

    // 主页境界区（#6 + B2 词表收编）：境界词表归 content.rebirth.realms，
    // 引擎 realmOf 查表单一来源；包无词表时整行不渲染（零降级路径）。
    const clv = levelFromXp(st.skills[env.combatSkillId]?.xp ?? 0, env.prog);
    const realm = realmOf(content, clv);
    const realmHtml =
      realm !== undefined
        ? `<div class="status-realm">${esc(T('pages.skills.realmLine', { realm, rebirths: st.rebirths }))}</div>`
        : '';

    const act = st.activity;
    const actSkill = act ? content.skills.find((s) => s.id === act.skillId) : undefined;
    const actDef = act ? actSkill?.activities?.[act.index] : undefined;
    // 有效间隔单一来源 = 引擎快照映射（#40：gatherSpeed 缩放后与结算同调）。
    const actInterval = act ? snap.activityIntervals?.[actKeyOf(act)] : undefined;
    const actPct = actPctOf(act?.progress ?? 0, actInterval);

    const chips = content.skills
      .filter((s) => s.kind !== 'craft')
      .map((s) => {
        // 修炼页只放 gather 技能（+combat 修为参照）：craft 技能导航归炼制页
        // 专属（UX 调整）——craft 在本页无活动卡无开工入口，纯 chip 属重复导航。
        const locked = s.kind === 'combat';
        return skillChipHtml({
          T,
          id: s.id,
          icon: s.icon,
          name: s.name,
          level: levelFromXp(st.skills[s.id]?.xp ?? 0, env.prog),
          selected: s.id === skill.id,
          action: 'skill',
          locked,
          lockText: T('pages.skills.chipLocked'),
        });
      })
      .join('');

    const statusCard = statusCardHtml({
      T,
      icon: skill.icon,
      name: skill.name,
      level: read.level,
      desc: skill.description,
      realmHtml,
      expPct: read.pct,
      expSub: xpSubTextOf(T, 'pages.skills', read),
      actHtml: statusActHtml({
        running:
          act && actDef
            ? {
                label: T('pages.skills.actNow', { name: actDef.name }),
                key: actKeyOf(act),
                pct: actPct,
                stopLabel: T('pages.skills.stopBtn'),
              }
            : null,
        idleText: T('pages.skills.idle'),
      }),
    });

    const cards = (skill.activities ?? [])
      .map((a, i) => {
        // 解锁双重门控（#6）：层数门槛 + 道韵解锁表（rebirthGateOf 同源）。
        const yunGate = rebirthGateOf(content, st.daoYunEarned, { skillId: skill.id });
        const unlocked = read.level >= a.unlockLevel && !yunGate.locked;
        const lockMsg = levelLockMsgOf(T, yunGate, a.unlockLevel);
        const running = act?.skillId === skill.id && act.index === i;
        const out = env.itemById.get(a.output.item);
        const bonus = a.byproduct ? env.itemById.get(a.byproduct.item) : undefined;
        // 卡片进度条同读引擎快照映射（#40：基础 interval 复算清退——天赋点亮后速率同步）。
        const runInterval = running && act ? snap.activityIntervals?.[actKeyOf(act)] : undefined;
        const pct = running && act ? actPctOf(act.progress, runInterval) : 0;
        return actCardHtml({
          title: a.name,
          running,
          locked: !unlocked,
          runningBadge: T('pages.skills.running'),
          body: `${actYieldHtml({
            icon: out?.icon ?? T('icons.unknown'),
            name: out?.name ?? a.output.item,
            count: a.output.count,
            bonusHtml: a.byproduct
              ? `<span class="act-bonus">${esc(T('pages.skills.byproduct', { icon: bonus?.icon ?? T('icons.unknown'), name: bonus?.name ?? a.byproduct.item, chance: Math.round(a.byproduct.chance * 100) }))}</span>`
              : '',
          })}
          <div class="act-meta">${esc(T('pages.skills.actMeta', { interval: env.fmtSeconds(a.interval), exp: a.exp, level: a.unlockLevel }))}</div>
          ${actBarHtml(actKeyOf({ skillId: skill.id, index: i }), pct)}`,
          op: unlocked
            ? running
              ? ''
              : actStartBtnHtml(skill.id, i, T('pages.skills.startBtn'))
            : actLockHtml(lockMsg),
        });
      })
      .join('');

    return `
      <section class="page">
        <div class="chips">${chips}</div>
        ${statusCard}
        ${cards ? `<div class="act-grid">${cards}</div>` : ''}
      </section>`;
  };

  const update = (ctx: PageCtx): void => {
    // 实况刷新 = 页框共用体单一实现（D3；本页拥有 update 入口）。
    refreshActivityBars(env.pageEl, ctx.st, ctx.snap);
  };

  return {
    id: 'skills',
    label: 'tabs.skills',
    render,
    update,
    handleAction(action, target) {
      switch (action) {
        case 'skill': {
          if (target.dataset.disabled === 'y') return;
          selectedSkillId = target.dataset.skill ?? selectedSkillId;
          env.render();
          return;
        }
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
