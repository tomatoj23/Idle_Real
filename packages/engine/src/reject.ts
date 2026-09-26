/**
 * reject 码域注册表（#75 项 4）：动作 → 可发拒绝码的闭集枚举。
 *
 * 这是「引擎 reject(action,reason) 枚举」的单一声明面，双向皆有守卫：
 * - 点 → 行（编译）：emit 点经 reject() 逐动作泛型签名对拍，越动作发码 /
 *   码拼错 = 编译错；
 * - 行 → 点（源码扫描测试）：行内冗余码（emit 点已删/改）= 红——不留
 *   永不触发的死码与陪葬文案。
 * 文本包键（texts.reject）与此表由覆盖对照测试双向钉死（app-desktop 侧，
 * 引擎枚举 ↔ 包键——typo 键静默回落键名回显的补丁）。跨包纪律不变：
 * content 不引 engine，包键对照在装配层测试做。
 *
 * '*' 行 = 协议外动作（type 不在 GameAction 联合）的通用码域。
 */

import type { GameAction } from './types.js';

export const REJECT_MATRIX = {
  'activity:start': ['bad-payload', 'not-found', 'level', 'rebirth-locked', 'no-materials'],
  'bag:sell': ['bad-payload', 'not-found', 'no-item'],
  'shop:buy': ['bad-payload', 'not-in-shop', 'no-gold'],
  'combat:start': ['bad-payload', 'not-found', 'level', 'rebirth-locked', 'in-dungeon', 'low-hp'],
  'visit:begin': ['bad-payload'],
  'visit:end': ['bad-payload'],
  'dungeon:enter': [
    'bad-payload',
    'not-found',
    'in-dungeon',
    'in-combat',
    'locked',
    'no-key',
    'no-layer',
    'low-hp',
  ],
  'consumable:eat': ['bad-payload', 'not-consumable', 'no-item', 'full-hp'],
  'gear:equip': ['bad-payload', 'not-found', 'not-wearable'],
  'gear:unequip': ['bad-payload'],
  'gear:sell': ['bad-payload', 'not-found', 'worn'],
  'gear:smelt': ['bad-payload', 'not-found', 'worn', 'not-available'],
  'gear:reforge': ['bad-payload', 'not-found', 'worn', 'no-inscription', 'not-available', 'no-shard'],
  'rebirth:perform': ['not-available', 'in-combat', 'no-progress'],
  'talent:buy': ['not-available', 'bad-payload', 'not-found', 'prereq', 'no-daoyun'],
  '*': ['unknown-action'],
} as const satisfies Partial<Record<GameAction['type'] | '*', readonly string[]>>;

/** 矩阵键域：GameAction 的 type + '*' 通用行。 */
export type RejectAction = keyof typeof REJECT_MATRIX;

/** 动作 A 可发的拒绝码闭集（A 为联合时按分发并集；调用签名取严版见 StrictRejectReasonOf）。 */
export type RejectReasonOf<A extends RejectAction> = (typeof REJECT_MATRIX)[A][number];

/**
 * 严格版（#75 复审收口）：A 为联合时按**行交集**取码——动态动作域参数位
 * （enterCombat/enterFloor 的 'combat:start'|'dungeon:enter'）越动作发码
 * 同样编译不放行（分发并集会放行"只在其中一行的码"，是拒绝码收口的洞）。
 * 分发包一层函数参数再交：字面量集直接相交会化成 never。
 */
export type StrictRejectReasonOf<A extends RejectAction> =
  (A extends unknown ? (reason: RejectReasonOf<A>) => void : never) extends (reason: infer R) => void
    ? R & string
    : never;

/** 全码平铺（守卫/测试对照用）。 */
export type RejectReason = RejectReasonOf<RejectAction>;

/** reject 出口签名（dungeon.ts 窄门回调持此型，game.ts 装配侧满足之）。 */
export type RejectFn = <A extends RejectAction>(
  actionType: A,
  reason: StrictRejectReasonOf<A>,
  vars?: Readonly<Record<string, string>>,
) => void;
