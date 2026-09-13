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

// 关键词支持矩阵（#53）：界约束关键词子集单点声明 + oneOf 判别式单一解析。
export {
  KEYWORD_MATRIX,
  discriminatorOf,
  formAttrsOf,
  skeletonAttr,
} from './keywords.js';
export type {
  AttrFamily,
  ArrayFormAttrs,
  DictFormAttrs,
  EnforceRule,
  FormAttrsOf,
  KeywordRow,
  NumberFormAttrs,
  SkeletonPolicy,
  StringFormAttrs,
} from './keywords.js';

export { validateContentPack, formatContentErrors, sectionSchemas } from './pack.js';
export type { PackValidationResult, SectionSchemas } from './pack.js';

export type {
  AchievementCondition,
  AchievementDef,
  AchievementReward,
  Activity,
  Affinities,
  AffixDef,
  Bonuses,
  BossDef,
  BossPhase,
  BossSummonEntry,
  BossSummons,
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
  ElementFlavorPools,
  ElementSignature,
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
