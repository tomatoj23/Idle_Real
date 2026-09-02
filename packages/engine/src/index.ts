export { createGame } from './game.js';
export type { CreateGameOptions, Game } from './game.js';
export { ManualClock, realClock } from './clock.js';
export { EventBus } from './events.js';
export type { EventListener } from './events.js';

// 进度曲线（issue #3）
export {
  MAX_LEVEL,
  HP_BASE,
  HP_PER_LEVEL,
  HP_REGEN_FRACTION_PER_SEC,
  expBase,
  expToNext,
  levelFromXp,
  maxHpForLevel,
} from './progression.js';

// 随机源（ADR-013）
export { createRng } from './rng.js';
export type { SeededRng } from './rng.js';

// 存档适配层（issue #3）
export { attachAutoSave, localStorageSaveAdapter, memorySaveAdapter } from './save.js';
export type { AutoSaveHandle, SaveAdapter } from './save.js';

// 内容包结构视图与状态树（issue #3）
export {
  combatLevelOf,
  combatTextOf,
  enemiesOf,
  findActivity,
  findEnemy,
  findGearDrop,
  findItem,
  findShopEntry,
  findSkill,
  gearDropsOf,
  itemsOf,
  playerMaxHp,
  shopOf,
  slotsOf,
  skillsOf,
} from './contentView.js';
export type {
  ActivityView,
  ByproductView,
  EnemyDropView,
  EnemyView,
  GearDropView,
  ItemBonusesView,
  ItemEffectView,
  ItemView,
  ShopEntryView,
  SkillView,
  SlotView,
  StackView,
} from './contentView.js';
export { cloneState, initialState, restoreState } from './state.js';
export type { ActivityState, CombatState, GameState, SkillProgress } from './state.js';

export type {
  Clock,
  GameAction,
  GameContent,
  GameEvent,
  PlayerStatsView,
  SaveData,
} from './types.js';

// 战斗机制与装备实例（issue #4）
export {
  AUTO_EAT_HP_FRACTION,
  CRIT_CAP,
  CRIT_MULTIPLIER,
  CRITICAL_HP_FRACTION,
  DEFENSE_K,
  DAMAGE_VARIANCE,
  LOW_HP_FRACTION,
  PLAYER_ATTACK_INTERVAL,
  VICTORY_REST_MS,
  calcDmg,
  compareEncounterText,
  emptyTally,
  extractMoveName,
  hitTierOf,
  isCriticalHp,
  makeAttackText,
  pickText,
  rollCrit,
  summarizeRounds,
} from './combat.js';
export type {
  AttackTextArgs,
  CombatTextPools,
  DamageTier,
  EncounterRecord,
  RoundTally,
} from './combat.js';
export {
  AFFIX_POOL,
  RARITIES,
  RARITY_ORDER,
  gearContributions,
  gearName,
  gearSell,
  makeGear,
  rollRarity,
} from './gear.js';
export type { Affix, AffixDef, GearInstance, Rarity, RarityDef } from './gear.js';

// 修饰符聚合管线（issue #13，ADR-011）
export { aggregateStat, aggregateStats, conditionMatches } from './modifiers.js';
export type {
  AggregationContext,
  AppliedContribution,
  Contribution,
  Modifier,
  ModifierCondition,
  ModifierSource,
  ModifierZone,
  StatBreakdown,
} from './modifiers.js';
