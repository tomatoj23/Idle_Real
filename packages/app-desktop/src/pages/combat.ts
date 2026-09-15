/**
 * 斗法页（issue #4，#46 页面注册表）：敌人列表/交战信息面/秘境入口/指向页。
 *
 * 页框零件消费：交战敌卡（件5：bossDeco/minions/selfStats 同框）、
 * 双门锁定句（件4）、xp 头（件3）；敌血条实况刷新住本页 update（D3）。
 * 战斗日志容器（#flog）由本页渲染，内容重放归壳核（日志缓冲是壳层事件接线）。
 */
import {
  dungeonGateOf,
  enemyGateOf,
  findDungeon,
  levelFromXp,
  rebirthGateOf,
} from '@wendao/engine';
import {
  bossDecoOf,
  consumablesHtml,
  dungeonLockMsgOf,
  esc,
  fightingEnemyCardHtml,
  levelLockMsgOf,
  minionsHtml,
  pctClamped,
  refreshEnemyBar,
  selfStatsTextOf,
  xpReadOf,
} from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createCombatPage(env: PageEnv): PageView {
  const render = (ctx: PageCtx): string => {
    const { st, snap, content, T } = ctx;
    const combat = st.combat;
    // N2 修复（#018）：斗法修为读数按 combatSkillId 解析，禁硬编码内容 id。
    const clv = levelFromXp(st.skills[env.combatSkillId]?.xp ?? 0, env.prog);
    const sep = T('common.itemListSep');
    const consumables = consumablesHtml(content, st);

    // 秘境进行中（#7）：层序列战斗在身，野战一律拒绝——斗法页改为指向页。
    if (st.dungeon) {
      const runDungeon = findDungeon(content, st.dungeon.dungeonId);
      return `
        <section class="page">
          <h2 class="page-title">${esc(T('pages.combat.title'))}</h2>
          <p class="page-sub">${esc(T('pages.combat.subtitle', { level: clv }))}</p>
          <p class="page-sub">${esc(T('pages.dungeon.floorNow', { floor: st.dungeon.floor, floors: runDungeon?.floors ?? 0 }))}</p>
          <button class="btn" data-act="tab" data-tab="dungeon">${esc(T('tabs.dungeon'))}</button>
          <div class="consumable-bar">${consumables || ''}</div>
        </section>`;
    }

    /** 敌人卡列表：列表视图与战斗中信息面共用。engagedId = 当前目标——徽标化且
     *  不渲染挑战按钮（换敌 = 引擎 combat:start 幂等替换语义，点其他怪即切换，
     *  战斗不中断；点当前怪引擎幂等拒绝，UI 直接收掉入口）。 */
    const enemyCardsHtml = (engagedId?: string): string =>
      content.enemies
      .map((enemy) => {
        // 开战门控走引擎 enemyGateOf（N1 收敛，#020）：锁定判定与 UI 锁定态
        // 共用 enemyGateOf 同一实现，UI 零公式复算。
        const levelGate = enemyGateOf(content, st.skills, enemy.id);
        // 道韵解锁门槛（#6）：开战判定与 UI 锁定态同源 rebirthGateOf（N1 同款收敛）。
        const yunGate = rebirthGateOf(content, st.daoYunEarned, { enemyId: enemy.id });
        const locked = levelGate.locked || yunGate.locked;
        const lockMsg = levelLockMsgOf(T, yunGate, levelGate.requiredLevel);
        const gold = enemy.gold ?? { min: 0, max: 0 };
        const drops = (enemy.drops ?? [])
          .map((drop) => env.itemById.get(drop.item)?.name ?? drop.item)
          .slice(0, 3)
          .join(sep);
        return `<article class="enemy-card${locked ? ' locked' : ''}${enemy.id === engagedId ? ' running' : ''}">
          <div class="enemy-face"><span class="sigil sigil-big">${esc(enemy.icon)}</span></div>
          <div class="enemy-main">
            <div class="enemy-head"><b>${esc(enemy.name)}</b><span class="enemy-lv">${esc(T('units.level', { v: enemy.level }))}</span></div>
            <div class="enemy-sub">${esc(T('pages.combat.enemyStats', { hp: enemy.hp, atk: enemy.atk, def: enemy.def, exp: enemy.exp }))}</div>
            <div class="enemy-sub">${esc(T('pages.combat.enemyGold', { min: gold.min, max: gold.max }))}${drops ? esc(T('pages.combat.dropsSuffix', { drops })) : ''}</div>
          </div>
          <div class="enemy-ops">
            ${
              enemy.id === engagedId
                ? `<em class="act-badge">${esc(T('pages.combat.engagedBadge'))}</em>`
                : locked
                ? `<span class="act-lockmsg">${esc(lockMsg)}</span>`
                : `<button class="btn" data-act="fight" data-enemy="${enemy.id}">${esc(T('pages.combat.fightBtn'))}</button>`
            }
          </div>
        </article>`;
      })
      .join('');

    const toggles = `
      <div class="combat-toggles">
        <button class="btn btn-ghost${st.autoFight ? ' on' : ''}" data-act="toggle-auto">${esc(T(st.autoFight ? 'pages.combat.autoFightOn' : 'pages.combat.autoFightOff'))}</button>
        <button class="btn btn-ghost${st.autoEat ? ' on' : ''}" data-act="toggle-auto-eat">${esc(T(st.autoEat ? 'pages.combat.autoEatOn' : 'pages.combat.autoEatOff'))}</button>
      </div>`;

    if (combat) {
      // 生效视图 = 引擎快照投影（#40：Boss 阶段修正在案时随阶段变化，零壳层组合）。
      const enemy = snap.enemy;
      if (!enemy) return `<section class="page"><p class="empty">${esc(T('pages.combat.enemyMissing'))}</p></section>`;
      const deco = bossDecoOf(content, st);
      const ehpPct = pctClamped(combat.ehp, enemy.hp);
      const resting = combat.respT > 0;
      const hpPct = pctClamped(st.hp, snap.stats?.maxHp ?? enemy.hp);
      // 斗法修为条（战斗中信息面）：读数与修炼页同式同源（expToNext/expBase）。
      const cread = xpReadOf(st.skills[env.combatSkillId]?.xp ?? 0, env.prog);
      return `
        <section class="page">
          <h2 class="page-title">${esc(T('pages.combat.title'))}</h2>
          ${fightingEnemyCardHtml({
            T,
            icon: enemy.icon,
            name: enemy.name,
            level: enemy.level,
            headBadges: `${resting ? `<em class="act-badge">${esc(T('pages.combat.resting'))}</em>` : ''}${deco.badge}`,
            decoTicks: deco.ticks,
            ehpPct,
            ehpText: T('pages.combat.enemyHp', { ehp: Math.max(0, Math.ceil(combat.ehp)), hp: enemy.hp }),
            minions: minionsHtml(T, snap),
            hpPct,
            selfStatsText: selfStatsTextOf(T, env.statValueText, st, snap),
            opsHtml: `<button class="btn btn-ghost" data-act="flee">${esc(T('pages.combat.fleeBtn'))}</button>`,
          })}
          <div class="combat-exp">
            <div class="act-now"><span>${esc(T('pages.combat.subtitle', { level: clv }))}</span></div>
            <div class="bar bar-thin"><i style="width:${cread.pct}%"></i></div>
            ${
              Number.isFinite(cread.need)
                ? `<div class="status-sub">${esc(T('pages.combat.expSub', { into: cread.into, need: cread.need, left: Math.max(0, Math.ceil(cread.need - cread.into)) }))}</div>`
                : ''
            }
          </div>
          ${toggles}
          ${consumables ? `<div class="consumable-bar">${consumables}</div>` : `<p class="page-sub">${esc(T('pages.combat.noConsumables'))}</p>`}
          <div class="enemy-grid">${enemyCardsHtml(combat.enemyId)}</div>
          <div class="flog" id="flog"></div>
        </section>`;
    }

    // 秘境入口（#7，票面：入口在斗法页）：入门即切到秘境页；锁定句复用 dungeonLockMsgOf。
    const dungeonEntries =
      env.dungeonList.length > 0
        ? env.dungeonList
            .map((dungeon) => {
              const gate = dungeonGateOf(content, dungeon.id, { daoYunEarned: st.daoYunEarned, items: st.items });
              const best = st.dungeonBest[dungeon.id] ?? 0;
              return `<div class="bag-row">
              <span class="sigil sigil-sm">${esc(dungeon.icon ?? T('icons.unknown'))}</span>
              <span class="bag-name">${esc(dungeon.name)}<small>${esc(T('pages.dungeon.best', { best }))}</small></span>
              <span class="bag-ops">${
                gate.locked
                  ? `<span class="act-lockmsg">${esc(dungeonLockMsgOf(T, content, st, dungeon.id))}</span>`
                  : `<button class="btn" data-act="dungeon-enter" data-dungeon="${dungeon.id}">${esc(T('pages.dungeon.enterBtn'))}</button>`
              }</span>
            </div>`;
            })
            .join('')
        : '';

    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.combat.title'))}</h2>
        <p class="page-sub">${esc(T('pages.combat.subtitle', { level: clv }))}</p>
        ${dungeonEntries}
        <div class="enemy-grid">${enemyCardsHtml()}</div>
        <div class="consumable-bar">${consumables || ''}</div>
      </section>`;
  };

  const update = (ctx: PageCtx): void => {
    // 敌方血条实况刷新 = 页框共用体单一实现（D3；本页拥有 update 入口）。
    refreshEnemyBar(env.pageEl, ctx.st, ctx.snap);
  };

  return {
    id: 'combat',
    label: 'tabs.combat',
    render,
    update,
    handleAction(action, target) {
      switch (action) {
        case 'fight':
          env.dispatch({ type: 'combat:start', payload: { enemyId: target.dataset.enemy } });
          return;
        case 'dungeon-enter':
          // 秘境入口（#7，斗法页/秘境页共用）：入门 + 切到秘境页看层进度。
          env.dispatch({ type: 'dungeon:enter', payload: { dungeonId: target.dataset.dungeon } });
          env.nav('dungeon');
          return;
        case 'flee':
          env.dispatch({ type: 'combat:stop' });
          return;
        case 'toggle-auto':
          env.dispatch({ type: 'combat:auto' });
          return;
        case 'toggle-auto-eat':
          env.dispatch({ type: 'combat:auto-eat' });
          return;
        case 'eat':
          env.dispatch({ type: 'consumable:eat', payload: { item: target.dataset.item } });
          return;
      }
    },
  };
}
