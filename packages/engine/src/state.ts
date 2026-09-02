/**
 * 状态树（issue #3 起步，issue #4 扩展战斗与装备）：
 * skills（修为）/ items（乾坤袋）/ gp（灵石）+ 活动进度、气血、RNG 种子
 * + 装备实例（gear/equips/gearSeq）、丹药 buff（buffs）、战斗态（combat）、
 * 同对手对照（lastEncounter）。
 *
 * ADR-013：未显式写入的字段不落盘——恢复时只按已知键规范化收编；
 * 未知顶层键透明透传（向后兼容未来节的存档）。
 */
import type { GameContent, SaveData } from './types.js';
import { findActivity, findEnemy, findItem, playerMaxHp, skillsOf } from './contentView.js';
import { RARITIES, type Affix, type GearInstance, type Rarity } from './gear.js';
import type { DamageTier, EncounterRecord, RoundTally } from './combat.js';
import type { Contribution } from './modifiers.js';

export interface SkillProgress {
  xp: number;
}

export interface ActivityState {
  skillId: string;
  index: number;
  /** 存档时的活动名：恢复时校验下标指向的活动与其一致（ADR-015 稳定引用；活动 id 待 #16 引入）。 */
  name: string;
  /** 当前轮已推进的毫秒数（断点续采/离线结算的基准）。 */
  progress: number;
}

/** 进行中的一场战斗（#4）。计时器与伤害构成累计随档保存，中断可续。 */
export interface CombatState extends RoundTally {
  readonly enemyId: string;
  /** 敌方当前气血。 */
  ehp: number;
  /** 玩家攻击计时器（毫秒）。 */
  pt: number;
  /** 敌方攻击计时器（毫秒）。 */
  et: number;
  /** 胜利后休整倒计时（毫秒）。 */
  respT: number;
  tiers: Record<DamageTier, number>;
}

export interface GameState {
  /** 灵石。 */
  gp: number;
  /** 当前气血（上限由斗法修为推导，见 playerMaxHp，不落盘上限值）。 */
  hp: number;
  /** 乾坤袋：物品 id → 数量（不留 0 值键）。 */
  items: Record<string, number>;
  /** 修为：技能 id → 累计经验。 */
  skills: Record<string, SkillProgress>;
  /** 进行中的采集活动；null = 未修行。 */
  activity: ActivityState | null;
  /** PRNG 状态（确定性纪律：随机状态随档持久化）。 */
  rngSeed: number;
  /** 装备实例仓库（uid 常驻，含未佩戴）。 */
  gear: GearInstance[];
  /** uid 序列器。 */
  gearSeq: number;
  /** 佩戴表：槽位 id → uid（缺槽 = 未佩戴，不落盘）。 */
  equips: Record<string, number>;
  /** 丹药 buff：pill id → 过期游戏内时间（毫秒）。 */
  buffs: Record<string, number>;
  /** 进行中的战斗；null = 脱战。 */
  combat: CombatState | null;
  /** 自动再战。 */
  autoFight: boolean;
  /** 自动嗑丹（回气丹）。 */
  autoEat: boolean;
  /** 同对手上一战记录（对照语基准）。 */
  lastEncounter: Record<string, EncounterRecord>;
}

const RESERVED_KEYS = new Set([
  'gp', 'hp', 'items', 'skills', 'activity', 'rngSeed',
  'gear', 'gearSeq', 'equips', 'buffs', 'combat', 'autoFight', 'autoEat', 'lastEncounter',
]);

