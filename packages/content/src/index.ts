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
  Recipe,
  ShopEntry,
  Skill,
  SkillKind,
  SlotDef,
  Stack,
  VerbEntry,
  VerbStyle,
} from './types.js';
