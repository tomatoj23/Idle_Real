/**
 * @wendao/content 主入口 = 协议层（ADR-017 content 包拆分，#23）。
 *
 * 只含通用协议：JSON Schema、类型定义、校验器。题材内容（修仙包）
 * 不在框架导出面——由游戏壳显式装配 `@wendao/content/packs/xiuxian`。
 */

export {
  validateContent,
  validateContentPack,
  formatContentErrors,
  sectionSchemas,
} from './schema/index.js';
// 注册表镜像（#75 项 3 对拍面）：与 engine 同名注册表同值闭集；导出面守卫
// （protocolGuard）钉两清单一致。
export {
  ELEMENT_COMBAT_PRIMITIVES,
  REBIRTH_KEEP_KEYS,
  REBIRTH_RESET_KEYS,
  STAT_KEYS,
} from './schema/index.js';
export type {
  ContentError,
  ValidationResult,
  JsonSchema,
  PackValidationResult,
  SectionSchemas,
} from './schema/index.js';

// 关键词支持矩阵（#53）：界约束关键词子集单点声明 + oneOf 判别式单一解析。
export {
  KEYWORD_MATRIX,
  discriminatorOf,
  formAttrsOf,
  skeletonAttr,
} from './schema/index.js';
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
} from './schema/index.js';

// 下面的类型清单与 src/schema/index.ts 保持一致（新增类型两处同步）：
// 主入口刻意不复用 `export *`，以便导出面恒为纯协议、可被测试守卫断言。
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
} from './schema/index.js';
