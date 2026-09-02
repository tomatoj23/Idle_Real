/**
 * 修为曲线与气血映射（issue #3）。
 *
 * SPEC 约定：经验曲线属引擎机制，参数暂由引擎常量承载（沿用旧版基线
 * ——每层需 floor(10·(L-1)^1.8 + 15·(L-1))，1~99 层），内容化随后续票据。
 */

/** 修为层数上限。 */
export const MAX_LEVEL = 99;

/** 脱战回血：每秒回复最大气血的比例（旧版 4%/s 基线）。 */
export const HP_REGEN_FRACTION_PER_SEC = 0.04;

/** 气血上限 = HP_BASE + HP_PER_LEVEL × 斗法层数（旧版基线）。 */
export const HP_BASE = 100;
export const HP_PER_LEVEL = 12;

/** XP_CUM[l]：升到 l 层累计所需修为（XP_CUM[1] = 0）。 */
const XP_CUM: readonly number[] = (() => {
  const table: number[] = [0, 0];
  for (let l = 2; l <= MAX_LEVEL; l++) {
    const prev = table[l - 1] ?? 0;
    table[l] = prev + Math.floor(10 * Math.pow(l - 1, 1.8) + 15 * (l - 1));
  }
  return table;
})();

/** 由累计修为推算层数（封顶 MAX_LEVEL）。 */
export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= (XP_CUM[level + 1] ?? Number.POSITIVE_INFINITY)) {
    level++;
  }
  return level;
}

/** 当前层升入下一层所需修为；已达上限时为 Infinity。 */
export function expToNext(level: number): number {
  if (level >= MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return (XP_CUM[level + 1] ?? 0) - (XP_CUM[level] ?? 0);
}

/** 层级起始累计修为（经验条起点）。 */
export function expBase(level: number): number {
  return XP_CUM[Math.min(Math.max(level, 1), MAX_LEVEL)] ?? 0;
}

/** 斗法层数 → 气血上限。 */
export function maxHpForLevel(level: number): number {
  return HP_BASE + HP_PER_LEVEL * level;
}
