/**
 * 引擎基础类型。
 *
 * 硬原则：引擎零内容感知——content 包注入什么，引擎就透明持有什么，
 * 不理解任何具体玩法字段。
 */

import type { EnemyView } from './contentView.js';
import type { CombatSummonState } from './state.js';
import type { DamageTier, EncounterRecord } from './combat.js';
import type { LedgerData } from './ledger.js';

/** 召唤物投影行（#40 D4 纯数据）：槽位态（集火序）+ 生效视图，壳层直读零组合。 */
export interface CombatMinionProjection {
  readonly minion: CombatSummonState;
  readonly view: EnemyView;
}

/** 时钟抽象：注入点，测试用假时钟替代真实时间。 */
export interface Clock {
  /** 当前时刻，单位毫秒。 */
  now(): number;
}

/** 玩家动作。骨架期仅定义协议外形，语义由后续票据补充。 */
export interface GameAction {
  readonly type: string;
  readonly payload?: unknown;
}

/* ---------- 引擎事件缝（#47 判别联合）：每个 type 携带自己的载荷类型 ---------- */

/**
 * 引擎产出的领域事件。运行时对象不落盘（零存档形状影响）；type 字符串
 * 运行时不变（既有事件流测试/壳层 handler 表零语义改动）。载荷全量类型化：
 * emit 点载荷键拼错 = 编译错；壳层 switch 内 event.data 按类型自动窄化。
 */
export type GameEvent =
  | TickEvent
  | LedgerEvent
  | AttackEvent
  | CombatNoteEvent
  | VictoryEvent
  | DefeatEvent
  | BossPhaseEvent
  | BossSummonEvent
  | LootEvent
  | ExpEvent
  | LevelupEvent
  | RejectEvent
  | ActivityStartEvent
  | ActivityStopEvent
  | ActivityCompleteEvent
  | CraftFailEvent
  | CraftHaltEvent
  | SellEvent
  | BuyEvent
  | ConsumableEatEvent
  | EquipWearEvent
  | EquipRemoveEvent
  | GearSmeltEvent
  | GearReforgeEvent
  | RebirthEvent
  | TalentBuyEvent
  | AchievementUnlockEvent
  | OfflineSettledEvent
  | DungeonEnterEvent
  | DungeonFloorEvent
  | DungeonClearEvent
  | DungeonLeaveEvent
  | VisitBeginEvent
  | VisitEndEvent;

/** 事件公共底座：发生时刻（游戏内时间，自开局累计毫秒）。 */
interface GameEventBase {
  readonly time: number;
}

export interface TickEvent extends GameEventBase {
  readonly type: 'tick';
  readonly data: { readonly dt: number };
}

/** 入账咽喉事件（#39）：载荷协议面在 ledger.ts（D8）。 */
export interface LedgerEvent extends GameEventBase {
  readonly type: 'ledger';
  readonly data: LedgerData;
}

/** 掉落播报来源闭集：采集产出 / 副产出 / 炼制产出 / 战斗材料 / 异宝器胚。 */
export type LootEventSource = 'activity' | 'byproduct' | 'craft' | 'drop' | 'gear';

export interface LootEvent extends GameEventBase {
  readonly type: 'loot';
  readonly data: {
    readonly item: string;
    readonly itemName: string;
    readonly count: number;
    readonly source: LootEventSource;
    /** 装备实例产出（craft/gear 播报）携带。 */
    readonly rarity?: string;
    readonly uid?: number;
  };
}

/** 单次攻击播报：玩家侧带暴击标记，敌方/召唤物侧无。 */
export type AttackEvent = PlayerAttackEvent | EnemyAttackEvent;

export interface PlayerAttackEvent extends GameEventBase {
  readonly type: 'attack';
  readonly data: {
    readonly side: 'player';
    readonly enemyId: string;
    readonly enemyName: string;
    /** 完整战斗文案（伤害已嵌入 {d} 槽，壳层直出）。 */
    readonly text: string;
    readonly dmg: number;
    readonly crit: boolean;
    readonly tier: DamageTier;
    /** 攻方系别（无武器/未声明 = 凡击，缺省）。 */
    readonly element?: string;
  };
}

