/**
 * 种子化随机源（ADR-013 确定性纪律：引擎三禁之一——禁 Math.random，
 * 随机一律走可持久化种子的 PRNG；随机状态随存档持久化，离线可解）。
 */

export interface SeededRng {
  /** 返回 [0, 1) 随机数，并推进内部状态。 */
  next(): number;
  /** 当前内部状态（快照持久化用）。 */
  state(): number;
}

/** mulberry32：32 位 PRNG，游戏随机质量足够且状态可完整持久化。 */
export function createRng(seed: number): SeededRng {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state(): number {
      return s >>> 0;
    },
  };
}
