/**
 * 转生结算框架（#6，兵解重修 / 道韵 / 天赋树 / 解锁表 / 境界词表）。
 *
 * 引擎零内容感知：rebirth 节按约定形状读取（contentView 同款安全兜底），
 * 缺节 = 该题材无转生玩法（rebirthOf 返回 undefined，一切消费点静默降级）。
 *
 * 归属划界（审计 round3 A5/E3 判例的延伸）：
 * - 机制归引擎：兵解结算动作（清重置集/保保留集/道韵入账）、天赋效果经
 *   ADR-011 聚合管线投影、解锁门控判定、道韵公式形状
 *   floor(base + coef × 总修为^exp)；
 * - 参数归 content：重置/保留清单（键域 = 引擎注册表闭集，schema enum 钉死）、
 *   公式系数、天赋树数据、解锁表目标、境界词表（B2 收编）。
 *
 * stat 消费点注册表（round3 E3 收口，#6 新增三键，详见 docs/agents/content.md）：
 * - `gatherSpeed`：采集轮间隔缩放（settleActivity/settleOffline + 快照投影）；
 * - `xpMult`：全经验倍率（grantExp 单点，gather/craft/combat/离线同路）；
 * - `offlineCap`：离线结算时长上限（flat 毫秒累计，Σ=0 = 不设限）。
 */

import type { GameContent } from './types.js';
import { aggregateStats, type Contribution, type Modifier } from './modifiers.js';

/* ---------- 内容视图（按形状读取，缺节/缺字段安全兜底） ---------- */

/** 天赋节点视图（与 @wendao/content 的 TalentNode 同形）。 */
export interface TalentNodeView {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly description?: string;
  readonly cost: number;
  readonly requires?: readonly string[];
  readonly effects?: readonly Modifier[];
}

/** 解锁表条目视图。 */
export interface RebirthUnlockView {
  readonly requires: { readonly daoYun: number };
  readonly enemies?: readonly string[];
  readonly skills?: readonly string[];
}

/** 境界词表条目视图（B2 收编）。 */
export interface RealmDefView {
  readonly level: number;
  readonly name: string;
}

/** 转生节视图（content 包 rebirth 节，可选）。 */
export interface RebirthSectionView {
  readonly reset?: readonly string[];
  readonly keep?: readonly string[];
  readonly formula?: {
    readonly base?: number;
    readonly coef?: number;
    readonly exp?: number;
    readonly minProgress?: number;
  };
  readonly talents?: readonly TalentNodeView[];
  readonly unlocks?: readonly RebirthUnlockView[];
  readonly realms?: readonly RealmDefView[];
}

/** 转生节读取：缺节返回 undefined（无转生玩法的唯一判据）。 */
export function rebirthOf(content: GameContent): RebirthSectionView | undefined {
  const rebirth = (content as { rebirth?: unknown }).rebirth;
  return rebirth !== null && typeof rebirth === 'object' && !Array.isArray(rebirth)
    ? (rebirth as RebirthSectionView)
    : undefined;
}

/** 按节点 id 取天赋节点；未注册（存档遗留/坏包）返回 undefined。 */
export function talentNodeOf(content: GameContent, nodeId: string): TalentNodeView | undefined {
  return rebirthOf(content)?.talents?.find((node) => node.id === nodeId);
}

/* ---------- 道韵公式（形状归引擎机制，系数归 content） ---------- */

/** 道韵公式参数（已解析基线）：rebirth.formula 缺省字段逐项回落。 */
export interface RebirthFormulaParams {
  readonly base: number;
  readonly coef: number;
  readonly exp: number;
  readonly minProgress: number;
}

/** 引擎基线；formula 缺省字段逐项回落到此（#020 同款分策）。 */
export const BASE_REBIRTH_FORMULA: RebirthFormulaParams = {
  base: 0,
  coef: 0.0002,
  exp: 1,
  minProgress: 5000,
};

/** 道韵公式参数：rebirth.formula 覆盖基线（非法值逐字段回落）。 */
export function rebirthFormulaOf(content: GameContent): RebirthFormulaParams {
  const raw = rebirthOf(content)?.formula;
  const pick = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    base: pick(raw?.base, BASE_REBIRTH_FORMULA.base),
    coef: pick(raw?.coef, BASE_REBIRTH_FORMULA.coef),
    exp: pick(raw?.exp, BASE_REBIRTH_FORMULA.exp),
    minProgress: pick(raw?.minProgress, BASE_REBIRTH_FORMULA.minProgress),
  };
}

/** 总修为（本世进度）：全技艺当前累计修为之和。 */
export function totalXpOf(skills: Readonly<Record<string, { xp?: number }>>): number {
  let total = 0;
  for (const progress of Object.values(skills)) {
    const xp = progress?.xp;
    if (typeof xp === 'number' && Number.isFinite(xp) && xp > 0) total += xp;
  }
  return total;
}

/** 道韵入账 = floor(base + coef × 总修为^exp)（公式形状单一来源）。 */
export function daoYunGainOf(params: RebirthFormulaParams, totalXp: number): number {
  return Math.floor(params.base + params.coef * Math.pow(Math.max(0, totalXp), params.exp));
}

