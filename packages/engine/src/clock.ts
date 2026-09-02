import type { Clock } from './types.js';

/** 真实时钟（createGame 默认注入）。 */
export function realClock(): Clock {
  return { now: () => Date.now() };
}

/** 手动时钟：测试与回放用，由外部推针。 */
export class ManualClock implements Clock {
  #now: number;

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  /** 向前拨动 ms 毫秒。 */
  advance(ms: number): void {
    this.#now += ms;
  }
}
