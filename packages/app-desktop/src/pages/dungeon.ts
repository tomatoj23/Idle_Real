/**
 * 秘境页（#7，#46 页面注册表）：层进度 + 当前层战斗 + 撤退；未在攻略 = 秘境列表。
 *
 * 页框零件消费：交战敌卡（件5，与斗法页同框）、门锁句（件4）；
 * 敌血条实况刷新住本页 update（D3）。
 */
import { dungeonGateOf, dungeonLayerOf, findDungeon, powerOf, powerParamsOf } from '@wendao/engine';
import {
  bossDecoOf,
  consumablesHtml,
  dungeonLockMsgOf,
  esc,
  fightingEnemyCardHtml,
  minionsHtml,
  pctClamped,
  refreshEnemyBar,
  selfStatsTextOf,
} from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createDungeonPage(env: PageEnv): PageView {
  const render = (ctx: PageCtx): string => {
    const { st, snap, content, T } = ctx;
    const dungeons = env.dungeonList;
    if (dungeons.length === 0) {
      return `<section class="page"><p class="empty">${esc(T('pages.dungeon.empty'))}</p></section>`;
    }
    const run = st.dungeon;
    if (run) {
      const dungeon = findDungeon(content, run.dungeonId);
      if (!dungeon) {
        return `<section class="page"><p class="empty">${esc(T('pages.dungeon.empty'))}</p></section>`;
      }
      // 当前层敌人 = 引擎快照投影（#40：秘境层倍率 × Boss 阶段修正，零壳层组合）。
      const enemy = snap.enemy;
      const deco = bossDecoOf(content, st);
      const ehpPct = enemy && st.combat ? pctClamped(st.combat.ehp, enemy.hp) : 0;
      const hpPct = pctClamped(st.hp, snap.stats?.maxHp ?? 1);
      const best = st.dungeonBest[dungeon.id] ?? 0;
      const rec = dungeonLayerOf(dungeon, run.floor)?.recommendedPower;
      // 战力 = 引擎单一来源合成（config.power 参数现读内容包，#61 边界收口：
      // 包改权重 → 壳层读数与层表 recommendedPower 同步换量纲，禁壳内另写公式）。
      const power = snap.stats ? powerOf(snap.stats, powerParamsOf(content)) : 0;
      const consumables = consumablesHtml(content, st);
      return `
        <section class="page">
          <h2 class="page-title">${esc(T('pages.dungeon.title'))}</h2>
          <p class="page-sub">${esc(T('pages.dungeon.floorNow', { floor: run.floor, floors: dungeon.floors }))} · ${esc(T('pages.dungeon.best', { best }))}</p>
          ${fightingEnemyCardHtml({
            T,
            icon: enemy?.icon ?? T('icons.unknown'),
            name: enemy?.name ?? '',
            level: enemy?.level ?? 0,
            headBadges: deco.badge,
            decoTicks: deco.ticks,
            ehpPct,
            ehpText: T('pages.combat.enemyHp', { ehp: st.combat ? Math.max(0, Math.ceil(st.combat.ehp)) : 0, hp: enemy?.hp ?? 0 }),
            minions: minionsHtml(T, snap),
            hpPct,
            selfStatsText: selfStatsTextOf(T, env.statValueText, st, snap),
            opsHtml: `<button class="btn btn-ghost" data-act="dungeon-leave">${esc(T('pages.dungeon.retreatBtn'))}</button>`,
          })}
          ${rec ? `<p class="page-sub">${esc(T('pages.dungeon.powerNow', { power }))} · ${esc(T('pages.dungeon.powerRec', { min: rec.min, max: rec.max }))}</p>` : ''}
          ${consumables ? `<div class="consumable-bar">${consumables}</div>` : `<p class="page-sub">${esc(T('pages.combat.noConsumables'))}</p>`}
          <div class="flog" id="flog"></div>
        </section>`;
    }
    const cards = dungeons
      .map((dungeon) => {
        const gate = dungeonGateOf(content, dungeon.id, { daoYunEarned: st.daoYunEarned, items: st.items });
        const best = st.dungeonBest[dungeon.id] ?? 0;
        const cleared = best >= dungeon.floors;
        return `<article class="enemy-card${gate.locked ? ' locked' : ''}">
          <div class="enemy-face"><span class="sigil sigil-big">${esc(dungeon.icon ?? T('icons.unknown'))}</span></div>
          <div class="enemy-main">
            <div class="enemy-head"><b>${esc(dungeon.name)}</b><span class="enemy-lv">${esc(T('units.level', { v: dungeon.floors }))}</span>${cleared ? `<em class="act-badge">${esc(T('pages.dungeon.clearBadge'))}</em>` : ''}</div>
            <div class="enemy-sub">${esc(T('pages.dungeon.best', { best }))}</div>
          </div>
          <div class="enemy-ops">
            ${
              gate.locked
                ? `<span class="act-lockmsg">${esc(dungeonLockMsgOf(T, content, st, dungeon.id))}</span>`
                : `<button class="btn" data-act="dungeon-enter" data-dungeon="${dungeon.id}">${esc(T('pages.dungeon.enterBtn'))}</button>`
            }
          </div>
        </article>`;
      })
      .join('');
    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.dungeon.title'))}</h2>
        <p class="page-sub">${esc(T('pages.dungeon.subtitle'))}</p>
        <div class="enemy-grid">${cards}</div>
      </section>`;
  };

  const update = (ctx: PageCtx): void => {
    // 敌方血条实况刷新 = 页框共用体单一实现（D3；本页拥有 update 入口）。
    refreshEnemyBar(env.pageEl, ctx.st, ctx.snap);
  };

  return {
    id: 'dungeon',
    label: 'tabs.dungeon',
    render,
    update,
    handleAction(action, target) {
      switch (action) {
        case 'dungeon-enter':
          // 入门即切到秘境页（斗法页/秘境页共用动作：入门 + 看层进度）。
          env.dispatch({ type: 'dungeon:enter', payload: { dungeonId: target.dataset.dungeon } });
          env.nav('dungeon');
          return;
        case 'dungeon-leave':
          env.dispatch({ type: 'dungeon:leave' });
          return;
        case 'eat':
          env.dispatch({ type: 'consumable:eat', payload: { item: target.dataset.item } });
          return;
      }
    },
  };
}