/** 兵解预览（确认页展示与引擎判定同源）：门槛/可得道韵单一来源。 */
export interface RebirthPreviewView {
  /** 本世总修为。 */
  readonly totalXp: number;
  /** 兵解门槛（总修为须 ≥）。 */
  readonly minProgress: number;
  /** 是否已达门槛。 */
  readonly eligible: boolean;
  /** 兵解可得道韵（floor 公式）。 */
  readonly gain: number;
}

/**
 * 兵解预览：UI 确认页展示与引擎 rebirth:perform 判定同调此函数，
 * 壳禁另写公式（N1/shopAffordOf 同款收敛）。
 */
export function rebirthPreviewOf(
  content: GameContent,
  skills: Readonly<Record<string, { xp?: number }>>,
): RebirthPreviewView {
  const params = rebirthFormulaOf(content);
  const totalXp = totalXpOf(skills);
  return {
    totalXp,
    minProgress: params.minProgress,
    eligible: totalXp >= params.minProgress,
    gain: daoYunGainOf(params, totalXp),
  };
}

/* ---------- 天赋效果 → 聚合管线投影（单一来源，引擎与测试共用） ---------- */

/**
 * 已点亮天赋 → 常驻贡献：effect 逐条产出 Contribution（来源 kind=talent），
 * 一律走 ADR-011 聚合管线（禁绕管直改）。
 * 孤儿 id（内容包已移除节点）防御性跳过——存档不炸，效果自然消失。
 * 引擎内 playerContributions 与测试/第二题材验证共用本实现（无第二份投影）。
 */
export function talentContributionsOf(
  content: GameContent,
  purchasedIds: readonly string[],
): Contribution[] {
  const out: Contribution[] = [];
  for (const nodeId of purchasedIds) {
    const node = talentNodeOf(content, nodeId);
    if (!node) continue; // 孤儿引用：静默跳过（bad save 防御路径）
    const source = {
      id: node.id,
      kind: 'talent',
      ...(node.name !== undefined ? { name: node.name } : {}),
    };
    for (const effect of node.effects ?? []) {
      out.push({ modifier: effect, source });
    }
  }
  return out;
}

/**
 * 天赋节点购买门控（引擎单一来源，N4 收敛）：exists/owned/prereqMissing/
 * affordable 四态与引擎 talent:buy 判定同式同源，UI 锁定态展示禁另写比较式
 * （shopAffordOf 先例）。
 */
export interface TalentGateView {
  /** 节点不存在于当前包（孤儿 id）。 */
  readonly exists: boolean;
  readonly owned: boolean;
  /** 前置未点亮（requires 逐一对照已点亮集）。 */
  readonly prereqMissing: boolean;
  /** 道韵余额足额（与 talent:buy 的 no-daoyun 判定同式）。 */
  readonly affordable: boolean;
}

export function talentGateOf(
  content: GameContent,
  daoYun: number,
  purchasedIds: readonly string[],
  nodeId: string,
): TalentGateView {
  const node = talentNodeOf(content, nodeId);
  if (!node) {
    return { exists: false, owned: false, prereqMissing: false, affordable: false };
  }
  const owned = purchasedIds.includes(nodeId);
  return {
    exists: true,
    owned,
    prereqMissing: !owned && (node.requires ?? []).some((req) => !purchasedIds.includes(req)),
    affordable: daoYun >= node.cost,
  };
}

/* ---------- 解锁表（道韵门槛 → 新内容，门控判定单一来源） ---------- */

/** 解锁门控视图：锁定判定与展示所需道韵（与引擎判定同源，UI 禁复制门槛式）。 */
export interface RebirthGateView {
  /** 累计道韵不足 → 锁定（引擎 dispatch 拒绝同一公式）。 */
  readonly locked: boolean;
  /** 展示用最低累计道韵（目标被多条登记时取最高门槛；未登记 = 0）。 */
  readonly requiredDaoYun: number;
}

/**
 * 解锁门控（引擎单一来源）：按**累计道韵**判定（只增不减——花掉的道韵
 * 不回锁）。目标未登记 = 不设门槛（放行）；同目标重复登记由包校验拒绝，
 * 引擎侧取最高门槛兜底（防御路径不崩）。
 */
export function rebirthGateOf(
  content: GameContent,
  daoYunEarned: number,
  target: { readonly enemyId?: string; readonly skillId?: string },
): RebirthGateView {
  let required = 0;
  for (const unlock of rebirthOf(content)?.unlocks ?? []) {
    const threshold = unlock.requires?.daoYun;
    if (typeof threshold !== 'number' || !Number.isFinite(threshold)) continue;
    const hit =
      (target.enemyId !== undefined && unlock.enemies?.includes(target.enemyId) === true) ||
      (target.skillId !== undefined && unlock.skills?.includes(target.skillId) === true);
    if (hit && threshold > required) required = threshold;
  }
  return { locked: daoYunEarned < required, requiredDaoYun: required };
}

