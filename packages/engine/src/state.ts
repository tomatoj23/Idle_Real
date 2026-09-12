/**
 * 状态树（issue #3 起步，issue #4 扩展战斗与装备）：
 * skills（修为）/ items（乾坤袋）/ gold（灵石）+ 活动进度、气血、RNG 种子
 * + 装备实例（gear/equips/gearSeq）、丹药 buff（buffs）、战斗态（combat）、
 * 同对手对照（lastEncounter）。
 *
 * ADR-013：未显式写入的字段不落盘——恢复时只按已知键规范化收编；
 * 未知顶层键透明透传（向后兼容未来节的存档）。
 */
import type { GameContent, SaveData } from './types.js';
import {
  combatParamsOf,
  findActivity,
  findBlank,
  findEnemy,
  findInscription,
  findItem,
  findRecipe,
  findSkill,
  playerMaxHp,
  raritiesOf,
  skillsOf,
} from './contentView.js';
import { findBossOf } from './bosses.js';
import { findDungeon } from './dungeon.js';
import { tierBoundsOf, type Affix, type GearInscription, type GearInstance, type Rarity } from './gear.js';
import type { DamageTier, EncounterRecord, RoundTally } from './combat.js';
import type { Contribution } from './modifiers.js';
import { restoreStats, type StatSnapshot } from './stats.js';

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
  /**
   * Boss 当前阶段下标（#8，-1 = 未入脚本阶段）：阈值推进随战斗态持久，
   * 自动再战重置归位（Boss 重生从头演阶段）；普通敌人恒 -1。
   */
  bossPhase: number;
  /**
   * 召唤物槽位（#30）：Boss 阶段脚本召唤的存活召唤物（先入先出 = 集火序）。
   * 数值不落盘（血量除外）——攻防按 {enemyId, phase} 现读 content 投影
   * （summonMinionOf）；Boss 死亡/再战/撤退一律清场。
   */
  summons: CombatSummonState[];
}

/** 召唤物槽位态（#30）：phase = 召唤它的阶段下标（投影定位），hp 随战斗演进。 */
export interface CombatSummonState {
  readonly enemyId: string;
  phase: number;
  /** 召唤物当前气血（投影上限随 content 现读，不落盘）。 */
  hp: number;
  /** 召唤物攻击计时器（毫秒）。 */
  et: number;
}

/**
 * 进行中的一次秘境攻略（#7）：瞬态——兵解/离线/内容包变更一律清空；
 * 最高层记录另存 state.dungeonBest（记录资产，default-keep）。
 */
export interface DungeonState {
  readonly dungeonId: string;
  /** 当前层（1 起）。 */
  floor: number;
}

export interface GameState {
  /** 灵石。 */
  gold: number;
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
  /** 消耗品 buff：consumable id → 过期游戏内时间（毫秒）。 */
  buffs: Record<string, number>;
  /** 进行中的战斗；null = 脱战。 */
  combat: CombatState | null;
  /** 自动再战。 */
  autoFight: boolean;
  /** 自动嗑丹（回气丹）。 */
  autoEat: boolean;
  /** 同对手上一战记录（对照语基准）。 */
  lastEncounter: Record<string, EncounterRecord>;
  /** 兵解次数（#6）。 */
  rebirths: number;
  /** 道韵余额（天赋购买消耗）。 */
  daoYun: number;
  /** 累计道韵（解锁门槛基准，只增不减——花掉的道韵不回锁）。 */
  daoYunEarned: number;
  /** 已点亮天赋节点 id（内容包 rebirth.talents 稳定引用，ADR-015）。 */
  talents: string[];
  /** 进行中的秘境攻略；null = 不在秘境（#7，瞬态）。 */
  dungeon: DungeonState | null;
  /** 秘境历史最高到达层：秘境 id → 层号（记录资产，兵解 default-keep，#7）。 */
  dungeonBest: Record<string, number>;
  /** 事件流累积统计（#9）：stat 键 = 引擎注册表闭集（records 资产，兵解 default-keep）。 */
  stats: StatSnapshot;
  /** 已解锁成就 id（内容包 achievements 稳定引用，ADR-015；记录资产，兵解 default-keep）。 */
  achievements: string[];
}

