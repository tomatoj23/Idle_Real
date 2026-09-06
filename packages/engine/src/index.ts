export { createGame } from './game.js';
export type { CreateGameOptions, Game } from './game.js';
export { ManualClock, realClock } from './clock.js';
export { EventBus } from './events.js';
export type { EventListener } from './events.js';

// 进度曲线（issue #3；参数化 #020：BASE_PROGRESSION + 可选参数位）
export {
  BASE_PROGRESSION,
  expBase,
  expToNext,
  levelFromXp,
  maxHpForLevel,
} from './progression.js';
export type { ProgressionParams } from './progression.js';

// 随机源（ADR-013）
export { createRng } from './rng.js';
export type { SeededRng } from './rng.js';

// 存档适配层（issue #3）
export { attachAutoSave, localStorageSaveAdapter, memorySaveAdapter } from './save.js';
export type { AutoSaveHandle, SaveAdapter } from './save.js';

// 内容包结构视图与状态树（issue #3；稀有度/词条池视图 #018 批 1；参数视图 #020 批 3；
// 配方视图与炼制参数 #5）
export {
  BASE_COMBAT_PARAMS,
  BASE_CRAFT_PARAMS,
  affixParamsOf,
  affixPoolOf,
  combatLevelOf,
  combatParamsOf,
  combatTextOf,
  craftMissingOf,
  craftParamsOf,
  craftSuccessRateOf,
  enemyGateOf,
  enemiesOf,
  findActivity,
  findEnemy,
  findGearDrop,
  findItem,
  findRarity,
  findRecipe,
  findShopEntry,
  findSkill,
  gearDropsOf,
  itemsOf,
  playerMaxHp,
  progressionParamsOf,
  raritiesOf,
  recipesOf,
  shopAffordOf,
  shopOf,
  slotsOf,
  skillsOf,
  textsOf,
} from './contentView.js';
export type {
  ActivityView,
  AffixPoolView,
  ByproductView,
  CombatParamsView,
  CraftParamsView,
  EnemyDropView,
  EnemyGateView,
  EnemyView,
  GearDropView,
  ItemBonusesView,
  ItemEffectView,
  ItemView,
  RarityView,
  RecipeView,
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

// 战斗机制与装备实例（issue #4；机制参数化 #020：九常量清退为基线对象）
export {
  BASE_DAMAGE_MECHANICS,
  calcDmg,
  compareEncounterText,
  emptyTally,
  extractMoveName,
  fillTemplate,
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
  DamageMechanics,
  DamageTier,
  EncounterRecord,
  RoundTally,
} from './combat.js';
export {
  BASE_AFFIX_PARAMS,
  gearContributions,
  gearName,
  gearSell,
  makeGear,
  projectGearBase,
  rollRarity,
} from './gear.js';
export type { Affix, AffixParams, GearInstance, Rarity } from './gear.js';

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

// 转生结算框架（#6：兵解/道韵公式/天赋树投影/解锁门控/境界词表）
export {
  BASE_REBIRTH_FORMULA,
  applyRebirthReset,
  daoYunGainOf,
  effectiveIntervalOf,
  gatherSpeedOf,
  offlineCapOf,
  rebirthFormulaOf,
  rebirthGateOf,
  rebirthOf,
  rebirthPreviewOf,
  realmOf,
  talentContributionsOf,
  talentNodeOf,
  totalXpOf,
  xpMultOf,
} from './rebirth.js';
export type {
  RebirthFormulaParams,
  RebirthGateView,
  RebirthPreviewView,
  RebirthSectionView,
  RebirthUnlockView,
  RealmDefView,
  TalentNodeView,
} from './rebirth.js';
