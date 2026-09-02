/**
 * 修饰符聚合管线（issue #13，ADR-011）。
 *
 * 地基纪律：**flat → 加法% → 乘法区** 一条管线按序结算；铭纹/胚纹/丹药 buff/
 * 宗门/转生天赋等一切产出方都产出修饰符走同一管线，**禁止绕管线直改属性**。
 * 引擎零内容感知：修饰符与来源都是开放结构，引擎不理解 stat/zone/kind 的
 * 具体取值，只负责按区聚合。
 *
 * 事件语境（SexyMUD ADR-0006 教训）：每条修饰符第一天就携带产出方语境
 * （来源 id/类型/实例 uid），聚合结果 breakdown.applied 保留命中明细，
 * 任何把属性效果写入事件流的下游（战斗/日志/模拟器）都能引用完整语境，
 * 无需事后补字段。
 */

/** 聚合区：flat 固定值 → addPct 加法百分比（百分点）→ mult 乘法区（倍率）。 */
export type ModifierZone = 'flat' | 'addPct' | 'mult';

/** 定向条件：只检查声明的维度，全部命中才生效（与 content 包 Modifier 同形）。 */
export interface ModifierCondition {
  /** 来袭伤害系别命中（如「受火系伤害时」）。 */
  readonly element?: string;
  /** 招式命中（如「挥舞某法器时」）。 */
  readonly moveId?: string;
}

/** 属性修饰符：聚合管线的最小贡献单元（与 content 包 Modifier 同形）。 */
export interface Modifier {
  /** 目标属性 id（atk/def/hp/crit/gatherXp…），引擎不枚举。 */
  readonly stat: string;
  readonly zone: ModifierZone;
  /** 数值：flat 任意 / addPct 百分点（≥−100，语义校验把关）/ mult 倍率（>0）。 */
  readonly value: number;
  readonly condition?: ModifierCondition;
}

/**
 * 产出方语境：修饰符的来源身份。
 * id=来源条目 id；kind=产出方类型（equip/inscription/pill/sect/talent…开放枚举）；
 * uid=实例标识（装备实例等，模板来源省略）；name=展示名（事件语境用，可选）。
 */
export interface ModifierSource {
  readonly id: string;
  readonly kind: string;
  readonly uid?: number;
  readonly name?: string;
}

/** 一条贡献：修饰符 + 它的来源。产出方接口的唯一形态。 */
export interface Contribution {
  readonly modifier: Modifier;
  readonly source: ModifierSource;
}

/** 聚合上下文：条件门控的判定依据；未提供的维度视为不命中。 */
export interface AggregationContext {
  /** 来袭伤害系别（抗性类条件）。 */
  readonly element?: string;
  /** 当前命中招式（定向强化类条件）。 */
  readonly moveId?: string;
}

/** 命中的贡献明细：事件流消费的完整语境单元（含命中条件，离线可回放）。 */
export interface AppliedContribution {
  readonly zone: ModifierZone;
  readonly value: number;
  readonly source: ModifierSource;
  readonly condition?: ModifierCondition;
}

/** 单属性聚合快照：分区分解 + 最终值 + 命中明细。 */
export interface StatBreakdown {
  readonly stat: string;
  /** 基线值（调用方传入，如曲线推导的气血上限）。 */
  readonly base: number;
  readonly flat: number;
  /** 加法% 区总和（百分点）。 */
  readonly addPct: number;
  /** 乘法区连乘积（无贡献 = 1）。 */
  readonly mult: number;
  /** 最终值：(base + flat) × (1 + addPct/100) × mult，钳到 ≥0。 */
  readonly value: number;
  readonly applied: readonly AppliedContribution[];
}

/**
 * 条件判定：只检查 condition 声明的维度（AND）；
 * 声明了但 context 未提供该维度 → 不命中。
 */
export function conditionMatches(
  condition: ModifierCondition | undefined,
  context: AggregationContext,
): boolean {
  if (condition === undefined) return true;
  if (condition.element !== undefined && condition.element !== context.element) return false;
  if (condition.moveId !== undefined && condition.moveId !== context.moveId) return false;
  return true;
}

const ZONES: readonly ModifierZone[] = ['flat', 'addPct', 'mult'];

/** 运行时兜底：形状/数值非法的贡献一律忽略（内容包校验是第一道关，引擎不崩）。 */
function isUsable(contribution: Contribution): boolean {
  const { modifier } = contribution;
  if (modifier === undefined || typeof modifier.stat !== 'string') return false;
  if (!ZONES.includes(modifier.zone)) return false;
  if (typeof modifier.value !== 'number' || !Number.isFinite(modifier.value)) return false;
  if (modifier.zone === 'mult' && modifier.value <= 0) return false;
  return true;
}

/**
 * 单属性聚合：过滤 stat + 条件命中 → 三区按序结算。
 * value = (base + Σflat) × (1 + ΣaddPct/100) × Πmult，负值钳到 0
 * （属性不因坏内容变负；applied 保留命中明细供事件流携带语境）。
 */
export function aggregateStat(
  stat: string,
  base: number,
  contributions: readonly Contribution[],
  context: AggregationContext = {},
): StatBreakdown {
  let flat = 0;
  let addPct = 0;
  let mult = 1;
  const applied: AppliedContribution[] = [];

  for (const contribution of contributions) {
    if (!isUsable(contribution)) continue;
    const { modifier, source } = contribution;
    if (modifier.stat !== stat) continue;
    if (!conditionMatches(modifier.condition, context)) continue;
    if (modifier.zone === 'flat') flat += modifier.value;
    else if (modifier.zone === 'addPct') addPct += modifier.value;
    else mult *= modifier.value;
    applied.push({
      zone: modifier.zone,
      value: modifier.value,
      source,
      ...(modifier.condition !== undefined ? { condition: modifier.condition } : {}),
    });
  }

  const raw = (base + flat) * (1 + addPct / 100) * mult;
  return { stat, base, flat, addPct, mult, value: Math.max(0, raw), applied };
}

/**
 * 多属性一次聚合：按 stat 分桶，避免每个属性各扫一遍贡献表。
 * base 未声明的属性以 0 为基线；返回键 = 出现在 base 或贡献中的 stat。
 */
export function aggregateStats(
  base: Readonly<Record<string, number>>,
  contributions: readonly Contribution[],
  context: AggregationContext = {},
): Readonly<Record<string, StatBreakdown>> {
  const byStat = new Map<string, Contribution[]>();
  for (const contribution of contributions) {
    if (!isUsable(contribution)) continue;
    const bucket = byStat.get(contribution.modifier.stat);
    if (bucket) bucket.push(contribution);
    else byStat.set(contribution.modifier.stat, [contribution]);
  }
  const out: Record<string, StatBreakdown> = {};
  for (const stat of new Set([...Object.keys(base), ...byStat.keys()])) {
    out[stat] = aggregateStat(stat, base[stat] ?? 0, byStat.get(stat) ?? [], context);
  }
  return out;
}
