/**
 * 秘境分层爬塔（#7）。
 *
 * 引擎零内容感知：dungeons 节按约定形状读取（contentView/rebirth 同款
 * 安全兜底），缺节 = 该题材无秘境玩法（dungeonsOf 返回空表，消费点静默降级）。
 *
 * 归属划界（ADR-017：机制归引擎，参数归 content）：
 * - 机制归引擎：层序列战斗（胜利推进/败退离境）、层表解析、层敌人加权
 *   抽取、层倍率投影、进入门控判定、最高层记录（state.dungeonBest）；
 * - 参数归 content：秘境定义（floors/entry/layers）、敌人权重、层数倍率、
 *   层奖励（gold/daoYun/items）、推荐战力区间（软提示字段，引擎不消费）。
 *
 * 与转生联动（票面）：层奖励 daoYun 入账走 daoYun + daoYunEarned 双键
 * （与 rebirth 同律——花掉不回锁），深层秘境为兵解提供动力。
 */

import type { GameContent } from './types.js';
import { findEnemy, type EnemyView } from './contentView.js';

/* ---------- 内容视图（按形状读取，缺节/缺字段安全兜底） ---------- */

/** 层数段/推荐战力区间（min ≤ max，方向性由包校验保证）。 */
export interface DungeonFloorRangeView {
  readonly min: number;
  readonly max: number;
}

/** 层敌人权重行：enemy 引用包内 enemies 节（包校验 xref）。 */
export interface DungeonEnemyEntryView {
  readonly enemy: string;
  readonly weight: number;
}

/** 层奖励：通关该层时入账（每轮推塔重复可得——挂机长线消耗方）。 */
export interface DungeonRewardView {
  readonly gold?: number;
  readonly daoYun?: number;
  readonly items?: readonly { readonly item: string; readonly count: number }[];
}

/** 层数倍率：相对敌人定义值的缩放（缺省字段 = 原值）。 */
export interface DungeonMultView {
  readonly hp?: number;
  readonly atk?: number;
  readonly def?: number;
  readonly gold?: number;
  readonly exp?: number;
}

/** 层表行：层数段 + 敌人权重池 + 倍率 + 层奖励 + 推荐战力（软提示）。 */
export interface DungeonLayerView {
  readonly floor: DungeonFloorRangeView;
  readonly enemies: readonly DungeonEnemyEntryView[];
  readonly mult?: DungeonMultView;
  readonly rewards?: DungeonRewardView;
  readonly recommendedPower?: DungeonFloorRangeView;
}

/** 进入条件（皆可选，缺省 = 自由进入）：道韵门槛（按累计道韵）/ 钥匙道具（须持有）。 */
export interface DungeonEntryView {
  readonly daoYun?: number;
  readonly key?: string;
}

/** 秘境定义（content 包 dungeons 节条目）。 */
export interface DungeonView {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  /** 总层数：攻略生命周期（层表须覆盖 1..floors，包校验强制）。 */
  readonly floors: number;
  readonly entry?: DungeonEntryView;
  readonly layers: readonly DungeonLayerView[];
}

/** 秘境列表：缺节/形状非法 → 空表（安全兜底，绝不因内容缺失崩溃）。 */
export function dungeonsOf(content: GameContent): readonly DungeonView[] {
  const dungeons = (content as { dungeons?: unknown }).dungeons;
  return Array.isArray(dungeons) ? (dungeons as DungeonView[]) : [];
}

/** 按秘境 id 取定义；未注册（坏引用/包变更）返回 undefined。 */
export function findDungeon(content: GameContent, dungeonId: string): DungeonView | undefined {
  return dungeonsOf(content).find((dungeon) => dungeon.id === dungeonId);
}

/**
 * 层表解析：返回 floor 命中的第一行（min ≤ floor ≤ max）。
 * 覆盖完整性由包校验把关；运行时未命中（防御路径）返回 undefined。
 */
export function dungeonLayerOf(dungeon: DungeonView, floor: number): DungeonLayerView | undefined {
  for (const layer of dungeon.layers ?? []) {
    const { min, max } = layer?.floor ?? {};
    if (typeof min === 'number' && typeof max === 'number' && floor >= min && floor <= max) {
      return layer;
    }
  }
  return undefined;
}

/**
 * 层数倍率投影（引擎单一来源，战斗结算与 UI 展示同调，禁壳内复制缩放式）：
 * 层表 mult 逐字段投影到敌人定义（round 取整，hp/atk 下限 1）；未声明字段
 * = 原值。返回新视图，不污染内容包；秘境/敌人未注册（防御路径）返回 undefined。
 */
