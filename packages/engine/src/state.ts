/**
 * 状态树（issue #3 起步，issue #4 扩展战斗与装备）：
 * skills（修为）/ items（乾坤袋）/ gold（灵石）+ 活动进度、气血、RNG 种子
 * + 装备实例（gear/equips/gearSeq）、丹药 buff（buffs）、战斗态（combat）、
 * 同对手对照（lastEncounter）。
 *
 * #42 字段表：GameState 每个持久字段的全部「存活」知识——缺省值
 * （initialState）、恢复守卫（restoreState）、深拷（cloneState）、透明区
 * 排除（RESERVED_KEYS）、兵解处置（reset/keep/transient）——收敛在 FIELDS
 * 一张描述表。映射类型把表键域钉死为 GameState 键域：接口加字段 = 表加
 * 一行（编译器强制同步），五处消费全链自动生效，「漏写一处」无处可藏。
 *
 * ADR-013：未显式写入的字段不落盘——恢复时只按已知键规范化收编；
 * 未知顶层键透明透传（向后兼容未来节的存档，字段表只管已知字段）。
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
import { findBossOf, isLiveSummon } from './bosses.js';
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

/* ---------- 字段描述表（#42：持久字段知识的单一声明点） ---------- */

/** 字段行的求值语境：声明序即依赖序——def 可读先行字段（hp ← skills）。 */
interface FieldEnv {
  readonly content: GameContent;
  readonly contributions: readonly Contribution[];
  /** 显式种子：initialState 的 rngSeed 缺省与 restore 的回退种子同源传入。 */
  readonly seed: number;
  /** restore 场景的存档原文（buffs 过期对照 save.time）；initialState 场景 = null。 */
  readonly save: SaveData | null;
  /** 构建中的状态骨架（def 声明序依赖的先行字段经此读取）。 */
  readonly partial: GameState;
}

interface FieldRow<K extends keyof GameState> {
  /** 缺省值（initialState 逐行求值；声明序依赖先行字段的缺省）。 */
  readonly def: (env: FieldEnv) => GameState[K];
  /** 深拷（cloneState 逐行调用；容器字段须逐层复制）。 */
  readonly clone: (value: GameState[K]) => GameState[K];
  /** 恢复守卫（restoreState 声明序逐行调用；非法/缺失保持缺省）。 */
  readonly restore: (raw: Record<string, unknown>, state: GameState, env: FieldEnv) => void;
  /**
   * 兵解处置（原 rebirth RESET/KEEP 注册表并入，#42 D2）：
   * 'reset' = 可入 content 重置集（须配 rebirthReset 逐键清零动作）；
   * 'keep' = 可入 content 保留集；
   * 'transient' = 兵解必清（rebirthClear 可选——hp 回满需完整属性投影，归 game.ts）；
   * 缺省 = 资产（default-keep，兵解不吞，content 不可声明）。
   */
  readonly rebirth?: 'reset' | 'keep' | 'transient';
  readonly rebirthReset?: (state: GameState) => void;
  readonly rebirthClear?: (state: GameState) => void;
}

/**
 * 字段描述表：键域被映射类型钉死为 GameState 全部键——接口加字段而表缺行
 * 即编译失败（反之亦然）。声明序 = 构建序 = 恢复序，依赖字段的先后在此可见：
 * skills 先于 hp（#41 钳制按收编后修为推 cap）、gear 先于 gearSeq/equips、
 * daoYun 先于 daoYunEarned、combat 先于 dungeon。
 */
