/**
 * Boss 战框架（#8）：阶段脚本（血量阈值触发变招/狂暴/专属掉落）。
 *
 * 引擎零内容感知：bosses 节按约定形状读取（dungeon/rebirth 同款安全兜底），
 * 缺节 = 该包无 Boss 玩法（findBossOf 返回 undefined，一切消费点静默降级，
 * 普通敌人行为逐点不变）。
 *
 * 归属划界（ADR-017：机制归引擎，参数归 content）：
 * - 机制归引擎：阈值判定与阶段推进（跳级逐级补发事件/叙事）、阶段属性
 *   修正投影、bossPhase 随战斗态持久（再战重置归位）；
 * - 参数归 content：阶段数组（阈值/阶段名/属性修正/变招 moveKey/阶段叙事）、
 *   专属掉落表、召唤脚本（#30：池/数量/权重/属性缩放/叙事）。
 *
 * 召唤原语（#30）：阶段脚本 `summons` 声明召唤池（enemy xref + weight 权重 +
 * mult hp/atk/def 乘区）与数量 count；入场时按权重逐槽抽签（dungeon 加权抽敌
 * 同式），属性缩放投影走 summonMinionOf（bossEnemyOf 同式，禁第二份缩放式）。
 * 召唤物是战斗过程实体：无掉落/修为/击杀统计（Boss 本体收益已覆盖本场），
 * 死亡只清槽位；集火/清场语义归战斗状态机（game.ts）。
 *
 * 复合语义：Boss 阶段修正与秘境层倍率**叠乘**（先层倍率后阶段修正，
 * game.resolveEnemy 单点组合）——秘境深层插 Boss（#7/#8 联动）零特判。
 */

import type { GameContent } from './types.js';
import { findEnemy, type EnemyDropView, type EnemyView } from './contentView.js';
import { weightedPick } from './rng.js';

/** 乘区投影（阶段修正/召唤缩放共用单一来源）：非法乘数原值回落，round 取整钳下限。 */
function applyMult(value: number, m: number | undefined, min: number): number {
  return m !== undefined && Number.isFinite(m) && m > 0 ? Math.max(min, Math.round(value * m)) : value;
}

/* ---------- 内容视图（按形状读取，缺节/缺字段安全兜底） ---------- */

/** Boss 单个阶段（脚本行）：敌人血量比例 ≤ threshold 时进入。 */
export interface BossPhaseView {
  /** 血量比例阈值（0 < threshold < 1；逐级递减由包校验保证）。 */
  readonly threshold: number;
  /** 阶段名（boss:phase 事件载荷/壳徽标展示，content 数据）。 */
  readonly name?: string;
  /** 阶段属性修正（乘区；键域 atk/def/attackInterval 由 schema 钉死）。 */
  readonly mods?: {
    readonly atk?: number;
    readonly def?: number;
    readonly attackInterval?: number;
  };
  /** 变招：阶段内出招名注册键（combatText.moves 引用，包校验 xref）。 */
  readonly moveKey?: string;
  /** 阶段叙事池（进入该阶段时抽取一条播报，{enemy}/{phase} 槽）。 */
  readonly narration?: readonly string[];
  /** 召唤脚本（#30，可选）：进入该阶段时按池掷 count 个召唤物入场。 */
  readonly summons?: BossSummonsView;
}

/** 召唤池行（#30）：enemy 引用包内 enemies 节；weight 缺省 1；mult 属性乘区。 */
export interface BossSummonEntryView {
  readonly enemy: string;
  /** 抽签权重（正数；按占比归一化，缺省/非法 = 剔出有效池）。 */
  readonly weight?: number;
  /** 召唤物属性缩放（乘区；键域 hp/atk/def，缺省字段 = 敌人定义原值）。 */
  readonly mult?: {
    readonly hp?: number;
    readonly atk?: number;
    readonly def?: number;
  };
}

/** 阶段召唤脚本（#30）：入场时逐槽从 enemies 池按权重抽签召唤 count 个。 */
export interface BossSummonsView {
  /** 召唤数量（≥1；入场一次性召唤，本阶段不重复触发）。 */
  readonly count?: number;
  /** 召唤池（≥1 行；行内 enemy 重复由包校验拒绝）。 */
  readonly enemies?: readonly BossSummonEntryView[];
  /** 召唤转场叙事池（{enemy}/{phase} 槽，召唤入场时抽取一条播报）。 */
  readonly narration?: readonly string[];
}

