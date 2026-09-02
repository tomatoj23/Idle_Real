/**
 * 内容包类型（issue #2；#16 落地预留字段）。
 *
 * 这些接口描述 content 包各节的形状，供引擎消费方（app / editor）与
 * 默认内容包加载器使用；引擎本体依旧零内容感知（透明持有 GameContent）。
 *
 * 三处同步纪律（ADR-015）：字段变更须同步 schemas/*.schema.json、
 * 本文件、docs/agents/content.md（字段约定文档）。
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
  /** ADR-015 原型继承：声明本条目可被同集合条目继承（值须等于自身 id）。 */
  readonly prototypeKey?: string;
  /** ADR-015 原型继承：继承同集合内已声明 prototypeKey 的父条目。 */
  readonly prototypeParent?: string;
}

/* ---------- 物品 ---------- */

export type ItemType = 'mat' | 'pill' | 'equip' | 'blank' | 'inscription';

/**
 * 佩戴槽位 id：数据化（config.slots），起步三槽 法器 weapon / 护体 body /
 * 灵饰 accessory，为法宝/外袍留门——不再用字面量联合锁死，新槽 = 新 JSON。
 */
export type EquipSlot = string;

/** 连续数值区间（min ≤ max，方向性由语义校验保证）。 */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/* ---------- 系别（ADR-012） ---------- */

/** 系别 id：金木水火土风雷；凡击=无 element 字段，不是第七个值。 */
export type Element = 'metal' | 'wood' | 'water' | 'fire' | 'earth' | 'wind' | 'thunder';

/** 系别亲和：键=系别 id 的任意子集，值=受该系攻击的伤害调整百分点（−100 抗性 ~ 100 易伤）。 */
export type Affinities = Readonly<Partial<Record<Element, number>>>;

/* ---------- 修饰符（器胚胚纹 / 铭纹 tiers 的最小单元，#13 聚合管线消费） ---------- */

/** 聚合区（ADR-011 统一管线）：flat → 加法% → 乘法区按序结算，禁绕管直改。 */
export type ModifierZone = 'flat' | 'addPct' | 'mult';

/** 定向条件：声明后仅在该条件命中时生效（受某系伤害/某招式命中）。 */
export interface ModifierCondition {
  readonly element?: Element;
  readonly moveId?: string;
}

/** 属性修饰符：铭纹/胚纹产出，统一走 #13 聚合管线。 */
export interface Modifier {
  /** 目标属性 id（atk/def/hp/crit/gatherXp…）。 */
  readonly stat: string;
  readonly zone: ModifierZone;
  /** 数值；乘法区须 > 0、加法%区 ≥ −100（语义校验）。 */
  readonly value: number;
  readonly condition?: ModifierCondition;
}

/** 机制型特色铭纹：condition+primitive 表达，引擎原语池零新增（未注册原语忽略）。 */
export interface Feature {
  readonly primitive: string;
  readonly condition?: ModifierCondition;
  /** 原语数值参数（如传染概率）；无参数原语省略。 */
  readonly value?: number;
}

/** 铭纹三阶数值表：下标 0/1/2 对应纹阶 T1/T2/T3。 */
export type InscriptionTiers = readonly [
  readonly Modifier[],
  readonly Modifier[],
  readonly Modifier[],
];

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
  /** ADR-015 原型继承：声明本条目可被同集合条目继承（值须等于自身 id）。 */
  readonly prototypeKey?: string;
  /** ADR-015 原型继承：继承同集合内已声明 prototypeKey 的父条目。 */
  readonly prototypeParent?: string;
  /** equip/blank 类：佩戴槽位（config.slots 数据化的槽位 id）。 */
  readonly slot?: EquipSlot;
  /** equip 类：基础加成。 */
  readonly bonuses?: Bonuses;
  /** pill 类：持续增益。 */
  readonly effect?: PillEffect;
  /** pill 类：即时恢复。 */
  readonly heal?: Heal;
  /** blank 类（器胚）：掉落层数段（秘境层数），分层掉不同器胚。 */
  readonly floorRange?: Range;
  /** blank 类（器胚）：纹阶天花板区间 T1~T3，重铸不得突破。 */
  readonly tierRange?: Range;
  /** blank 类（器胚）：偏好标签，铭纹抽取按匹配数加权。 */
  readonly preferredTags?: readonly string[];
  /** blank 类（器胚）：胚纹——固有词条，固定非随机，实例化时直接附加。 */
  readonly inherentModifiers?: readonly Modifier[];
  /** inscription 类（铭纹）：三阶数值表，下标 0/1/2 = T1/T2/T3。 */
  readonly tiers?: InscriptionTiers;
  /** inscription 类（铭纹）：机制型特色表达。 */
  readonly feature?: Feature;
  /** inscription 类（铭纹）：标签加权抽取归类。 */
  readonly tags?: readonly string[];
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
  /** 系别（金木水火土风雷）；不填=凡击无系别。只给 Boss/特色怪配（ADR-012）。 */
  readonly element?: Element;
  /** 系别亲和：受该系攻击的伤害调整百分点（负=抗性，正=易伤）；不填=全系无调整。 */
  readonly affinities?: Affinities;
  /** ADR-015 原型继承：声明本条目可被同集合条目继承（值须等于自身 id）。 */
  readonly prototypeKey?: string;
  /** ADR-015 原型继承：继承同集合内已声明 prototypeKey 的父条目。 */
  readonly prototypeParent?: string;
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

/* ---------- 全局配置（槽位数据化） ---------- */

/** 槽位定义（config.slots 条目）；icon 未显式写入即不落盘（ADR-013）。 */
export interface SlotDef {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
}

export interface Config {
  readonly slots: readonly SlotDef[];
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
  /** 全局配置（槽位数据化）；可选节，省略=无槽位数据（引擎安全兜底）。 */
  readonly config?: Config;
}
