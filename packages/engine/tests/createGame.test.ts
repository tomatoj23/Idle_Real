import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame } from '../src/index.js';

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
    const save = { version: 1 as const, time: 1234, savedAt: 500, state: { gp: 42, realm: '练气' } };
    const game = createGame({ content: minimalContent, save, clock });

    const snapshot = game.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.time).toBe(1234);
    expect(snapshot.savedAt).toBe(500);
    expect(snapshot.state).toMatchObject({ gp: 42, realm: '练气' });
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