/** Boss 定义（content 包 bosses 节条目）：enemy 引用包内 enemies 节条目。 */
export interface BossView {
  readonly enemy: string;
  readonly phases: readonly BossPhaseView[];
  /** 专属掉落表（victory 时与 enemy.drops 同机制叠加掷点）。 */
  readonly drops?: readonly EnemyDropView[];
}

/** Boss 列表：缺节/形状非法 → 空表（安全兜底，绝不因内容缺失崩溃）。 */
export function bossesOf(content: GameContent): readonly BossView[] {
  const bosses = (content as { bosses?: unknown }).bosses;
  return Array.isArray(bosses) ? (bosses as BossView[]) : [];
}

/** 按敌人 id 取 Boss 定义；未注册 = 普通敌人（undefined，零降级路径）。 */
export function findBossOf(content: GameContent, enemyId: string): BossView | undefined {
  return bossesOf(content).find((boss) => boss.enemy === enemyId);
}

/**
 * 阶段属性修正投影（引擎单一来源，战斗结算与壳展示同调，禁壳内复制缩放式）：
 * 阶段 mods 乘区叠到 base 视图（缺省 = 敌人定义原值；round 取整，atk 下限 1）。
 * phaseIndex 越界/负值/Boss 未注册 = undefined（调用方回落原视图，绝不崩）。
 * 不投影 hp/gold/exp：阶段是战斗过程修正，掉落与击杀收益不随阶段漂移。
 */
export function bossEnemyOf(
  content: GameContent,
  enemyId: string,
  phaseIndex: number,
  base?: EnemyView,
): EnemyView | undefined {
  const boss = findBossOf(content, enemyId);
  if (!boss || !Number.isInteger(phaseIndex) || phaseIndex < 0 || phaseIndex >= boss.phases.length) {
    return undefined;
  }
  const source = base ?? findEnemy(content, enemyId);
  if (!source) return undefined;
  const mods = boss.phases[phaseIndex]?.mods ?? {};
  return {
    ...source,
    atk: applyMult(source.atk, mods.atk, 1),
    def: applyMult(source.def, mods.def, 0),
    ...(source.attackInterval !== undefined
      ? { attackInterval: applyMult(source.attackInterval, mods.attackInterval, 1) }
      : {}),
  };
}

/** 该阶段召唤脚本的池行（形状非法/未声明 = 空池，召唤静默降级为零召唤）。 */
export function summonPoolOf(boss: BossView, phaseIndex: number): readonly BossSummonEntryView[] {
  const script = boss.phases[phaseIndex]?.summons;
  const pool = script?.enemies;
  return Array.isArray(pool) ? (pool as BossSummonEntryView[]) : [];
}

/**
 * 召唤物属性投影（#30，引擎单一来源，战斗结算与壳展示同调）：池行 mult
 * 乘区叠到 base 视图（缺省 = 敌人定义原值；round 取整，atk 下限 1）。
 * 投影按「召唤阶段 + 敌 id」现读 content（存档只存 {enemyId, phase, hp, et}，
 * 改包即生效，无第二份缓存）；阶段越界/池行缺失 = undefined（调用方清槽，
 * 绝不崩）。不投影 gold/exp/drops：召唤物无收益（Boss 本体战利品已覆盖本场）。
 */
export function summonMinionOf(
  content: GameContent,
  boss: BossView,
  phaseIndex: number,
  enemyId: string,
  base?: EnemyView,
): EnemyView | undefined {
  if (!Number.isInteger(phaseIndex) || phaseIndex < 0 || phaseIndex >= boss.phases.length) {
    return undefined;
  }
  const entry = summonPoolOf(boss, phaseIndex).find((row) => row?.enemy === enemyId);
  if (!entry) return undefined;
  const source = base ?? findEnemy(content, enemyId);
  if (!source) return undefined;
  const mult = entry.mult ?? {};
  return {
    ...source,
    hp: applyMult(source.hp, mult.hp, 1),
    atk: applyMult(source.atk, mult.atk, 1),
    def: applyMult(source.def, mult.def, 0),
  };
}

/**
 * 召唤池加权抽签（#30，与 dungeon 加权抽敌同一来源 weightedPick）：
 * weight 非法/敌不存在的行剔出有效池，按占比归一化掷点；全缺 = undefined
 * （本槽跳过，不崩）。
 */
export function pickSummonEntry(
  content: GameContent,
  pool: readonly BossSummonEntryView[],
  random: () => number,
): BossSummonEntryView | undefined {
  const valid = pool.filter((row) => findEnemy(content, row?.enemy ?? '') !== undefined);
  return weightedPick(valid, (row) => row.weight ?? 1, random);
}