export function dungeonFloorEnemyOf(
  content: GameContent,
  dungeonId: string,
  floor: number,
  enemyId: string,
): EnemyView | undefined {
  const dungeon = findDungeon(content, dungeonId);
  const base = findEnemy(content, enemyId);
  if (!dungeon || !base) return undefined;
  const mult = dungeonLayerOf(dungeon, floor)?.mult ?? {};
  const apply = (value: number, m: number | undefined, min: number): number =>
    m !== undefined && Number.isFinite(m) && m > 0 ? Math.max(min, Math.round(value * m)) : value;
  return {
    ...base,
    hp: apply(base.hp, mult.hp, 1),
    atk: apply(base.atk, mult.atk, 1),
    def: apply(base.def, mult.def, 0),
    gold: base.gold
      ? { min: apply(base.gold.min, mult.gold, 0), max: apply(base.gold.max, mult.gold, 0) }
      : base.gold,
    exp: apply(base.exp, mult.exp, 0),
  };
}

/**
 * 层敌人加权抽取（随机一律走注入 RNG，ADR-013）：权重行按占比归一化掷点；
 * 权重全非法/敌人全缺失 → undefined（调用方安全离境，绝不抛错）。
 */
export function pickDungeonEnemyOf(
  content: GameContent,
  dungeon: DungeonView,
  floor: number,
  random: () => number,
): EnemyView | undefined {
  const layer = dungeonLayerOf(dungeon, floor);
  const valid: Array<{ enemy: EnemyView; weight: number }> = [];
  for (const entry of layer?.enemies ?? []) {
    const weight = entry?.weight;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) continue;
    const enemy = findEnemy(content, entry.enemy);
    if (enemy) valid.push({ enemy, weight });
  }
  if (valid.length === 0) return undefined;
  const total = valid.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of valid) {
    roll -= entry.weight;
    if (roll < 0) return entry.enemy;
  }
  return valid[valid.length - 1]!.enemy; // 浮点末端兜底：取最后一项
}

/* ---------- 进入门控（判定侧单一来源，N1/N4 收敛先例） ---------- */

/** 进入门控视图：锁定判定与展示所需门槛（与引擎 dungeon:enter 判定同源）。 */
export interface DungeonGateView {
  /** 累计道韵不足或钥匙未持 → 锁定（引擎 dungeon:enter 拒绝同一判定）。 */
  readonly locked: boolean;
  /** 锁因归一（#7 评审收敛）：true = 道韵维度未过（locked 文案槽 {daoYun}）；false 且 locked = 钥匙维度（no-key 文案槽 {item}）。 */
  readonly daoYunLocked: boolean;
  /** 展示用最低累计道韵（entry.daoYun；未登记 = 0）。 */
  readonly requiredDaoYun: number;
  /** 钥匙道具 id（entry.key；未登记 = undefined）。 */
  readonly keyItem?: string;
  /** 钥匙持有判定（未登记钥匙 = true）。 */
  readonly keyOwned: boolean;
}

/**
 * 秘境进入门控（引擎单一来源）：UI 锁定态展示一律调此函数，禁另写比较式
 * （enemyGateOf/rebirthGateOf 同款收敛）。秘境未注册按锁定兜底（渲染防御
 * 路径，与 dispatch 侧 not-found 兜底语义一致）。
 */
export function dungeonGateOf(
  content: GameContent,
  dungeonId: string,
  ctx: { readonly daoYunEarned: number; readonly items: Readonly<Record<string, number>> },
): DungeonGateView {
  const dungeon = findDungeon(content, dungeonId);
  if (!dungeon) {
    return { locked: true, daoYunLocked: false, requiredDaoYun: 0, keyOwned: false };
  }
  const rawDaoYun = dungeon.entry?.daoYun;
  const requiredDaoYun =
    typeof rawDaoYun === 'number' && Number.isFinite(rawDaoYun) && rawDaoYun > 0 ? rawDaoYun : 0;
  const rawKey = dungeon.entry?.key;
  const keyItem = typeof rawKey === 'string' && rawKey.length > 0 ? rawKey : undefined;
  const keyOwned = keyItem === undefined || (ctx.items[keyItem] ?? 0) >= 1;
  const daoYunLocked = ctx.daoYunEarned < requiredDaoYun;
  return {
    locked: daoYunLocked || !keyOwned,
    daoYunLocked,
    requiredDaoYun,
    ...(keyItem !== undefined ? { keyItem } : {}),
    keyOwned,
  };
}
