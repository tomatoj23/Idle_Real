/**
 * 内容包类型（issue #2）。
 *
 * 这些接口描述 content 包各节的形状，供引擎消费方（app / editor）与
 * 默认内容包加载器使用；引擎本体依旧零内容感知（透明持有 GameContent）。
 */

/* ---------- 技能与活动 ---------- */

export type SkillKind = 'gather' | 'craft' | 'combat';

/** 产出或消耗的一叠物品。 */
export interface Stack {
  readonly item: string;
  readonly count: number;
}

/** 采集副产出：以 chance 概率额外获得。 */
export interface Byproduct {
  readonly item: string;
  readonly chance: number;
}

/**
 * 采集活动：gather 类技能的单次挂机动作。
 * interval 为毫秒（旧版 data.js 以秒记，迁移时 ×1000）。
 */
export interface Activity {
  readonly name: string;
  readonly unlockLevel: number;
  readonly interval: number;
  readonly exp: number;
  readonly output: Stack;
  readonly byproduct?: Byproduct;
}

export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly kind: SkillKind;
  readonly description?: string;
  /** 仅 gather 类技能携带；craft 的动作是 recipes，combat 的动作是斗法。 */
  readonly activities?: readonly Activity[];
}

/* ---------- 物品 ---------- */

export type ItemType = 'mat' | 'pill' | 'equip';
export type EquipSlot = 'weapon' | 'body' | 'accessory';

/** 装备基础加成（稀有度与词条是运行时实例化概念，不属于内容包）。 */
export interface Bonuses {
  readonly atk?: number;
  readonly def?: number;
  readonly hp?: number;
  readonly crit?: number;
}

/** 丹药持续增益的倍率区。 */
export interface PillMultipliers {
  readonly gatherXp?: number;
  readonly atk?: number;
  readonly def?: number;
}

/** 丹药持续增益（duration 毫秒）。 */
export interface PillEffect {
  readonly duration: number;
  readonly multipliers?: PillMultipliers;
  /** 额外暴击率加成（百分点）。 */
  readonly crit?: number;
}

/** 即时恢复类丹药（如回气丹）。 */
export interface Heal {
  readonly percent: number;
}

export interface Item {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly type: ItemType;
  /** 出售价（灵石）。 */
  readonly sell: number;
  readonly description?: string;
  /** equip 类：佩戴槽位。 */
  readonly slot?: EquipSlot;
  /** equip 类：基础加成。 */
  readonly bonuses?: Bonuses;
  /** pill 类：持续增益。 */
  readonly effect?: PillEffect;
  /** pill 类：即时恢复。 */
  readonly heal?: Heal;
}

/* ---------- 配方 ---------- */

export interface Recipe {
  readonly name: string;
  /** 所属技艺 id，必须指向 craft 类技能。 */
  readonly skill: string;
  readonly unlockLevel: number;
  readonly output: Stack;
  /** 材料表：物品 id → 数量。失败时材料损失。 */
  readonly materials: Readonly<Record<string, number>>;
  /** 基础成功率（0~1）；必定成功填 1（炼器）。 */
  readonly successRate: number;
  readonly interval: number;
  readonly exp: number;
}

/* ---------- 敌人与掉落 ---------- */

export type EnemyKind = 'claw' | 'magic';

export interface ItemDrop {
  readonly item: string;
  readonly chance: number;
}

export interface Enemy {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly level: number;
  readonly kind: EnemyKind;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  /** 攻击间隔（毫秒）。 */
  readonly attackInterval: number;
  readonly exp: number;
  /** 击杀掉落灵石区间。 */
  readonly gold: { readonly min: number; readonly max: number };
  /** 常规物品掉落表。 */
  readonly drops: readonly ItemDrop[];
}

/** 异宝掉落表：敌人按 chance 掉落 pool 中的随机异宝装备。 */
export interface GearDrop {
  readonly enemy: string;
  readonly chance: number;
  readonly pool: readonly string[];
}

/* ---------- 战斗文案（CTEXT 体系数据化） ---------- */

/** 动词条目：v 为动作动词，limbs 为该动词的部位白名单。 */
export interface VerbEntry {
  readonly v: string;
  readonly limbs: readonly string[];
}

/** 动词池四系：sword 佩剑 / fist 拳脚 / claw 妖兽爪牙 / magic 阴风法术。 */
export type VerbStyle = 'sword' | 'fist' | 'claw' | 'magic';

/** 伤害档：按相对期望伤害分池。 */
export type DamageTier = 'light' | 'mid' | 'heavy' | 'deadly';

export interface CombatText {
  readonly verbs: Readonly<Record<VerbStyle, readonly VerbEntry[]>>;
  /**
   * 招式名注册表：键为 `fist`、武器物品 id 或敌人 id。
   * 未注册者由引擎回退 fist（安全兜底约定，见 engine/types.ts）。
   */
  readonly moves: Readonly<Record<string, readonly string[]>>;
  /** 起势（重击时加一段）。 */
  readonly openings: readonly string[];
  /** 暴击起势。 */
  readonly critIntro: readonly string[];
  /** 后果词库：hit 打妖物（{defender} 为主语）/ hurt 玩家挨打（你为主语），{d} 填伤害值。 */
  readonly cons: {
    readonly hit: Readonly<Record<DamageTier, readonly string[]>>;
    readonly hurt: Readonly<Record<DamageTier, readonly string[]>>;
  };
  /** 致命一击专属（剩余生命=危 且 伤害=重/濒死时启用）。 */
  readonly fatal: { readonly hit: string; readonly hurt: string };
}

/* ---------- 坊市 ---------- */

export interface ShopEntry {
  readonly item: string;
  readonly price: number;
}

/* ---------- 内容包整体 ---------- */

export interface ContentPack {
  readonly skills: readonly Skill[];
  readonly items: readonly Item[];
  readonly recipes: readonly Recipe[];
  readonly enemies: readonly Enemy[];
  readonly gearDrops: readonly GearDrop[];
  readonly combatText: CombatText;
  readonly shop: readonly ShopEntry[];
}
