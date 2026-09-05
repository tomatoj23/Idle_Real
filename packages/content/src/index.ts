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
} from './schema/index.js';
export type {
  ContentError,
  ValidationResult,
  JsonSchema,
  PackValidationResult,
} from './schema/index.js';

// 下面的类型清单与 src/schema/index.ts 保持一致（新增类型两处同步）：
// 主入口刻意不复用 `export *`，以便导出面恒为纯协议、可被测试守卫断言。
export type {
  Activity,
  Affinities,
  AffixDef,
  Bonuses,
  Byproduct,
  CombatText,
  Config,
  ContentPack,
  DamageTier,
  Element,
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
  PillEffect,
  PillMultipliers,
  Range,
  RarityDef,
  Recipe,
  ShopEntry,
  Skill,
  SkillKind,
  SlotDef,
  Stack,
  TextsSection,
  VerbEntry,
  VerbStyle,
} from './schema/index.js';