const RESERVED_KEYS = new Set([
  'gold', 'hp', 'items', 'skills', 'activity', 'rngSeed',
  'gear', 'gearSeq', 'equips', 'buffs', 'combat', 'autoFight', 'autoEat', 'lastEncounter',
  'rebirths', 'daoYun', 'daoYunEarned', 'talents', 'dungeon', 'dungeonBest',
  'stats', 'achievements',
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
  // 自动化开关缺省读 config.combat（#020：玩法缺省值归内容，引擎基线 true）。
  const cparams = combatParamsOf(content);
  return {
    gold: 0,
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
    autoFight: cparams.autoFight,
    autoEat: cparams.autoEat,
    lastEncounter: {},
    rebirths: 0,
    daoYun: 0,
    daoYunEarned: 0,
    talents: [],
    dungeon: null,
    dungeonBest: {},
    stats: {},
    achievements: [],
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
    state.gold = Math.max(0, Math.floor(safeNumber(raw.gold, 0)));

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

    // —— 气血钳制（#41）：必须在 skills 收编之后——cap 按恢复后的修为推算；
    // 先钳后收编会把高修为存档压回零修为基线（hp 恒 ≤112 的掩盖性 bug）。
    // 未写/非法 hp 缺省 = 按当前 cap 满血；佩戴/增益/天赋的投影上限由
    // game.ts 恢复后补钳兜底。
    const cap = playerMaxHp(content, state.skills, contributions);
    state.hp = Math.min(cap, Math.max(0, safeNumber(raw.hp, cap)));

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
      // 稳定引用校验：下标指向的目标必须与存档记录同名，
      // 内容重排/改名时宁可弃置也不静默换目标（ADR-015）。
      // craft 类技能的动作是 recipes（index = 包内 recipes 下标，#5）。
      const skill = findSkill(content, act.skillId);
      if (skill && skill.kind === 'craft') {
        const recipe = findRecipe(content, act.index);
        if (recipe && recipe.skill === skill.id && recipe.name === act.name) {
          state.activity = {
            skillId: act.skillId,
            index: act.index,
            name: act.name,
            progress: act.progress,
          };
        }
      } else {
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
    }

    restoreCombatState(content, raw, state, save);

    // —— 秘境最高层记录（#7）：键须指向现存秘境（包已变更的旧记录丢弃），
    // 数值钳非负；层号语义 = 「达到过」的最高层（进层即登记）。
    if (isObj(raw.dungeonBest)) {
      for (const [dungeonId, best] of Object.entries(raw.dungeonBest)) {
        if (
          typeof best === 'number' &&
          Number.isFinite(best) &&
          best >= 0 &&
          findDungeon(content, dungeonId) !== undefined
        ) {
          state.dungeonBest[dungeonId] = Math.floor(best);
        }
      }
    }
    // —— 秘境进行中（#7）：定义存在 + 层号合法 + 战斗在身才收编
    //（中途存档随战斗态一并续跑；战斗已散 = 攻略作废）。
    const run = raw.dungeon;
    if (
      isObj(run) &&
      typeof run.dungeonId === 'string' &&
      typeof run.floor === 'number' &&
      Number.isInteger(run.floor) &&
      run.floor >= 1 &&
      state.combat !== null
    ) {
      const dungeon = findDungeon(content, run.dungeonId);
      if (dungeon && run.floor <= dungeon.floors) {
        state.dungeon = { dungeonId: run.dungeonId, floor: run.floor };
      }
    }

    // —— 转生（#6）：数值钳非负有限；daoYunEarned 未落盘时以余额兜底
    //（旧档升级：解锁门槛不应低于当前余额）；talents 逐项字符串去重保序。
    state.rebirths = Math.max(0, Math.floor(safeNumber(raw.rebirths, 0)));
    state.daoYun = Math.max(0, safeNumber(raw.daoYun, 0));
    state.daoYunEarned = Math.max(0, Math.max(state.daoYun, safeNumber(raw.daoYunEarned, 0)));
    if (Array.isArray(raw.talents)) {
      const seen = new Set<string>();
      for (const id of raw.talents) {
        if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
          seen.add(id);
          state.talents.push(id);
        }
      }
    }

    // —— 统计快照（#9）：键域收口 + 数值钳非负整数（records 资产，default-keep）。
    state.stats = restoreStats(raw.stats);

    // —— 已解锁成就（#9）：id 稳定引用（ADR-15 同 talents 策略），逐项去重保序；
    // 内容包已移除的成就 id 原样保留（换包回装不重触发，解锁一次且仅一次）。
    if (Array.isArray(raw.achievements)) {
      const seen = new Set<string>();
      for (const id of raw.achievements) {
        if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
          seen.add(id);
          state.achievements.push(id);
        }
      }
    }
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
  // —— 装备实例：物品须存在且为 equip/器胚（#14）；稀有度须命中内容档位表，
  // 非法回退第一档（#018，ADR-016：词表零默认，引擎不持默认表）；词条逐条校验；
  // 铭纹（#14）逐条校验——id 须命中内容铭纹池（内容已移除的不收编），纹阶钳 1~3。
  const rarityTable = raritiesOf(content);
  const fallbackRarity: Rarity = rarityTable[0]?.id ?? '';
  if (Array.isArray(raw.gear)) {
    for (const entry of raw.gear) {
      if (!isObj(entry)) continue;
      const { uid, itemId } = entry;
      if (typeof uid !== 'number' || !Number.isInteger(uid) || uid <= 0) continue;
      if (typeof itemId !== 'string') continue;
      const item = findItem(content, itemId);
      if (!item || (item.type !== 'equip' && item.type !== 'blank')) continue;
      const rarity: Rarity =
        typeof entry.rarity === 'string' && rarityTable.some((def) => def.id === entry.rarity)
          ? entry.rarity
          : fallbackRarity;
      const affixes: Affix[] = [];
      if (Array.isArray(entry.affixes)) {
        for (const affix of entry.affixes) {
          if (!isObj(affix)) continue;
          if (typeof affix.name !== 'string' || typeof affix.stat !== 'string') continue;
          if (typeof affix.val !== 'number' || !Number.isFinite(affix.val) || affix.val <= 0) continue;
          affixes.push({ name: affix.name, stat: affix.stat, val: affix.val });
        }
      }
      const inscriptions: GearInscription[] = [];
      if (Array.isArray(entry.inscriptions)) {
        for (const inscription of entry.inscriptions) {
          if (!isObj(inscription)) continue;
          if (typeof inscription.id !== 'string') continue;
          if (
            typeof inscription.tier !== 'number' ||
            !Number.isInteger(inscription.tier) ||
            inscription.tier < 1 ||
            inscription.tier > 3
          ) {
            continue;
          }
          if (findInscription(content, inscription.id) === undefined) continue; // 稳定引用（ADR-015）
          // 纹阶按器胚 tierRange 钳制（天花板数据锁死：内容调窄后旧档超阶回落天花板）。
          const blankDef = findBlank(content, itemId);
          const [tMin, tMax] = blankDef ? tierBoundsOf(blankDef) : [1, 3];
          inscriptions.push({
            id: inscription.id,
            tier: Math.min(Math.max(inscription.tier, tMin), tMax),
          });
        }
      }
      state.gear.push({
        uid,
        itemId,
        rarity,
        affixes,
        ...(inscriptions.length > 0 ? { inscriptions } : {}),
      });
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

  // —— 消耗品 buff：consumable 须存在且有持续增益；已过期的不收编。
  if (isObj(raw.buffs)) {
    for (const [consumableId, until] of Object.entries(raw.buffs)) {
      const item = findItem(content, consumableId);
      if (!item || item.type !== 'consumable' || item.effect === undefined) continue;
      if (typeof until === 'number' && Number.isFinite(until) && until > save.time) {
        state.buffs[consumableId] = until;
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
    // Boss 阶段（#8）：数值钳 ≥ -1；Boss 定义已移除（包变更）→ 归位普通敌人。
    const rawPhase = c.bossPhase;
    const restoredPhase =
      typeof rawPhase === 'number' && Number.isFinite(rawPhase) && rawPhase >= -1
        ? Math.floor(rawPhase)
        : -1;
    const isBoss = findBossOf(content, c.enemyId) !== undefined;
    // 召唤物槽位（#30）：敌须存在、召唤阶段须仍在 Boss 脚本范围内（包变更缩表
    // → 槽位弃置）、血量须为正（死亡槽位不收编）；Boss 定义已移除 → 一并清场。
    const summons: CombatSummonState[] = [];
    if (isBoss && Array.isArray(c.summons)) {
      const bossDef = findBossOf(content, c.enemyId)!;
      for (const entry of c.summons) {
        if (!isObj(entry)) continue;
        if (typeof entry.enemyId !== 'string' || findEnemy(content, entry.enemyId) === undefined) {
          continue;
        }
        if (
          typeof entry.phase !== 'number' ||
          !Number.isInteger(entry.phase) ||
          entry.phase < 0 ||
          entry.phase >= bossDef.phases.length
        ) {
          continue;
        }
        if (typeof entry.hp !== 'number' || !Number.isFinite(entry.hp) || entry.hp <= 0) continue;
        summons.push({
          enemyId: entry.enemyId,
          phase: entry.phase,
          hp: entry.hp,
          et: Math.max(0, safeNumber(entry.et, 0)),
        });
      }
    }
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
      bossPhase: isBoss ? restoredPhase : -1,
      summons,
    };
  }

  // 存档未写该字段时回落 initialState 的 config 缺省值（#020）。
  state.autoFight = typeof raw.autoFight === 'boolean' ? raw.autoFight : state.autoFight;
  state.autoEat = typeof raw.autoEat === 'boolean' ? raw.autoEat : state.autoEat;

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
    gear: state.gear.map((gear) => ({
      ...gear,
      affixes: gear.affixes.map((affix) => ({ ...affix })),
      ...(gear.inscriptions
        ? { inscriptions: gear.inscriptions.map((inscription) => ({ ...inscription })) }
        : {}),
    })),
    equips: { ...state.equips },
    buffs: { ...state.buffs },
    combat: state.combat
      ? {
          ...state.combat,
          tiers: { ...state.combat.tiers },
          summons: state.combat.summons.map((minion) => ({ ...minion })),
        }
      : null,
    lastEncounter: Object.fromEntries(
      Object.entries(state.lastEncounter).map(([id, rec]) => [id, { ...rec }]),
    ),
    talents: [...state.talents],
    dungeon: state.dungeon ? { ...state.dungeon } : null,
    dungeonBest: { ...state.dungeonBest },
    stats: { ...state.stats },
    achievements: [...state.achievements],
  };
}