/* ---------- 境界词表（B2 收编：词表归 content，引擎只保留查表机制） ---------- */

/**
 * 斗法层数 → 境界称号：取 level ≤ 斗法层数的最后一档（数组顺序无关），
 * 无命中回退第一档（旧版 js/game.js:179-183 语义）；缺词表/空表 = undefined
 * （壳不显示境界，词表零默认，ADR-016 延伸）。
 */
export function realmOf(content: GameContent, combatLevel: number): string | undefined {
  const realms = rebirthOf(content)?.realms ?? [];
  if (realms.length === 0) return undefined;
  let current: RealmDefView = realms[0]!;
  for (const realm of realms) {
    if (typeof realm.level === 'number' && combatLevel >= realm.level) current = realm;
  }
  return typeof current.name === 'string' && current.name.length > 0 ? current.name : undefined;
}

/* ---------- 兵解结算（清单语义：引擎逐键解释，未知键防御性忽略） ---------- */

/**
 * 重置集键域（引擎注册表闭集）：content 包侧由语义校验对照同值注册表收口
 * （schema 只钉字符串形态，#021/#25 先例）；引擎侧此表为执行面镜像 +
 * applyRebirthReset 的逐键解释依据。未登记键不重置（default-keep，
 * 兵解不吞资产，未来新键安全）。
 */
const RESET_KEYS: ReadonlySet<string> = new Set(['skills', 'items', 'gold', 'buffs', 'lastEncounter']);

/**
 * 保留集键域：gear = 装备实例仓库（佩戴表 equips 与 uid 序列器 gearSeq
 * 语义随动保留——实例在，佩戴状态与 uid 唯一性就必须保）。
 */
const KEEP_KEYS: ReadonlySet<string> = new Set(['gear']);

export { RESET_KEYS, KEEP_KEYS };

/**
 * 兵解结算的状态清洗（rebirth:perform 消费）：按 content 声明的重置集逐键
 * 清零，保留集（及未登记键）原样保留；活动/战斗/气血等瞬态由调用方统一
 * 清空回满（非资产，不进清单）。
 */
export function applyRebirthReset(
  section: RebirthSectionView,
  state: {
    gold: number;
    items: Record<string, number>;
    skills: Record<string, { xp: number }>;
    buffs: Record<string, number>;
    lastEncounter: Record<string, unknown>;
  },
): void {
  const reset = new Set(section.reset ?? []);
  if (reset.has('skills')) {
    for (const progress of Object.values(state.skills)) progress.xp = 0;
  }
  if (reset.has('items')) {
    for (const key of Object.keys(state.items)) delete state.items[key];
  }
  if (reset.has('gold')) state.gold = 0;
  if (reset.has('buffs')) {
    for (const key of Object.keys(state.buffs)) delete state.buffs[key];
  }
  if (reset.has('lastEncounter')) {
    for (const key of Object.keys(state.lastEncounter)) delete state.lastEncounter[key];
  }
  // keep 清单由引擎绑定保留语义（gear 保留 = 实例/佩戴表/序列器原样）；
  // 此处无动作，KEEP_KEYS 仅作为校验注册表与文档面。
}

/* ---------- 天赋新增 stat 消费点：采集速度 / 离线上限 ---------- */

/**
 * 采集速度倍率（gatherSpeed 消费点，乘法区基线 1）：有效轮间隔 =
 * 基础间隔 ÷ 速度。速度 ≤ 0（负 flat 叠满）= 采集冻结（内容的选择，
 * 不崩）；基线 1 = 行为与历史版本完全一致。
 */
export function gatherSpeedOf(contributions: readonly Contribution[]): number {
  return aggregateStats({ gatherSpeed: 1 }, contributions, {}).gatherSpeed?.value ?? 1;
}

/** 有效采集轮间隔（毫秒）：间隔缩放的单一来源（在线/离线/快照投影同调）。 */
export function effectiveIntervalOf(baseInterval: number, speed: number): number {
  if (!(speed > 0)) return Number.POSITIVE_INFINITY;
  return baseInterval / speed;
}

/**
 * 离线结算时长上限（offlineCap 消费点，flat 毫秒累计）：走 aggregateStats
 * 统一管线（条件感知：带 condition 的贡献在无语境时不命中——与
 * gatherSpeedOf/xpMultOf 同律），取 flat 区合计（base 0）；Σ ≤ 0 = 不设限
 * （基线行为不变）；内容声明上限后超出部分不入账（离线上限的语义本体）。
 */
export function offlineCapOf(contributions: readonly Contribution[]): number {
  return aggregateStats({ offlineCap: 0 }, contributions, {}).offlineCap?.flat ?? 0;
}

/**
 * 全经验倍率（xpMult 消费点，乘法区基线 1）：grantExp 单点消费，
 * gather/craft/combat/离线同路（与 gatherXp 采集特化倍率叠乘）。
 */
export function xpMultOf(contributions: readonly Contribution[]): number {
  return aggregateStats({ xpMult: 1 }, contributions, {}).xpMult?.value ?? 1;
}
