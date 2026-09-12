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
export { createRng, weightedPick } from './rng.js';
export type { SeededRng } from './rng.js';

// 存档适配层（issue #3）
export { attachAutoSave, localStorageSaveAdapter, memorySaveAdapter } from './save.js';
export type { AutoSaveHandle, SaveAdapter } from './save.js';

// 内容包结构视图与状态树（issue #3；稀有度/词条池视图 #018 批 1；参数视图 #020 批 3；
// 配方视图与炼制参数 #5）
export {
  BASE_COMBAT_PARAMS,
  BASE_CRAFT_PARAMS,
  BASE_GEAR_PARAMS,
  affixParamsOf,
  affixPoolOf,
  blanksOf,
  combatLevelOf,
  combatParamsOf,
  combatTextOf,
  craftMissingOf,
  craftParamsOf,
  craftSuccessRateOf,
  elementsOf,
  enemyGateOf,
  enemiesOf,
  findActivity,
  findBlank,
  findElementOf,
  findEnemy,
  findGearDrop,
  findInscription,
  findItem,
  findRarity,
  findRecipe,
  findShopEntry,
  findSkill,
  gearDropsOf,
  gearParamsOf,
  inscriptionsOf,
  itemsOf,
  playerMaxHp,
  powerOf,
  progressionParamsOf,
  raritiesOf,
  recipesOf,
  shopAffordOf,
  shopOf,
  signatureOf,
  slotsOf,
  skillsOf,
  textsOf,
  weaponSlotOf,
} from './contentView.js';
export type {
  ActivityView,
  AffixPoolView,
  BlankView,
  ByproductView,
  CombatParamsView,
  CraftParamsView,
  ElementSignatureView,
  ElementView,
  EnemyDropView,
  EnemyGateView,
  EnemyView,
  GearDropView,
  GearParamsView,
  InscriptionView,
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
export type {
  ActivityState,
  CombatState,
  CombatSummonState,
  DungeonState,
  GameState,
  SkillProgress,
} from './state.js';

export type {
  Clock,
  GameAction,
  GameContent,
  GameEvent,
  PlayerStatsView,
  SaveData,
} from './types.js';

// 战斗机制与装备实例（issue #4；机制参数化 #020：九常量清退为基线对象；
// 系别机制签名/亲和/风味句 #15）
export {
  BASE_DAMAGE_MECHANICS,
  ELEMENT_COMBAT_PRIMITIVES,
  affinityMultiplier,
  calcDmg,
  compareEncounterText,
  emptyTally,
  extractMoveName,
  fillTemplate,
  hitTierOf,
  isCriticalHp,
  makeAttackText,
  pickElementFlavor,
  pickText,
  rollCrit,
  summarizeRounds,
} from './combat.js';
export type {
  AttackTextArgs,
  CombatTextPools,
  DamageMechanics,
  DamageTier,
  ElementCombatPrimitive,
  ElementFlavorPools,
  EncounterRecord,
  RoundTally,
} from './combat.js';
export {
  BASE_AFFIX_PARAMS,
  gearContributions,
  gearName,
  gearSell,
  makeGear,
  makeInscribedGear,
  projectGearBase,
  rollGear,
  rollRarity,
} from './gear.js';
export type {
  Affix,
  AffixParams,
  GearDropContext,
  GearInscription,
  GearInstance,
  MakeGearOptions,
  MakeInscribedGearOptions,
  Rarity,
} from './gear.js';

// tag 倒排索引（#14，ADR-015 tags/flags 分工：归类批量捞）
export { buildTagIndex, queryByTag } from './tags.js';
export type { TaggedEntry } from './tags.js';

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
  talentGateOf,
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
  TalentGateView,
  TalentNodeView,
} from './rebirth.js';

// 秘境分层爬塔（#7：层序列战斗/层表投影/加权抽敌/进入门控）
export {
  dungeonFloorEnemyOf,
  dungeonGateOf,
  dungeonLayerOf,
  dungeonsOf,
  findDungeon,
  pickDungeonEnemyOf,
} from './dungeon.js';
export type {
  DungeonEnemyEntryView,
  DungeonEntryView,
  DungeonFloorRangeView,
  DungeonGateView,
  DungeonLayerView,
  DungeonMultView,
  DungeonRewardView,
  DungeonView,
} from './dungeon.js';

// Boss 战框架（#8：阶段脚本/阈值推进/阶段修正投影；#30：召唤原语）
export {
  bossEnemyOf,
  bossesOf,
  findBossOf,
  isLiveSummon,
  pickSummonEntry,
  summonMinionOf,
  summonPoolOf,
} from './bosses.js';
export type { BossPhaseView, BossSummonEntryView, BossSummonsView, BossView } from './bosses.js';

// 统计聚合器与成就判定器（#9：事件流累积 snapshot / 条件判定 / 进度投影）
export { STAT_KEYS, applyStatsEvent, restoreStats } from './stats.js';
export type { StatKey, StatSnapshot } from './stats.js';
export {
  achievementConditionMet,
  achievementProgressOf,
  achievementsOf,
} from './achievements.js';
export type {
  AchievementConditionView,
  AchievementProgressView,
  AchievementRewardView,
  AchievementView,
} from './achievements.js';

// 引擎版本（#12 版本策略：游戏内页脚版本行展示）
export { ENGINE_VERSION } from './version.js';