export function initialState(
  content: GameContent,
  seed: number,
  contributions: readonly Contribution[] = [],
): GameState {
  const skills: Record<string, SkillProgress> = {};
  for (const skill of skillsOf(content)) {
    skills[skill.id] = { xp: 0 };
  }
  return {
    gp: 0,
    hp: playerMaxHp(content, skills, contributions),
    items: {},
    skills,
    activity: null,
    rngSeed: seed >>> 0,
    gear: [],
    gearSeq: 0,
    equips: {},
    buffs: {},
    combat: null,
    autoFight: true,
    autoEat: true,
    lastEncounter: {},
  };
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 从存档恢复状态：已知键逐项校验规范化，未知键透传保留。
 * 形状/内容引用无效的活动直接弃置（内容包已变更时防崩）。
 */
export function restoreState(
  content: GameContent,
  save: SaveData,
  fallbackSeed: number,
  contributions: readonly Contribution[] = [],
): GameState {
  const raw = save.state;
  const seed = isObj(raw) ? safeNumber(raw.rngSeed, fallbackSeed) >>> 0 : fallbackSeed >>> 0;
  const state = initialState(content, seed, contributions);

  // 透明收编未知顶层键（跳过原型污染键），已知键随后覆盖。
  if (isObj(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (RESERVED_KEYS.has(key)) continue;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      (state as unknown as Record<string, unknown>)[key] = value;
    }
  }

  if (isObj(raw)) {
    state.gp = Math.max(0, Math.floor(safeNumber(raw.gp, 0)));
    const cap = playerMaxHp(content, state.skills, contributions);
    state.hp = Math.min(cap, Math.max(0, safeNumber(raw.hp, cap)));

    if (isObj(raw.items)) {
      for (const [id, count] of Object.entries(raw.items)) {
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
          state.items[id] = Math.floor(count);
        }
      }
    }

    if (isObj(raw.skills)) {
      for (const [id, progress] of Object.entries(raw.skills)) {
        // 只收编内容包已知技能；内容已移除的技能不入盘。
        if (!(id in state.skills) || !isObj(progress)) continue;
        const xp = progress.xp;
        if (typeof xp === 'number' && Number.isFinite(xp) && xp >= 0) {
          state.skills[id] = { xp };
        }
      }
    }

    const act = raw.activity;
    if (
      isObj(act) &&
      typeof act.skillId === 'string' &&
      typeof act.index === 'number' &&
      Number.isInteger(act.index) &&
      act.index >= 0 &&
      typeof act.name === 'string' &&
      typeof act.progress === 'number' &&
      Number.isFinite(act.progress) &&
      act.progress >= 0
    ) {
      // 稳定引用校验：下标指向的活动必须与存档记录同名，
      // 内容重排/改名时宁可弃置也不静默换目标（ADR-015）。
      const def = findActivity(content, act.skillId, act.index);
      if (def && def.activity.name === act.name) {
        state.activity = {
          skillId: act.skillId,
          index: act.index,
          name: act.name,
          progress: act.progress,
        };
      }
    }

    restoreCombatState(content, raw, state, save);
  }

  return state;
}

