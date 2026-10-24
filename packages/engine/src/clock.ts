import type { Clock } from './types.js';

/** 真实时钟（createGame 默认注入）。 */
export function realClock(): Clock {
  // policy-allow: P7 注入时钟的唯一墙钟落点——ADR-013 禁的是绕过 Clock 注入直取时，不是这个单点
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