export interface EnemyAttackEvent extends GameEventBase {
  readonly type: 'attack';
  readonly data: {
    readonly side: 'enemy';
    readonly enemyId: string;
    readonly enemyName: string;
    readonly text: string;
    readonly dmg: number;
    readonly tier: DamageTier;
    readonly element?: string;
  };
}

export interface CombatNoteEvent extends GameEventBase {
  readonly type: 'combat-note';
  readonly data: {
    readonly text: string;
    /** 战团归属（开战/撤退/阶段叙事带；系统注记缺省）。 */
    readonly enemyId?: string;
    /** 注记类别（静默服丹 = 'consumable'；呈现方可据此分色）。 */
    readonly kind?: 'consumable';
  };
}

/** 同对手上一战对照记录（victory.prevEncounter）：复用 combat.ts 的 EncounterRecord（lastEncounter 值形状单一来源）。 */

export interface VictoryEvent extends GameEventBase {
  readonly type: 'victory';
  readonly data: {
    readonly enemyId: string;
    readonly enemyName: string;
    readonly gold: number;
    readonly rounds: number;
    /** 斗法修为实发值（xpMult 后，与账本同源）。 */
    readonly exp: number;
    readonly summary: string;
    readonly drops: readonly string[];
    /** 异宝器胚展示名（「档名·物品名」，实际入袋才有）。 */
    readonly gearDropName?: string;
    readonly prevEncounter?: EncounterRecord;
    /** 与上一战对照语（无对照记录 = 缺省）。 */
    readonly compare?: string;
  };
}

export interface DefeatEvent extends GameEventBase {
  readonly type: 'defeat';
  readonly data: { readonly enemyId: string; readonly enemyName: string };
}

export interface BossPhaseEvent extends GameEventBase {
  readonly type: 'boss:phase';
  readonly data: {
    readonly enemyId: string;
    readonly enemyName: string;
    /** 阶段序号（1 起，单击跨多阈值逐级补发）。 */
    readonly phase: number;
    /** 阶段名（content 数据直出；未声明 = 空串）。 */
    readonly name: string;
  };
}

export interface BossSummonEvent extends GameEventBase {
  readonly type: 'boss:summon';
  readonly data: {
    readonly enemyId: string;
    readonly enemyName: string;
    readonly phase: number;
    /** 实际入场召唤槽数（池全缺失 = 不播报）。 */
    readonly count: number;
  };
}

export interface ExpEvent extends GameEventBase {
  readonly type: 'exp';
  readonly data: {
    readonly skillId: string;
    readonly skillName: string;
    /** 实发值（xpMult 后）。 */
    readonly amount: number;
  };
}

export interface LevelupEvent extends GameEventBase {
  readonly type: 'levelup';
  readonly data: {
    readonly skillId: string;
    readonly skillName: string;
    readonly level: number;
  };
}

export interface RejectEvent extends GameEventBase {
  readonly type: 'reject';
  readonly data: {
    readonly action: string;
    readonly reason: string;
    /** 展示文案（texts.reject 解析；缺包回显 {action}/{reason}）。 */
    readonly message: string;
  };
}

export interface ActivityStartEvent extends GameEventBase {
  readonly type: 'activity-start';
  readonly data: {
    readonly skillId: string;
    readonly skillName: string;
    /** 动作下标（craft 类 = recipes 下标）。 */
    readonly index: number;
    readonly activityName: string;
  };
}

export interface ActivityStopEvent extends GameEventBase {
  readonly type: 'activity-stop';
  readonly data: {
    readonly skillId: string;
    /** 活动名随档保存；恢复侧查活动定义失败时缺省。 */
    readonly activityName?: string;
  };
}

export interface ActivityCompleteEvent extends GameEventBase {
  readonly type: 'activity-complete';
  readonly data: {
    readonly skillId: string;
    readonly skillName: string;
    readonly activityName: string;
  };
}

export interface CraftFailEvent extends GameEventBase {
  readonly type: 'craft-fail';
  readonly data: {
    readonly skillId: string;
    readonly skillName: string;
    readonly recipeName: string;
    /** 失败返还修为（round(exp × failRefund)）。 */
    readonly exp: number;
  };
}

export interface CraftHaltEvent extends GameEventBase {
  readonly type: 'craft-halt';
  readonly data: {
    readonly skillId: string;
    readonly skillName: string;
    readonly recipeName: string;
  };
}

