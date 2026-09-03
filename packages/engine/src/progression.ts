/**
 * 修为曲线与气血映射（issue #3；#020 批 3 参数数据化）。
 *
 * SPEC 约定：经验曲线属引擎机制，参数由 config.progression 承载
 * （ADR-016 裁决 ① 分策：数值参数引擎内置基线 + config 覆盖）——
 * 原"参数暂由引擎常量承载"的登记债务就此清偿。
 *
 * 全部导出函数带可选参数位：缺省用引擎基线（行为与历史版本完全一致），
 * createGame 从内容包解析 config.progression 后传入，UI/测试亦可显式传。
 */

/** 修为曲线参数：config.progression 同名字段覆盖引擎基线（#020）。 */
export interface ProgressionParams {
  /** 修为层数上限。 */
  readonly maxLevel: number;
  /** 升层所需修为 = floor(xpPowCoef × L^xpExponent + xpLinearCoef × L)，L 为当前层。 */
  readonly xpPowCoef: number;
  readonly xpExponent: number;
  readonly xpLinearCoef: number;
  /** 气血上限 = hpBase + hpPerLevel × 斗法层数（旧版基线）。 */
  readonly hpBase: number;
  readonly hpPerLevel: number;
  /** 脱战回血：每秒回复最大气血的比例（旧版 4%/s 基线）。 */
  readonly hpRegenPerSec: number;
}

/** 引擎基线（旧版 data.js 沿革）；config.progression 缺省字段逐项回落到此。 */
export const BASE_PROGRESSION: ProgressionParams = {
  maxLevel: 99,
  xpPowCoef: 10,
  xpExponent: 1.8,
  xpLinearCoef: 15,
  hpBase: 100,
  hpPerLevel: 12,
  hpRegenPerSec: 0.04,
};

/** 由 l 层升入 l+1 层所需修为。 */
function xpStep(level: number, p: ProgressionParams): number {
  return Math.floor(p.xpPowCoef * Math.pow(level, p.xpExponent) + p.xpLinearCoef * level);
}

/** 由累计修为推算层数（封顶 maxLevel）。 */
export function levelFromXp(xp: number, p: ProgressionParams = BASE_PROGRESSION): number {
  let level = 1;
  let acc = 0;
  while (level < p.maxLevel) {
    const next = acc + xpStep(level, p);
    if (!(xp >= next)) break;
    acc = next;
    level++;
  }
  return level;
}

/** 当前层升入下一层所需修为；已达上限时为 Infinity。 */
export function expToNext(level: number, p: ProgressionParams = BASE_PROGRESSION): number {
  if (level >= p.maxLevel) return Number.POSITIVE_INFINITY;
  return xpStep(level, p);
}

/** 层级起始累计修为（经验条起点）。 */
export function expBase(level: number, p: ProgressionParams = BASE_PROGRESSION): number {
  const cap = Math.min(Math.max(level, 1), p.maxLevel);
  let acc = 0;
  for (let l = 2; l <= cap; l++) acc += xpStep(l - 1, p);
  return acc;
}

/** 斗法层数 → 气血上限。 */
export function maxHpForLevel(level: number, p: ProgressionParams = BASE_PROGRESSION): number {
  return p.hpBase + p.hpPerLevel * level;
}