const FIELDS: { [K in keyof GameState]: FieldRow<K> } = {
  rngSeed: {
    def: (env) => env.seed >>> 0,
    clone: (value) => value,
    restore: (raw, state, env) => {
      state.rngSeed = safeNumber(raw.rngSeed, env.seed) >>> 0;
    },
  },
  gold: {
    def: () => 0,
    clone: (value) => value,
    restore: (raw, state) => {
      state.gold = Math.max(0, Math.floor(safeNumber(raw.gold, 0)));
    },
    rebirth: 'reset',
    rebirthReset: (state) => {
      state.gold = 0;
    },
  },
  items: {
    def: () => ({}),
    clone: (value) => ({ ...value }),
    restore: (raw, state) => {
      if (!isObj(raw.items)) return;
      for (const [id, count] of Object.entries(raw.items)) {
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
          state.items[id] = Math.floor(count);
        }
      }
    },
    rebirth: 'reset',
    rebirthReset: (state) => {
      for (const key of Object.keys(state.items)) delete state.items[key];
    },
  },
  skills: {
    def: (env) => {
      const skills: Record<string, SkillProgress> = {};
      for (const skill of skillsOf(env.content)) {
        skills[skill.id] = { xp: 0 };
      }
      return skills;
    },
    clone: (value) =>
      Object.fromEntries(Object.entries(value).map(([id, progress]) => [id, { xp: progress.xp }])),
    restore: (raw, state) => {
      if (!isObj(raw.skills)) return;
      for (const [id, progress] of Object.entries(raw.skills)) {
        // 只收编内容包已知技能；内容已移除的技能不入盘。
        if (!(id in state.skills) || !isObj(progress)) continue;
        const xp = progress.xp;
        if (typeof xp === 'number' && Number.isFinite(xp) && xp >= 0) {
          state.skills[id] = { xp };
        }
      }
    },
    rebirth: 'reset',
    rebirthReset: (state) => {
      for (const progress of Object.values(state.skills)) progress.xp = 0;
    },
  },
  hp: {
    // 缺省 = 按（先行声明的）skills 缺省推算的满血。
    def: (env) => playerMaxHp(env.content, env.partial.skills, env.contributions),
    clone: (value) => value,
    restore: (raw, state, env) => {
      // —— 气血钳制（#41）：必须在 skills 收编之后——cap 按恢复后的修为推算；
      // 先钳后收编会把高修为存档压回零修为基线（hp 恒 ≤112 的掩盖性 bug）。
      // 未写/非法 hp 缺省 = 按当前 cap 满血；佩戴/增益/天赋的投影上限由
      // game.ts 恢复后补钳兜底。
      const cap = playerMaxHp(env.content, state.skills, env.contributions);
      state.hp = Math.min(cap, Math.max(0, safeNumber(raw.hp, cap)));
    },
    // 瞬态：兵解回满 = 按重算上限置满（需 game.ts 的完整属性投影，字段表外执行）。
    rebirth: 'transient',
  },
  activity: {
    def: () => null,
    clone: (value) => (value ? { ...value } : null),
    restore: (raw, state, env) => {
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
        const skill = findSkill(env.content, act.skillId);
        if (skill && skill.kind === 'craft') {
          const recipe = findRecipe(env.content, act.index);
          if (recipe && recipe.skill === skill.id && recipe.name === act.name) {
            state.activity = {
              skillId: act.skillId,
              index: act.index,
              name: act.name,
              progress: act.progress,
            };
          }
        } else {
          const def = findActivity(env.content, act.skillId, act.index);
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
    },
    // 瞬态：兵解散功，进度一并弃置（结算事件承载体，不另发 activity-stop）。
    rebirth: 'transient',
    rebirthClear: (state) => {
      state.activity = null;
    },
  },
  gear: {
    def: () => [],
    clone: (value) =>
      value.map((gear) => ({
        ...gear,
        affixes: gear.affixes.map((affix) => ({ ...affix })),
        ...(gear.inscriptions
          ? { inscriptions: gear.inscriptions.map((inscription) => ({ ...inscription })) }
          : {}),
      })),
    restore: (raw, state, env) => {
      // —— 装备实例：物品须存在且为 equip/器胚（#14）；稀有度须命中内容档位表，
      // 非法回退第一档（#018，ADR-016：词表零默认，引擎不持默认表）；词条逐条校验；
      // 铭纹（#14）逐条校验——id 须命中内容铭纹池（内容已移除的不收编），纹阶钳 1~3。
      const rarityTable = raritiesOf(env.content);
      const fallbackRarity: Rarity = rarityTable[0]?.id ?? '';
      if (Array.isArray(raw.gear)) {
        for (const entry of raw.gear) {
          if (!isObj(entry)) continue;
          const { uid, itemId } = entry;
          if (typeof uid !== 'number' || !Number.isInteger(uid) || uid <= 0) continue;
          if (typeof itemId !== 'string') continue;
          const item = findItem(env.content, itemId);
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
              if (findInscription(env.content, inscription.id) === undefined) continue; // 稳定引用（ADR-015）
              // 纹阶按器胚 tierRange 钳制（天花板数据锁死：内容调窄后旧档超阶回落天花板）。
              const blankDef = findBlank(env.content, itemId);
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
    },
    // 保留集：装备实例仓库（佩戴表 equips 与 uid 序列器 gearSeq 语义随动保留
    // ——实例在，佩戴状态与 uid 唯一性就必须保；两者不单独入声明域）。
    rebirth: 'keep',
  },
  gearSeq: {
    def: () => 0,
    clone: (value) => value,
    restore: (raw, state) => {
      if (typeof raw.gearSeq === 'number' && Number.isFinite(raw.gearSeq) && raw.gearSeq >= 0) {
        state.gearSeq = Math.floor(raw.gearSeq);
      }
      for (const gear of state.gear) {
        state.gearSeq = Math.max(state.gearSeq, gear.uid);
      }
    },
  },
  equips: {
    def: () => ({}),
    clone: (value) => ({ ...value }),
    restore: (raw, state, env) => {
      // —— 佩戴表：uid 必须指向收编的实例，且槽位与装备定义一致。
      if (!isObj(raw.equips)) return;
      for (const [slot, uid] of Object.entries(raw.equips)) {
        if (typeof uid !== 'number' || !Number.isInteger(uid)) continue;
        const gear = state.gear.find((entry) => entry.uid === uid);
        if (!gear) continue;
        if (findItem(env.content, gear.itemId)?.slot !== slot) continue;
        state.equips[slot] = uid;
      }
    },
  },
  buffs: {
    def: () => ({}),
    clone: (value) => ({ ...value }),
    restore: (raw, state, env) => {
      // —— 消耗品 buff：consumable 须存在且有持续增益；已过期的不收编。
      if (!isObj(raw.buffs)) return;
      for (const [consumableId, until] of Object.entries(raw.buffs)) {
        const item = findItem(env.content, consumableId);
        if (!item || item.type !== 'consumable' || item.effect === undefined) continue;
        if (typeof until === 'number' && Number.isFinite(until) && until > (env.save?.time ?? 0)) {
          state.buffs[consumableId] = until;
        }
      }
    },
    rebirth: 'reset',
    rebirthReset: (state) => {
      for (const key of Object.keys(state.buffs)) delete state.buffs[key];
    },
  },
  combat: {
    def: () => null,
    clone: (value) =>
      value
        ? {
            ...value,
            tiers: { ...value.tiers },
            summons: value.summons.map((minion) => ({ ...minion })),
          }
        : null,
    restore: (raw, state, env) => {
      // —— 战斗态：敌人须存在且战斗未结束（敌未死，或处于胜利休整期）；
      // 计时器/累计逐项钳非负。
      const c = raw.combat;
      if (
        isObj(c) &&
        typeof c.enemyId === 'string' &&
        findEnemy(env.content, c.enemyId) !== undefined &&
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
        const bossDef = findBossOf(env.content, c.enemyId);
        const isBoss = bossDef !== undefined;
        // 召唤物槽位（#30/#48）：有效性经 bosses.isLiveSummon 单一谓词判定
        //（敌存在 ∧ 阶段在脚本界内 ∧ 召唤池成员——池外槽 restore 即弃置，
        // 与运行时逐轮过滤同律）；血量须为正（死亡槽位不收编）；
        // Boss 定义已移除（包变更）→ 一并清场。
        const summons: CombatSummonState[] = [];
        if (bossDef !== undefined && Array.isArray(c.summons)) {
          for (const entry of c.summons) {
            if (!isObj(entry)) continue;
            if (typeof entry.enemyId !== 'string' || typeof entry.phase !== 'number') continue;
            if (typeof entry.hp !== 'number' || !Number.isFinite(entry.hp) || entry.hp <= 0) continue;
            if (!isLiveSummon(env.content, bossDef, { enemyId: entry.enemyId, phase: entry.phase })) continue;
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
    },
    // 瞬态：战斗随兵解散去。
    rebirth: 'transient',
    rebirthClear: (state) => {
      state.combat = null;
    },
  },
  autoFight: {
    // 自动化开关缺省读 config.combat（#020：玩法缺省值归内容，引擎基线 true）；
    // 存档未写该字段时保持 initialState 的 config 缺省值。
    def: (env) => combatParamsOf(env.content).autoFight,
    clone: (value) => value,
    restore: (raw, state) => {
      if (typeof raw.autoFight === 'boolean') state.autoFight = raw.autoFight;
    },
  },
  autoEat: {
    // 同 autoFight（#020）。
    def: (env) => combatParamsOf(env.content).autoEat,
    clone: (value) => value,
    restore: (raw, state) => {
      if (typeof raw.autoEat === 'boolean') state.autoEat = raw.autoEat;
    },
  },
  lastEncounter: {
    def: () => ({}),
    clone: (value) =>
      Object.fromEntries(Object.entries(value).map(([id, rec]) => [id, { ...rec }])),
    restore: (raw, state, env) => {
      // —— 同对手对照：键须指向现存敌人；负/零回合记录无意义不收编。
      if (!isObj(raw.lastEncounter)) return;
      for (const [enemyId, rec] of Object.entries(raw.lastEncounter)) {
        if (!isObj(rec) || findEnemy(env.content, enemyId) === undefined) continue;
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
    },
    rebirth: 'reset',
    rebirthReset: (state) => {
      for (const key of Object.keys(state.lastEncounter)) delete state.lastEncounter[key];
    },
  },
  rebirths: {
    def: () => 0,
    clone: (value) => value,
    restore: (raw, state) => {
      state.rebirths = Math.max(0, Math.floor(safeNumber(raw.rebirths, 0)));
    },
  },
  daoYun: {
    def: () => 0,
    clone: (value) => value,
    restore: (raw, state) => {
      state.daoYun = Math.max(0, safeNumber(raw.daoYun, 0));
    },
  },
  daoYunEarned: {
    def: () => 0,
    clone: (value) => value,
    restore: (raw, state) => {
      // daoYunEarned 未落盘时以余额兜底（旧档升级：解锁门槛不应低于当前余额）。
      state.daoYunEarned = Math.max(0, Math.max(state.daoYun, safeNumber(raw.daoYunEarned, 0)));
    },
  },
  talents: {
    def: () => [],
    clone: (value) => [...value],
    restore: (raw, state) => {
      // 逐项字符串去重保序。
      if (!Array.isArray(raw.talents)) return;
      const seen = new Set<string>();
      for (const id of raw.talents) {
        if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
          seen.add(id);
          state.talents.push(id);
        }
      }
    },
  },
  dungeon: {
    def: () => null,
    clone: (value) => (value ? { ...value } : null),
    restore: (raw, state, env) => {
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
        const dungeon = findDungeon(env.content, run.dungeonId);
        if (dungeon && run.floor <= dungeon.floors) {
          state.dungeon = { dungeonId: run.dungeonId, floor: run.floor };
        }
      }
    },
    // 瞬态：兵解攻略作废（dungeonBest 记录资产 default-keep 长存，#7）。
    rebirth: 'transient',
    rebirthClear: (state) => {
      state.dungeon = null;
    },
  },
  dungeonBest: {
    def: () => ({}),
    clone: (value) => ({ ...value }),
    restore: (raw, state, env) => {
      // —— 秘境最高层记录（#7）：键须指向现存秘境（包已变更的旧记录丢弃），
      // 数值钳非负；层号语义 = 「达到过」的最高层（进层即登记）。
      if (!isObj(raw.dungeonBest)) return;
      for (const [dungeonId, best] of Object.entries(raw.dungeonBest)) {
        if (
          typeof best === 'number' &&
          Number.isFinite(best) &&
          best >= 0 &&
          findDungeon(env.content, dungeonId) !== undefined
        ) {
          state.dungeonBest[dungeonId] = Math.floor(best);
        }
      }
    },
  },
  stats: {
    def: () => ({}),
    clone: (value) => ({ ...value }),
    restore: (raw, state) => {
      // —— 统计快照（#9）：键域收口 + 数值钳非负整数（records 资产，default-keep）。
      state.stats = restoreStats(raw.stats);
    },
  },
  achievements: {
    def: () => [],
    clone: (value) => [...value],
    restore: (raw, state) => {
      // —— 已解锁成就（#9）：id 稳定引用（ADR-15 同 talents 策略），逐项去重保序；
      // 内容包已移除的成就 id 原样保留（换包回装不重触发，解锁一次且仅一次）。
      if (!Array.isArray(raw.achievements)) return;
      const seen = new Set<string>();
      for (const id of raw.achievements) {
        if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
          seen.add(id);
          state.achievements.push(id);
        }
      }
    },
  },
};

const FIELD_KEYS = Object.keys(FIELDS) as readonly (keyof GameState)[];

/**
 * 驱动面视图（类型擦除）：映射类型已保证「表键域 = GameState 键域」逐键
 * 精确，三个驱动循环按键取行执行；联合键下逐行类型在此收敛为单一擦除点，
 * 字段知识本身仍全在表行内。
 */
type AnyFieldRow = FieldRow<keyof GameState>;
const rowOf = (key: keyof GameState): AnyFieldRow => FIELDS[key] as unknown as AnyFieldRow;

/** 透明区排除键（ADR-013）：= 字段表键域，表驱动。 */
const RESERVED_KEYS: ReadonlySet<string> = new Set<string>(FIELD_KEYS);

/**
 * 兵解重置集键域（#42 D2，原 rebirth.ts RESET_KEYS 并入）：由字段表
 * rebirth='reset' 行派生——content 包侧 schema 语义校验仍持同值镜像
 * （pack.ts，#021/#25 先例：schema 只钉字符串形态，跨包不引引擎）。
 */
export const RESET_KEYS: ReadonlySet<string> = new Set(
  FIELD_KEYS.filter((key) => FIELDS[key].rebirth === 'reset'),
);

/** 兵解保留集键域（原 rebirth.ts KEEP_KEYS 并入，同上派生）。 */
export const KEEP_KEYS: ReadonlySet<string> = new Set(
  FIELD_KEYS.filter((key) => FIELDS[key].rebirth === 'keep'),
);

/** 兵解重置动作面（rebirth.ts applyRebirthReset 逐键解释依据）：键 → 清零动作。 */
export const REBIRTH_RESET_ACTIONS: Readonly<Record<string, (state: GameState) => void>> =
  Object.fromEntries(
    FIELD_KEYS.filter((key) => FIELDS[key].rebirth === 'reset').map((key) => [
      key,
      FIELDS[key].rebirthReset as (state: GameState) => void,
    ]),
  );

// 表自检（#42 评审收口）：reset 行必须配清零动作、动作必须挂在 reset 行——
// 防止「键域已收录而兵解静默不重置」/「动作悬空永不执行」的表内错配。
// 表是引擎源内常量，错配属程序员错误，import 期 fail-fast。
for (const key of FIELD_KEYS) {
  const fieldRow = rowOf(key);
  if (fieldRow.rebirth === 'reset' && fieldRow.rebirthReset === undefined) {
    throw new Error(`FIELDS.${String(key)}: rebirth:'reset' 缺 rebirthReset 动作`);
  }
  if (fieldRow.rebirth !== 'reset' && fieldRow.rebirthReset !== undefined) {
    throw new Error(`FIELDS.${String(key)}: rebirthReset 动作须挂在 rebirth:'reset' 行`);
  }
}

/**
 * 兵解瞬态清场（rebirth:perform 消费）：遍历字段表 rebirth='transient' 行
 * 统一执行清场动作。hp 标记 transient 而无动作——回满 = 按重置/天赋重算后
 * 的完整属性投影置满（game.ts hpCap），非置 null 的清场，留在字段表外。
 */
export function clearRebirthTransient(state: GameState): void {
  for (const key of FIELD_KEYS) {
    rowOf(key).rebirthClear?.(state);
  }
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** initialState：字段表逐行求值缺省（声明序 = 依赖序）。 */
export function initialState(
  content: GameContent,
  seed: number,
  contributions: readonly Contribution[] = [],
): GameState {
  const state = {} as GameState;
  const env: FieldEnv = { content, contributions, seed, save: null, partial: state };
  for (const key of FIELD_KEYS) {
    (state as unknown as Record<string, unknown>)[key] = rowOf(key).def(env);
  }
  return state;
}

/**
 * 从存档恢复状态：已知键经字段表逐行校验规范化，未知键透传保留。
 * 形状/内容引用无效的活动直接弃置（内容包已变更时防崩）。
 */
export function restoreState(
  content: GameContent,
  save: SaveData,
  fallbackSeed: number,
  contributions: readonly Contribution[] = [],
): GameState {
  const raw: Record<string, unknown> = isObj(save.state) ? save.state : {};
  const state = initialState(content, fallbackSeed, contributions);

  // 透明收编未知顶层键（跳过原型污染键），已知键随后由字段表逐行覆盖。
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    (state as unknown as Record<string, unknown>)[key] = value;
  }

  const env: FieldEnv = { content, contributions, seed: fallbackSeed, save, partial: state };
  for (const key of FIELD_KEYS) {
    rowOf(key).restore(raw, state, env);
  }
  return state;
}

/**
 * 深拷贝状态树（snapshot 用；字段表逐行克隆，避免依赖 structuredClone 的 lib 约束）。
 * 顶层先整树浅展开：恢复时透传收编的未知键随快照原样存活（仅共享引用，原语义），
 * 已知键再由字段表逐行覆盖为深拷。
 */
export function cloneState(state: GameState): GameState {
  const out = { ...(state as unknown as Record<string, unknown>) };
  for (const key of FIELD_KEYS) {
    out[key] = rowOf(key).clone(state[key]);
  }
  return out as unknown as GameState;
}