/** 装备/buff/战斗/对照的恢复规范化（issue #4；ADR-015 稳定引用逐键校验）。 */
function restoreCombatState(
  content: GameContent,
  raw: Record<string, unknown>,
  state: GameState,
  save: SaveData,
): void {
  // —— 装备实例：物品须存在且为 equip；稀有度非法降级寻常；词条逐条校验。
  if (Array.isArray(raw.gear)) {
    for (const entry of raw.gear) {
      if (!isObj(entry)) continue;
      const { uid, itemId } = entry;
      if (typeof uid !== 'number' || !Number.isInteger(uid) || uid <= 0) continue;
      if (typeof itemId !== 'string') continue;
      const item = findItem(content, itemId);
      if (!item || item.type !== 'equip') continue;
      const rarity: Rarity =
        typeof entry.rarity === 'string' && entry.rarity in RARITIES
          ? (entry.rarity as Rarity)
          : 'common';
      const affixes: Affix[] = [];
      if (Array.isArray(entry.affixes)) {
        for (const affix of entry.affixes) {
          if (!isObj(affix)) continue;
          if (typeof affix.name !== 'string' || typeof affix.stat !== 'string') continue;
          if (typeof affix.val !== 'number' || !Number.isFinite(affix.val) || affix.val <= 0) continue;
          affixes.push({ name: affix.name, stat: affix.stat, val: affix.val });
        }
      }
      state.gear.push({ uid, itemId, rarity, affixes });
    }
  }
  if (typeof raw.gearSeq === 'number' && Number.isFinite(raw.gearSeq) && raw.gearSeq >= 0) {
    state.gearSeq = Math.floor(raw.gearSeq);
  }
  for (const gear of state.gear) {
    state.gearSeq = Math.max(state.gearSeq, gear.uid);
  }

  // —— 佩戴表：uid 必须指向收编的实例，且槽位与装备定义一致。
  if (isObj(raw.equips)) {
    for (const [slot, uid] of Object.entries(raw.equips)) {
      if (typeof uid !== 'number' || !Number.isInteger(uid)) continue;
      const gear = state.gear.find((entry) => entry.uid === uid);
      if (!gear) continue;
      if (findItem(content, gear.itemId)?.slot !== slot) continue;
      state.equips[slot] = uid;
    }
  }

  // —— 丹药 buff：pill 须存在且有持续增益；已过期的不收编。
  if (isObj(raw.buffs)) {
    for (const [pillId, until] of Object.entries(raw.buffs)) {
      const item = findItem(content, pillId);
      if (!item || item.type !== 'pill' || item.effect === undefined) continue;
      if (typeof until === 'number' && Number.isFinite(until) && until > save.time) {
        state.buffs[pillId] = until;
      }
    }
  }

  // —— 战斗态：敌人须存在且战斗未结束（敌未死，或处于胜利休整期）；
  // 计时器/累计逐项钳非负。
  const c = raw.combat;
  if (
    isObj(c) &&
    typeof c.enemyId === 'string' &&
    findEnemy(content, c.enemyId) !== undefined &&
    typeof c.ehp === 'number' &&
    Number.isFinite(c.ehp) &&
    (c.ehp > 0 || (typeof c.respT === 'number' && Number.isFinite(c.respT) && c.respT > 0))
  ) {
    const tierOf = (value: unknown): number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    const tiers = c.tiers;
    state.combat = {
      enemyId: c.enemyId,
      ehp: c.ehp,
      pt: Math.max(0, safeNumber(c.pt, 0)),
      et: Math.max(0, safeNumber(c.et, 0)),
      respT: Math.max(0, safeNumber(c.respT, 0)),
      rounds: tierOf(c.rounds),
      crits: tierOf(c.crits),
      tiers: {
        light: isObj(tiers) ? tierOf(tiers.light) : 0,
        mid: isObj(tiers) ? tierOf(tiers.mid) : 0,
        heavy: isObj(tiers) ? tierOf(tiers.heavy) : 0,
        deadly: isObj(tiers) ? tierOf(tiers.deadly) : 0,
      },
    };
  }

  state.autoFight = typeof raw.autoFight === 'boolean' ? raw.autoFight : true;
  state.autoEat = typeof raw.autoEat === 'boolean' ? raw.autoEat : true;

  // —— 同对手对照：键须指向现存敌人；负/零回合记录无意义不收编。
  if (isObj(raw.lastEncounter)) {
    for (const [enemyId, rec] of Object.entries(raw.lastEncounter)) {
      if (!isObj(rec) || findEnemy(content, enemyId) === undefined) continue;
      const { rounds, won, at } = rec;
      if (
        typeof rounds === 'number' &&
        Number.isFinite(rounds) &&
        rounds > 0 &&
        typeof won === 'boolean' &&
        typeof at === 'number' &&
        Number.isFinite(at) &&
        at >= 0
      ) {
        state.lastEncounter[enemyId] = { rounds: Math.floor(rounds), won, at };
      }
    }
  }
}

/** 深拷贝状态树（snapshot 用；避免依赖 structuredClone 的 lib 约束）。 */
export function cloneState(state: GameState): GameState {
  const skills: Record<string, SkillProgress> = {};
  for (const [id, progress] of Object.entries(state.skills)) {
    skills[id] = { xp: progress.xp };
  }
  return {
    ...state,
    items: { ...state.items },
    skills,
    activity: state.activity ? { ...state.activity } : null,
    gear: state.gear.map((gear) => ({ ...gear, affixes: gear.affixes.map((affix) => ({ ...affix })) })),
    equips: { ...state.equips },
    buffs: { ...state.buffs },
    combat: state.combat ? { ...state.combat, tiers: { ...state.combat.tiers } } : null,
    lastEncounter: Object.fromEntries(
      Object.entries(state.lastEncounter).map(([id, rec]) => [id, { ...rec }]),
    ),
  };
}
