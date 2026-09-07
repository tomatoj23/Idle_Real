/**
 * 协议层导出面（ADR-017 content 包拆分）。
 *
 * `src/schema/` = 通用协议：JSON Schema（*.schema.json）+ 类型（types.ts）
 * + 校验器（validate.ts / pack.ts）。本入口只暴露协议，零题材——
 * 题材内容一律走 `src/packs/`（如 `@wendao/content/packs/xiuxian`），
 * 框架不含缺省题材包（#23）。
 */

export { validateContent } from './validate.js';
export type { ContentError, ValidationResult, JsonSchema } from './validate.js';

export { validateContentPack, formatContentErrors } from './pack.js';
export type { PackValidationResult } from './pack.js';

export type {
  Activity,
  Affinities,
  AffixDef,
  Bonuses,
  Byproduct,
  CombatText,
  Config,
  ContentPack,
  CraftingConfig,
  DamageTier,
  DungeonDef,
  DungeonEnemyEntry,
  DungeonEntry,
  DungeonFloorRange,
  DungeonLayer,
  DungeonMult,
  DungeonReward,
  Element,
  ElementDef,
  Enemy,
  EnemyKind,
  Feature,
  GearDrop,
  Heal,
  InscriptionTiers,
  Item,
  ItemDrop,
  ItemType,
  Modifier,
  ModifierCondition,
  ModifierZone,
  ConsumableEffect,
  ConsumableMultipliers,
  Range,
  RarityDef,
  RealmDef,
  Recipe,
  RebirthFormula,
  RebirthSection,
  RebirthUnlock,
  ShellPageCraft,
  ShellTexts,
  ShopEntry,
  Skill,
  SkillKind,
  SlotDef,
  Stack,
  StatLabelDef,
  TalentNode,
  TextsSection,
  VerbEntry,
  VerbStyle,
} from './types.js';
