import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { EventBus } from '../src/events.js';
import { createGame } from '../src/index.js';
import type { GameEvent } from '../src/types.js';

const tick = (dt: number): GameEvent => ({ type: 'tick', time: dt, data: { dt } });

describe('EventBus · 诊断面（#75 项 1/5）', () => {
  it('监听器异常不阻断主循环与其余监听器，异常与事件走 onError 钩子', () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    const bus = new EventBus(256, (error) => errors.push(error));
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((event) => seen.push(event.type));

    bus.emit(tick(1));

    expect(seen).toEqual(['tick']);
    expect(bus.drain()).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
  });

  it('缺省诊断面走 console.error（globalThis 运行时探测；异常仍不外抛）', () => {
    const spy = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {});
    const bus = new EventBus();
    bus.subscribe(() => {
      throw new Error('silent-no-more');
    });

    expect(() => bus.emit(tick(1))).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('超限丢最旧并累计 overflow 计数（每丢一件 +1），drain 不清计数', () => {
    const bus = new EventBus(2);
    expect(bus.overflow).toBe(0);

    for (let i = 1; i <= 5; i++) bus.emit(tick(i));
    expect(bus.overflow).toBe(3); // 1..5 中 3、4、5 各顶掉一件最旧
    expect(bus.drain().map((event) => event.time)).toEqual([4, 5]);
    expect(bus.overflow).toBe(3); // drain 不清计数

    for (let i = 6; i <= 8; i++) bus.emit(tick(i));
    expect(bus.overflow).toBe(4); // 8 顶掉 6：再丢一件
  });

  it('createGame 的 onEventError 覆盖内置/外部订阅者异常（丢账不再无声）', () => {
    const errors: unknown[] = [];
    const game = createGame({
      content: {},
      clock: new ManualClock(),
      onEventError: (error) => errors.push(error),
    });
    game.events.subscribe(() => {
      throw new Error('journal-blown');
    });

    game.tick(100);

    expect(errors).toHaveLength(1);
  });
});