export interface SellEvent extends GameEventBase {
  readonly type: 'sell';
  readonly data: {
    readonly item: string;
    readonly itemName: string;
    readonly count: number;
    readonly gained: number;
    readonly gold: number;
  };
}

export interface BuyEvent extends GameEventBase {
  readonly type: 'buy';
  readonly data: {
    readonly item: string;
    readonly itemName: string;
    readonly count: number;
    readonly cost: number;
    readonly gold: number;
  };
}

/** 服用消耗品：即时恢复 / 持续增益两形（kind 判别）。 */
export type ConsumableEatEvent =
  | (GameEventBase & {
      readonly type: 'consumable:eat';
      readonly data: {
        readonly item: string;
        readonly itemName: string;
        readonly kind: 'heal';
        readonly healed: number;
      };
    })
  | (GameEventBase & {
      readonly type: 'consumable:eat';
      readonly data: {
        readonly item: string;
        readonly itemName: string;
        readonly kind: 'buff';
        readonly minutes: number;
      };
    });

export interface EquipWearEvent extends GameEventBase {
  readonly type: 'equip:wear';
  readonly data: {
    readonly uid: number;
    readonly slot: string;
    /** 「档名·物品名」展示名。 */
    readonly name: string;
  };
}

export interface EquipRemoveEvent extends GameEventBase {
  readonly type: 'equip:remove';
  readonly data: {
    readonly slot: string;
    readonly uid: number;
    /** 装备实例已不在囊中（防御路径）= 缺省。 */
    readonly name?: string;
  };
}

export interface GearSmeltEvent extends GameEventBase {
  readonly type: 'gear:smelt';
  readonly data: {
    readonly uid: number;
    /** 器屑物品 id（壳层经 items 表投影展示名）。 */
    readonly item: string;
    readonly shards: number;
    /** 「档名·物品名」展示名。 */
    readonly name: string;
  };
}

export interface GearReforgeEvent extends GameEventBase {
  readonly type: 'gear:reforge';
  readonly data: {
    readonly uid: number;
    readonly index: number;
    /** 重随后的纹阶（T1~T3，天花板由器胚 tierRange 数据锁死）。 */
    readonly tier: number;
    readonly inscriptionId: string;
    readonly name: string;
  };
}

export interface RebirthEvent extends GameEventBase {
  readonly type: 'rebirth';
  readonly data: {
    readonly daoYun: number;
    readonly totalXp: number;
    readonly rebirths: number;
  };
}

export interface TalentBuyEvent extends GameEventBase {
  readonly type: 'talent:buy';
  readonly data: {
    readonly nodeId: string;
    readonly name: string;
    readonly cost: number;
    /** 购买后道韵余额。 */
    readonly daoYun: number;
  };
}

export interface AchievementUnlockEvent extends GameEventBase {
  readonly type: 'achievement:unlock';
  readonly data: {
    readonly id: string;
    readonly name: string;
    /** 奖励已在引擎入账（物品静默入袋不重发 loot）；无该项奖励 = 缺省。 */
    readonly gold?: number;
    readonly daoYun?: number;
    readonly items?: Readonly<Record<string, number>>;
  };
}

/** 离线升级行（offline-settled.levels）。 */
export interface OfflineLevelUp {
  readonly skillId: string;
  readonly skillName: string;
  readonly level: number;
}

export interface OfflineSettledEvent extends GameEventBase {
  readonly type: 'offline-settled';
  readonly data: {
    /** 实际结算时长（秒）。 */
    readonly seconds: number;
    /** 真实离开时长（秒；上限钳制时 ≠ seconds）。 */
    readonly awaySeconds: number;
    readonly capped: boolean;
    readonly skillId: string;
    readonly skillName: string;
    readonly activityName: string;
    readonly cycles: number;
    /** 修为实发值（离线/在线同源口径）。 */
    readonly exp: number;
    readonly items: Readonly<Record<string, number>>;
    readonly levels: readonly OfflineLevelUp[];
  };
}

/** 秘境入门事件（#7）：begin 时登记攻略 + 最高层后发射。 */
export interface DungeonEnterEvent extends GameEventBase {
  readonly type: 'dungeon:enter';
  readonly data: {
    readonly dungeonId: string;
    readonly dungeonName: string;
    readonly floor: number;
    readonly floors: number;
  };
}

