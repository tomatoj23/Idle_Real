import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame, type GameState, type SaveData } from '../src/index.js';
import { CYCLES_60S, makePack } from './fixtures.js';

function stateOf(save: SaveData): GameState {
  return save.state as GameState;
}

describe('挂机采集（issue #3 验收）', () => {
  it('假时钟 60 游戏秒：herb1 +20、silk 副产出、levelup 触发', () => {
    const clock = new ManualClock();
    // 注入恒定随机源验证边界：0.4 < 0.5 → 每轮都出副产出
    const game = createGame({ content: makePack(), clock, rng: () => 0.4 });

    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();

    for (let i = 0; i < CYCLES_60S; i++) {
      clock.advance(3000);
      game.tick(3000);
    }

    const st = stateOf(game.snapshot());
    expect(st.items.herb1).toBe(CYCLES_60S);
    expect(st.items.silk).toBe(CYCLES_60S);
    expect(st.activity).toMatchObject({ skillId: 'herb', index: 0 });

    const types = game.events.drain().map((e) => e.type);
    expect(types.filter((t) => t === 'activity-complete')).toHaveLength(CYCLES_60S);
    expect(types.filter((t) => t === 'loot')).toHaveLength(CYCLES_60S * 2);
    expect(types[types.length - 1]).toBe('tick');
  });

  it('60 秒内 levelup 事件触发（6 修为×20 轮 → 1→3 层）', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.6 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();

    clock.advance(60000);
    game.tick(60000);

    const levelups = game.events.drain().filter((e) => e.type === 'levelup');
    expect(levelups.map((e) => e.data?.level)).toEqual([2, 3]);
    const st = stateOf(game.snapshot());
    expect(st.skills.herb?.xp).toBe(120);
  });

  it('副产出长期期望收敛于 chance（多种子统计）', () => {
    let totalSilk = 0;
    const trials = 50;
    for (let i = 0; i < trials; i++) {
      const clock = new ManualClock();
      const game = createGame({ content: makePack(), clock, seed: (i * 2654435761) >>> 0 });
      game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
      clock.advance(60000);
      game.tick(60000);
      totalSilk += stateOf(game.snapshot()).items.silk ?? 0;
    }
    const mean = totalSilk / trials; // 期望 20×0.5 = 10
    expect(mean).toBeGreaterThan(7);
    expect(mean).toBeLessThan(13);
  });

  it('等级不足：dispatch 被拒并产出 reject 事件', () => {
    const game = createGame({ content: makePack(), clock: new ManualClock() });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 1 } }); // 需 15 层

    const [event] = game.events.drain();
    expect(event.type).toBe('reject');
    expect(event.data).toMatchObject({ action: 'activity:start', reason: 'level' });
    expect(stateOf(game.snapshot()).activity).toBeNull();
  });

  it('材料不足：卖出被拒，灵石不动', () => {
    const game = createGame({ content: makePack(), clock: new ManualClock() });
    game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 10 } });

    const [event] = game.events.drain();
    expect(event.type).toBe('reject');
    expect(event.data).toMatchObject({ reason: 'no-item' });
    expect(stateOf(game.snapshot()).gp).toBe(0);
  });

  it('灵石不足 / 未上架：购买被拒', () => {
    const game = createGame({ content: makePack(), clock: new ManualClock() });

    game.dispatch({ type: 'shop:buy', payload: { item: 'pill_heal' } });
    expect(game.events.drain()[0]?.data).toMatchObject({ reason: 'no-gold' });

    game.dispatch({ type: 'shop:buy', payload: { item: 'herb1' } });
    expect(game.events.drain()[0]?.data).toMatchObject({ reason: 'not-in-shop' });
  });

  it('卖出入账：gp 与乾坤袋同步', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.9 }); // 永无副产出
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(12000);
    game.tick(12000);

    game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 4 } });
    const events = game.events.drain();
    expect(events.some((e) => e.type === 'sell')).toBe(true);

    const st = stateOf(game.snapshot());
    expect(st.gp).toBe(16); // 4 件 × 4 灵石
    expect(st.items.herb1).toBeUndefined(); // 0 值不落盘
  });

  it('存档连续性：恢复后接续 60 秒与一次跑 120 秒等价', () => {
    const c1 = new ManualClock();
    const g1 = createGame({ content: makePack(), clock: c1, rng: () => 0.4 });
    g1.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    c1.advance(120000);
    g1.tick(120000);
    const straight = stateOf(g1.snapshot());

    const c2 = new ManualClock();
    const g2 = createGame({ content: makePack(), clock: c2, rng: () => 0.4 });
    g2.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    c2.advance(60000);
    g2.tick(60000);
    const resumed = createGame({ content: makePack(), clock: c2, save: g2.snapshot(), rng: () => 0.4 });
    c2.advance(60000);
    resumed.tick(60000);
    const continued = stateOf(resumed.snapshot());

    expect(continued.items).toEqual(straight.items);
    expect(continued.skills).toEqual(straight.skills);
    expect(continued.activity).toEqual(straight.activity);
  });

  it('离线补偿结算：O(1) 补齐欠账，只产出一条汇总事件', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.4 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(4000);
    game.tick(4000); // 完成 1 轮 + 1000ms 进度
    expect(stateOf(game.snapshot()).items.herb1).toBe(1);

    const save = game.snapshot();
    expect(save.savedAt).toBe(4000);
    clock.advance(57000);

    // 重开加载：应用层按 savedAt 墙钟差调公开的 settleOffline（UI 可先订阅再结算）。
    const resumed = createGame({ content: makePack(), clock, save, rng: () => 0.4 });
    expect(resumed.events.drain()).toEqual([]); // 构造期不自动结算

    resumed.settleOffline(57000);
    const events = resumed.events.drain();
    expect(events).toHaveLength(1); // 不逐轮刷 loot/exp
    const offline = events[0];
    expect(offline.type).toBe('offline-settled');
    expect(offline.data).toMatchObject({
      cycles: 19,
      exp: 114,
      items: { herb1: 19, silk: 10 }, // floor(9.5)=9 + 余数伯努利 1
    });

    const st = stateOf(resumed.snapshot());
    expect(st.items.herb1).toBe(20);
    expect(st.activity?.progress).toBe(1000); // 余数留在进度条上

    clock.advance(2000);
    resumed.tick(2000);
    expect(stateOf(resumed.snapshot()).items.herb1).toBe(21);
  });

  it('后台欠账补偿：超长间隔封顶在线步进 + settleOffline 补齐，不丢轮次', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.4 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();

    // 模拟主循环对 60 秒强节流的处理：tick(5000) + settleOffline(55000)
    game.tick(5000); // 1 轮 + 2000ms 进度
    game.settleOffline(55000); // (2000+55000) = 57000 → 19 轮

    const st = stateOf(game.snapshot());
    expect(st.items.herb1).toBe(20);
    expect(st.activity?.progress).toBe(0);
  });

  it('activity:start 对同一活动幂等，不清进度', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.6 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(4000);
    game.tick(4000); // 进度 1000ms
    game.events.drain();

    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    expect(game.events.drain()).toEqual([]);
    expect(stateOf(game.snapshot()).activity?.progress).toBe(1000);
  });

  it('脱战回血：气血向上限恢复（4%/秒）', () => {
    const clock = new ManualClock();
    const save: SaveData = {
      version: 1,
      time: 0,
      state: { gp: 0, hp: 50, items: {}, skills: { combat: { xp: 0 } }, activity: null },
    };
    const game = createGame({ content: makePack(), clock, save });

    clock.advance(1000);
    game.tick(1000);

    // maxHp = 100 + 12×1 = 112；50 + 112×0.04 = 54.48
    expect(stateOf(game.snapshot()).hp).toBeCloseTo(54.48, 5);
  });

  it('未知动作被拒', () => {
    const game = createGame({ content: makePack(), clock: new ManualClock() });
    game.dispatch({ type: 'nonsense' });
    expect(game.events.drain()[0]?.data).toMatchObject({ reason: 'unknown-action' });
  });
});
