import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame, playerMaxHp, restoreState } from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/** 最小内容包：引擎零内容感知，空壳即可开局。 */
const minimalContent = {};

describe('createGame', () => {
  it('注入最小 content + 假时钟，tick 后事件流产出一条 tick 事件', () => {
    const game = createGame({ content: minimalContent, clock: new ManualClock() });

    expect(game.events.drain()).toEqual([]);

    game.tick(100);

    const events = game.events.drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tick', time: 100, data: { dt: 100 } });
  });

  it('连续 tick 累计游戏内时间', () => {
    const game = createGame({ content: minimalContent, clock: new ManualClock() });

    game.tick(100);
    game.tick(50);

    expect(game.events.drain().map((event) => event.time)).toEqual([100, 150]);
  });

  it('从存档恢复状态，快照可再次导出（含 savedAt；未知键透传）', () => {
    const clock = new ManualClock(500);
    const save = { version: 1 as const, time: 1234, savedAt: 500, state: { gold: 42, realm: '练气' } };
    const game = createGame({ content: minimalContent, save, clock });

    const snapshot = game.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.time).toBe(1234);
    expect(snapshot.savedAt).toBe(500);
    expect(snapshot.state).toMatchObject({ gold: 42, realm: '练气' });
  });

  it('订阅者实时收到推送，退订后不再接收', () => {
    const game = createGame({ content: minimalContent, clock: new ManualClock() });
    const received: string[] = [];
    const unsubscribe = game.events.subscribe((event) => received.push(event.type));

    game.tick(1);
    unsubscribe();
    game.tick(1);

    expect(received).toEqual(['tick']);
  });

  it('非法 dt 被忽略，不产出事件', () => {
    const game = createGame({ content: minimalContent, clock: new ManualClock() });

    game.tick(0);
    game.tick(-5);
    game.tick(Number.NaN);

    expect(game.events.drain()).toEqual([]);
  });
});

describe('#58 项 5 · restoreState 直调契约（文档性钉子，防无声漂移）', () => {
  /**
   * state.ts hp 行的导出面契约：restoreState 单独调用产出的 hp **未钳顶**
   * （声明序在 gear 前，装备/增益投影不可见，此处补钳会误伤合法头寸），
   * 唯一上限钳点在 createGame 的完整属性投影。本组两面对拍把契约钉成
   * 断言——哪一侧无声改变（restore 内补钳 / createGame 丢钳）即红。
   */
  const overflowingSave = {
    version: 1 as const,
    time: 0,
    state: { hp: 9999 }, // 远超空技能基线 cap（clv1 = 112）
  };

  it('restoreState 直调：hp 超上限原值收编、不钳顶（只供 createGame 消费）', () => {
    const state = restoreState(minimalContent, overflowingSave, 7);
    expect(state.hp).toBe(9999);
  });

  it('createGame 恢复：同一存档 hp 被完整投影钳回上限（唯一钳点在装配层）', () => {
    const game = createGame({ content: minimalContent, save: overflowingSave, clock: new ManualClock() });
    expect(game.snapshot().state.hp).toBe(playerMaxHp(minimalContent, {}, []));
  });
});

/* ---------- #62 保真收尾批 ---------- */

describe('#62 · 存档自愈与散功重修', () => {
  it('hp ≤ 0 坏档自愈：恢复面回满投影上限（旧版 load() 语义；正当局 hp 恒正不受影响）', () => {
    const save = { version: 1 as const, time: 100, state: { hp: 0 } };
    const game = createGame({ content: minimalContent, save, clock: new ManualClock(500) });
    const snap = game.snapshot();
    expect(snap.state.hp).toBe(snap.stats?.maxHp);
    expect(snap.state.hp).toBeGreaterThan(0);
  });

  it('game:reset 散功重修：整态重置回新开局 + 时间归零 + game-reset 事件', () => {
    const pack = makeCombatPack();
    const clock = new ManualClock();
    const game = createGame({ content: pack, clock, seed: 42 });

    // 先造出可观测进度：开采集跑三轮（物品/修为入账）。
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.tick(10000);
    const before = game.snapshot().state as unknown as Record<string, unknown>;
    const items = before.items as Record<string, number>;
    expect(items['herb1'] ?? 0).toBeGreaterThan(0);

    game.dispatch({ type: 'game:reset' });

    const events = game.events.drain();
    expect(events.some((event) => event.type === 'game-reset')).toBe(true);
    expect(game.snapshot().time).toBe(0);

    // 整态对拍：与同种子新开局逐键全等（rngSeed 除外——RNG 流延续非回卷）。
    const fresh = createGame({ content: pack, clock: new ManualClock(), seed: 42 });
    const after = { ...(game.snapshot().state as unknown as Record<string, unknown>) };
    const base = { ...(fresh.snapshot().state as unknown as Record<string, unknown>) };
    delete after.rngSeed;
    delete base.rngSeed;
    expect(after).toEqual(base);
  });
});