/** 层奖励事件（#52 层奖励入账单一门尾）：与实入账同源（折叠/拒收不计）。 */
export interface DungeonFloorEvent extends GameEventBase {
  readonly type: 'dungeon:floor';
  readonly data: {
    readonly dungeonId: string;
    readonly dungeonName: string;
    readonly floor: number;
    readonly floors: number;
    readonly gold: number;
    readonly daoYun: number;
    readonly items: Readonly<Record<string, number>>;
  };
}

export interface DungeonClearEvent extends GameEventBase {
  readonly type: 'dungeon:clear';
  readonly data: {
    readonly dungeonId: string;
    readonly dungeonName: string;
    readonly floors: number;
  };
}

export interface DungeonLeaveEvent extends GameEventBase {
  readonly type: 'dungeon:leave';
  readonly data: {
    readonly dungeonId: string;
    readonly dungeonName: string;
    readonly floor: number;
    /** max(历史最高, 本次到达层)——离境结算一并覆盖。 */
    readonly best: number;
  };
}

/** 访问段信号（#39 D9）：壳层派发、引擎纯转发（段状态归 #33）。 */
export interface VisitBeginEvent extends GameEventBase {
  readonly type: 'visit:begin';
  readonly data: { readonly page: string };
}

export interface VisitEndEvent extends GameEventBase {
  readonly type: 'visit:end';
  readonly data: { readonly page: string };
}

/** 玩家属性面板（#4）：经修饰符管线聚合后的快照读数。 */
export interface PlayerStatsView {
  readonly atk: number;
  readonly def: number;
  /** 暴击率百分点（已钳上限）。 */
  readonly crit: number;
  readonly maxHp: number;
}

/** 存档快照。 */
export interface SaveData {
  readonly version: 1;
  /** 存档时的游戏内时间（毫秒）。 */
  readonly time: number;
  /**
   * 保存时刻的墙钟时间（clock.now()）。
   * 离线补偿结算（ADR-013）的基准：重开时以 now - savedAt 折算欠账。
   */
  readonly savedAt?: number;
  /** 引擎扩展的透明状态区：引擎写入，UI 只读。 */
  readonly state: Readonly<Record<string, unknown>>;
  /** 玩家属性面板（#4）：应用层展示用，非存档必需。 */
  readonly stats?: PlayerStatsView;
  /**
   * 战斗中敌人生效视图（#40 展示投影）：秘境层倍率在前、Boss 阶段修正在后
   * （resolveEnemy 单点组合）；无战斗 = null。运行时恒在（snapshot 必发射，
   * D2）；类型可选与 stats? 同律——存档夹具/旧档缺字段不破型。
   * 应用层展示用，非存档必需（恢复侧忽略）。
   */
  readonly enemy?: EnemyView | null;
  /**
   * 战斗中召唤物生效视图组（#40 展示投影）：槽位序 = 引擎集火序，投影失效
   * 槽位（包变更缩表）剔除；无战斗 = null。运行时恒在（D2）。
   * 应用层展示用，非存档必需。
   */
  readonly minions?: readonly CombatMinionProjection[] | null;
  /**
   * 全活动有效轮间隔映射（#40 展示投影）：键 = `skillId:index`
   * （壳层活动卡寻址同式），值为有效毫秒——采集按 gatherSpeed 缩放
   * （与结算同调 effectiveIntervalOf），炼制为配方原值。运行时恒在（D2）。
   * 取代旧单值 activityInterval（同一事实单一真相）。非存档必需。
   */
  readonly activityIntervals?: Readonly<Record<string, number>>;
}

/**
 * 内容包类型：透明容器。content 包负责按 schema 校验并给出精确类型
 * （如 ContentPack），引擎不解读其内部结构，因此这里只要求非原始值。
 *
 * 引擎安全兜底约定（issue #2 确立，战斗票实现；#24 机制键中性化 fist→basic）：
 * - 出招文案与战斗解算查找招式名时，若内容包未注册当前武器或敌人 id
 *   （combatText.moves），一律回退基础动作（moves.basic + verbs.basic），
 *   不得抛错或渲染空文案；
 * - 内容包校验保证 moves.basic 与 verbs.basic 兜底动词池恒存在
 *   （动词池键域开放后仅 basic 恒需，#021 批 4），
 *   兜底路径永远可用（见 @wendao/content 的 validateContentPack）。
 */
export type GameContent = object;
