export { validateContent } from './validate.js';
export type { ContentError, ValidationResult, JsonSchema } from './validate.js';

export {
  validateContentPack,
  loadDefaultContent,
  formatContentErrors,
} from './pack.js';
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
} from './types.js';
