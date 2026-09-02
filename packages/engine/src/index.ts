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
  findActivity,
  findItem,
  findShopEntry,
  findSkill,
  itemsOf,
  playerMaxHp,
  shopOf,
  skillsOf,
} from './contentView.js';
export type { ActivityView, ByproductView, ItemView, ShopEntryView, SkillView, StackView } from './contentView.js';
export { cloneState, initialState, restoreState } from './state.js';
export type { ActivityState, GameState, SkillProgress } from './state.js';

export type {
  Clock,
  GameAction,
  GameContent,
  GameEvent,
  SaveData,
} from './types.js';
