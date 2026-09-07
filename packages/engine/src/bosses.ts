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
 *   专属掉落表。召唤原语需多敌战斗状态机，本票不实施（裁决见票评）。
 *
 * 复合语义：Boss 阶段修正与秘境层倍率**叠乘**（先层倍率后阶段修正，
 * game.resolveEnemy 单点组合）——秘境深层插 Boss（#7/#8 联动）零特判。
 */

import type { GameContent } from './types.js';
import { findEnemy, type EnemyDropView, type EnemyView } from './contentView.js';

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
  const apply = (value: number, m: number | undefined, min: number): number =>
    m !== undefined && Number.isFinite(m) && m > 0 ? Math.max(min, Math.round(value * m)) : value;
  return {
    ...source,
    atk: apply(source.atk, mods.atk, 1),
    def: apply(source.def, mods.def, 0),
    ...(source.attackInterval !== undefined
      ? { attackInterval: apply(source.attackInterval, mods.attackInterval, 1) }
      : {}),
  };
}
