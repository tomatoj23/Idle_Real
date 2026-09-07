/**
 * 成就判定器（#9）：条件/奖励/隐藏全部来自 content 包 achievements 节，
 * 引擎只保留「统计 snapshot → 条件判定 → 一次性解锁 → 奖励入账」机制。
 *
 * 归属划界（ADR-017）：
 * - 机制归引擎：条件判定（阈值/布尔/反向阈值）、进度投影、解锁幂等、奖励入账；
 * - 数据归 content：成就表本体（条件目标/奖励/隐藏/文案），换包即换成就，
 *   引擎零改动（票面验收 ②）。
 *
 * 条件模型（票面三型的落点）：
 * - 阈值型/累计型：`{ stat, target }`，op 缺省 'gte'（stat ≥ target），
 *   进度条由 achievementProgressOf 投影（壳零公式复算）；
 * - 布尔型：`{ stat }`（无 target），stat 有记录且 > 0 即达成；
 * - 反向阈值（最快击杀类）：`{ stat, target, op: 'lte' }`（stat ≤ target）。
 * 判定只读 state.stats（统计聚合器产出），与平台（Steam）解耦。
 */

import type { GameContent } from './types.js';
import type { StatSnapshot } from './stats.js';

/** 成就条件视图（与 @wendao/content 的 AchievementCondition 同形）。 */
export interface AchievementConditionView {
  readonly stat: string;
  readonly op: 'gte' | 'lte';
  /** 阈值；缺省 = 布尔条件（stat 有记录且 > 0）。 */
  readonly target?: number;
}

/** 成就奖励视图（可选；items 只收编 mat/consumable 语义，由包校验 xref 保证）。 */
export interface AchievementRewardView {
  readonly gold?: number;
  readonly daoYun?: number;
  readonly items?: readonly { readonly item: string; readonly count: number }[];
}

/** 成就定义视图（content 包 achievements 节条目，#9）。 */
export interface AchievementView {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly description?: string;
  /** 隐藏成就：解锁前壳以占位展示（引擎透传，UI 消费）。 */
  readonly hidden: boolean;
  readonly condition: AchievementConditionView;
  readonly reward?: AchievementRewardView;
}

/** 奖励形状防御读取：非法字段逐项丢弃，全空 = 无奖励。 */
function readReward(raw: unknown): AchievementRewardView | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const gold =
    typeof r.gold === 'number' && Number.isFinite(r.gold) && r.gold > 0 ? Math.floor(r.gold) : undefined;
  const daoYun =
    typeof r.daoYun === 'number' && Number.isFinite(r.daoYun) && r.daoYun > 0
      ? Math.floor(r.daoYun)
      : undefined;
  const items: Array<{ item: string; count: number }> = [];
  if (Array.isArray(r.items)) {
    for (const stack of r.items) {
      if (stack === null || typeof stack !== 'object') continue;
      const s = stack as Record<string, unknown>;
      if (typeof s.item !== 'string' || s.item.length === 0) continue;
      if (typeof s.count !== 'number' || !Number.isInteger(s.count) || s.count <= 0) continue;
      items.push({ item: s.item, count: s.count });
    }
  }
  if (gold === undefined && daoYun === undefined && items.length === 0) return undefined;
  return {
    ...(gold !== undefined ? { gold } : {}),
    ...(daoYun !== undefined ? { daoYun } : {}),
    ...(items.length > 0 ? { items } : {}),
  };
}

/**
 * 成就表读取（contentView 同款安全兜底）：缺节 = 该题材无成就玩法；
 * 形状非法的条目逐条跳过（包校验已在加载期拒绝坏内容，此处为引擎侧防御）。
 */
export function achievementsOf(content: GameContent): readonly AchievementView[] {
  const raw = (content as { achievements?: unknown }).achievements;
  if (!Array.isArray(raw)) return [];
  const out: AchievementView[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id.length === 0) continue;
    if (typeof e.name !== 'string' || e.name.length === 0) continue;
    const cond = e.condition;
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) continue;
    const c = cond as Record<string, unknown>;
    if (typeof c.stat !== 'string' || c.stat.length === 0) continue;
    const target =
      typeof c.target === 'number' && Number.isFinite(c.target) && c.target > 0
        ? Math.floor(c.target)
        : undefined;
    const reward = readReward(e.reward);
    out.push({
      id: e.id,
      name: e.name,
      ...(typeof e.icon === 'string' && e.icon.length > 0 ? { icon: e.icon } : {}),
      ...(typeof e.description === 'string' && e.description.length > 0
        ? { description: e.description }
        : {}),
      hidden: e.hidden === true,
      condition: {
        stat: c.stat,
        op: c.op === 'lte' ? 'lte' : 'gte',
        ...(target !== undefined ? { target } : {}),
      },
      ...(reward !== undefined ? { reward } : {}),
    });
  }
  return out;
}

/**
 * 条件判定（成就评估与进度投影共用）：布尔型看「有记录且 > 0」；
 * 阈值型无记录按 0 对照（target ≥ 1 恒不达成）；反向阈值须有记录
 * （未击杀过 = fastestKill 无记录，不达成）。
 */
export function achievementConditionMet(
  condition: AchievementConditionView,
  stats: Readonly<StatSnapshot>,
): boolean {
  const current = stats[condition.stat];
  if (condition.target === undefined) return current !== undefined && current > 0;
  if (typeof current !== 'number' || !Number.isFinite(current)) return false;
  return condition.op === 'lte' ? current <= condition.target : current >= condition.target;
}

/** 单成就进度视图：壳零公式复算的投影面（percent 0~100）。 */
export interface AchievementProgressView {
  readonly def: AchievementView;
  readonly unlocked: boolean;
  /** 统计当前读数；无记录 = undefined。 */
  readonly current: number | undefined;
  /** 阈值；布尔型 = undefined。 */
  readonly target: number | undefined;
  /** 进度百分比（0~100 取整；已解锁恒 100，布尔型未解锁恒 0）。 */
  readonly percent: number;
}

/** 成就表 → 进度视图（壳成就页单一来源；解锁集由 state.achievements 稳定引用）。 */
export function achievementProgressOf(
  content: GameContent,
  stats: Readonly<StatSnapshot>,
  unlockedIds: readonly string[],
): readonly AchievementProgressView[] {
  const unlocked = new Set(unlockedIds);
  return achievementsOf(content).map((def) => {
    const current = stats[def.condition.stat];
    const target = def.condition.target;
    if (unlocked.has(def.id)) {
      return { def, unlocked: true, current, target, percent: 100 };
    }
    let percent = 0;
    if (target !== undefined && typeof current === 'number' && Number.isFinite(current)) {
      if (def.condition.op === 'lte') {
        percent =
          current <= target
            ? 100
            : current > 0
              ? Math.min(100, Math.round((target / current) * 100))
              : 0;
      } else {
        percent = Math.min(100, Math.round((current / target) * 100));
      }
    }
    return { def, unlocked: false, current, target, percent };
  });
}
