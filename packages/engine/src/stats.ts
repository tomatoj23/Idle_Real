/**
 * 统计聚合器（#9）：把引擎事件流累积成统计 snapshot。
 *
 * 设计约定（票面）：成就判定只读事件流累积的统计 snapshot，与平台
 * （Steam）解耦；统计键 = 引擎协议面闭集（STAT_KEYS），引擎零内容感知——
 * 换成就表 = 换 content 包 achievements 节，统计语义不随包变。
 *
 * 消费方式：createGame 内部订阅自身事件总线，emit 即同步累积到
 * state.stats（监听器异常由 EventBus 吞掉，不阻断主循环）；
 * 累积规则与在线/离线语义对称（offline-settled 的轮数并入 cycles）。
 */

import type { GameEvent } from './types.js';

/** 统计 snapshot：stat 键 → 累积值（引擎内建键皆为非负整数）。 */
export type StatSnapshot = Record<string, number>;

/**
 * 引擎内建统计键注册表（闭集）：事件 → 累积语义。
 * content 侧成就条件引用合法性由包校验对照此表收口（REBIRTH_RESET_KEYS
 * 先例：schema 只钉键形态，键域在语义层收口）。
 *
 * | 键 | 累积语义 | 事件源 |
 * |---|---|---|
 * | `kills` | Σ 击杀数 | victory +1 |
 * | `deaths` | Σ 落败数 | defeat +1 |
 * | `rebirths` | Σ 兵解次数 | rebirth +1 |
 * | `cycles` | Σ 采集/炼制轮数（离线结算轮数同路并入） | activity-complete +1 / offline-settled +cycles |
 * | `dungeonFloorBest` | 历史最高到达秘境层（max） | dungeon:enter/floor/leave |
 * | `maxHit` | 历史最大单次伤害（玩家侧，max） | attack(side=player) |
 * | `fastestKill` | 最快击杀回合数（min，未击杀过 = 无记录） | victory(rounds) |
 */
export const STAT_KEYS = [
  'kills',
  'deaths',
  'rebirths',
  'cycles',
  'dungeonFloorBest',
  'maxHit',
  'fastestKill',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

const STAT_KEYS_SET: ReadonlySet<string> = new Set(STAT_KEYS);

/** 事件载荷数值守卫：有限非负数才参与累积（防御路径，包侧不产生 NaN）。 */
function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Σ 累积：bump(stats, 'kills', 1)。 */
function bump(stats: StatSnapshot, key: StatKey, delta: number): void {
  stats[key] = (stats[key] ?? 0) + delta;
}

/** max 累积：历史最高（dungeonFloorBest / maxHit）。 */
function bumpMax(stats: StatSnapshot, key: StatKey, value: number): void {
  if (value > (stats[key] ?? Number.NEGATIVE_INFINITY)) stats[key] = value;
}

/** min 累积：历史最佳（fastestKill 最快击杀回合数）。 */
function bumpMin(stats: StatSnapshot, key: StatKey, value: number): void {
  if (stats[key] === undefined || value < stats[key]) stats[key] = value;
}

/**
 * 单事件 → 统计累积（纯过程，就地改写 snapshot）。
 * 未登记的事件类型零扰动（成就判定之外的引擎事件自由演进）。
 */
export function applyStatsEvent(stats: StatSnapshot, event: GameEvent): void {
  const data = event.data ?? {};
  switch (event.type) {
    case 'victory': {
      bump(stats, 'kills', 1);
      const rounds = asCount(data.rounds);
      if (rounds !== undefined) bumpMin(stats, 'fastestKill', rounds); // min 累积：最快击杀
      break;
    }
    case 'defeat':
      bump(stats, 'deaths', 1);
      break;
    case 'rebirth':
      bump(stats, 'rebirths', 1);
      break;
    case 'activity-complete':
      bump(stats, 'cycles', 1);
      break;
    case 'offline-settled': {
      // 在线/离线语义对称（#6 先例）：离线轮数并入 cycles。
      const cycles = asCount(data.cycles);
      if (cycles !== undefined) bump(stats, 'cycles', Math.floor(cycles));
      break;
    }
    case 'attack': {
      if (data.side !== 'player') break;
      const dmg = asCount(data.dmg);
      if (dmg !== undefined) bumpMax(stats, 'maxHit', dmg);
      break;
    }
    case 'dungeon:enter':
    case 'dungeon:floor': {
      const floor = asCount(data.floor);
      if (floor !== undefined) bumpMax(stats, 'dungeonFloorBest', floor);
      break;
    }
    case 'dungeon:leave': {
      // leave 载荷 best = max(记录, 本次到达层)——离境结算一并覆盖。
      const best = asCount(data.best) ?? asCount(data.floor);
      if (best !== undefined) bumpMax(stats, 'dungeonFloorBest', best);
      break;
    }
    default:
      break;
  }
}

/** 存档恢复侧：统计键域收口（未知键不收编）+ 数值钳非负整数。 */
export function restoreStats(raw: unknown): StatSnapshot {
  const stats: StatSnapshot = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return stats;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!STAT_KEYS_SET.has(key)) continue;
    const num = asCount(value);
    if (num !== undefined) stats[key] = Math.floor(num);
  }
  return stats;
}
