/**
 * 内容包类型（issue #2；#16 落地预留字段）。
 *
 * 这些接口描述 content 包各节的形状，供引擎消费方（app / editor）与
 * 题材包装载器（src/packs/）使用；引擎本体依旧零内容感知（透明持有
 * GameContent）。
 *
 * 三处同步纪律（ADR-015）：字段变更须同步 src/schema/*.schema.json、
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

export type ItemType = 'mat' | 'consumable' | 'equip' | 'blank' | 'inscription';

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

/* ---------- 系别（ADR-012；#25 键域开放） ---------- */

/**
 * 系别键（#25 键域开放，循 #21 VerbStyle/EnemyKind 先例）：取值 = 包内
 * elements 节注册的系别 id，存在性由包校验强制；'metal'~'thunder' 七系只是
 * 官方包的内容约定，自定义系别（如法术学派）= elements 节新条目。
 */
export type Element = string;

/** 系别亲和：键=系别键的任意子集，值=受该系攻击的伤害调整百分点（−100 抗性 ~ 100 易伤）。 */
export type Affinities = Readonly<Partial<Record<Element, number>>>;

/**
 * 系别定义（elements 节条目，#25）：包内系别键域的唯一注册表。
 * id 一经发布不可变（enemy.element / affinities / 铭纹条件 element 引用它）；
 * name 供壳层/编辑器展示（引擎零感知）。空 elements = 无系别玩法。
 */
export interface ElementDef {
  readonly id: string;
  /** 展示名（1~6 字）。 */
  readonly name: string;
}

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

/**
 * 装备基础加成（模板字段；稀有度与词条为运行时实例化产物，其档位词表按 ADR-016 归内容包）。
 * #021 批 4 键域开放：键 = stat id（与 Modifier.stat / affixPool.stat 同一注册表，
 * 消费点清单见 docs/agents/content.md），值 = flat 基础量（整数 ≥ 0）。
 */
export type Bonuses = Readonly<Record<string, number>>;

/** 消耗品持续增益的倍率区（#021 批 4 键域开放：键 = stat id，值须 > 1）。 */
export type ConsumableMultipliers = Readonly<Record<string, number>>;

/** 消耗品持续增益（duration 毫秒）。 */
export interface ConsumableEffect {
  readonly duration: number;
  readonly multipliers?: ConsumableMultipliers;
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
  /**
   * equip 类（引擎只消费 weapon 槽位物品）：动词池键（#021 批 4 开放键域，
   * 须在 combatText.verbs 注册）；缺省 = 引擎兜底键 basic 池（#24 fist→basic）。
   */
  readonly verbStyle?: VerbStyle;
  /** consumable 类：持续增益。 */
  readonly effect?: ConsumableEffect;
  /** consumable 类：即时恢复。 */
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

/**
 * 敌人动词风格（#021 批 4 开放键域，ADR-016 裁决 ⑦）：取值 = combatText.verbs
 * 池键，存在性由包校验强制；'claw'/'magic' 只是官方包的内容约定。
 */
export type EnemyKind = string;

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

/* ---------- 稀有度与词条池（#018 批 1，ADR-016 裁决 ①：词表零默认，节恒在） ---------- */

/**
 * 稀有度档位（rarities 节条目）：档名/概率/倍率/词条数/卖价全部由内容包
 * 定义，引擎只保留掷点机制与缺档回退第一档的安全兜底（ADR-016）。
 * id 一经发布不可变（GearInstance.rarity 存档键 + UI r-* 着色类后缀）。
 */
export interface RarityDef {
  readonly id: string;
  readonly name: string;
  /** 掷点权重（正数；引擎按占比归一化掷档，无需配成 1）。 */
  readonly weight: number;
  /** 基础加成倍率：实例化投影 flat = round(基础 × mult)。 */
  readonly mult: number;
  /** 随机词条数（0 = 无词条）。 */
  readonly affix: number;
  /** 卖价倍率：卖价 = max(1, round(物品卖价 × sell))。 */
  readonly sell: number;
  /** UI 特判开关（ADR-016 裁决 ④）：true 时 UI 作「天降异宝」级特判；缺省 = 普通档。 */
  readonly showcase?: boolean;
}

/**
 * 随机词条池（affixPool 节条目）：实例化按稀有度词条数掷不重复 stat 词条。
 * stat 键域开放（#021 批 4）：与装备 bonuses 键域同源，schema 层只钉键形态。
 */
export interface AffixDef {
  readonly name: string;
  readonly stat: string;
  /** 量级系数：词条值 = max(1, round(基础标尺 × scale × 随机波动))。 */
  readonly scale: number;
}

/* ---------- 战斗文案（CTEXT 体系数据化） ---------- */

/** 动词条目：v 为动作动词，limbs 为该动词的部位白名单。 */
export interface VerbEntry {
  readonly v: string;
  readonly limbs: readonly string[];
}

/**
 * 动词池键（#021 批 4 开放键域，ADR-016 裁决 ⑦）：新增动词风格 = 新 JSON 键，
 * schema 仅强制引擎兜底键 `basic` 恒需； sword/basic/claw/magic 为官方包约定。
 */
export type VerbStyle = string;

/** 伤害档：按相对期望伤害分池。 */
export type DamageTier = 'light' | 'mid' | 'heavy' | 'deadly';

export interface CombatText {
  readonly verbs: Readonly<Record<VerbStyle, readonly VerbEntry[]>>;
  /**
   * 招式名注册表：键为 `basic`、武器物品 id 或敌人 id。
   * 未注册者由引擎回退 basic（安全兜底约定，见 engine/types.ts）。
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
  /**
   * 出招句式模板池（#019 批 2 出池）：引擎按出招方与伤害档选池抽取后填槽。
   * 槽位：{move}{weapon}{verb}{defender}{limb}{opening}{critIntro}{enemy}。
   */
  readonly templates: {
    /** 玩家普通句（轻/中档）。 */
    readonly playerLight: readonly string[];
    /** 玩家重击句（heavy，带 {opening} 起势槽）。 */
    readonly playerHeavy: readonly string[];
    /** 玩家暴击/濒死句（crit 或 deadly，带 {critIntro} 槽）。 */
    readonly playerCrit: readonly string[];
    /** 妖物普通句（轻/中档）。 */
    readonly enemyLight: readonly string[];
    /** 妖物重击/濒死句（heavy/deadly）。 */
    readonly enemyHeavy: readonly string[];
  };
  /** 系统 combat-note 叙事池（#019 出池）。 */
  readonly notes: {
    /** 手动收势停战。 */
    readonly retreat: readonly string[];
    /** 开修行而收势离战。 */
    readonly retreatToGather: readonly string[];
    /** 自动再战前残血退避。 */
    readonly retreatWounded: readonly string[];
    /** 胜后休整期结束离场。 */
    readonly retreatVictory: readonly string[];
    /** 自动再战（{enemy} 槽）。 */
    readonly reengage: readonly string[];
    /** 开战（{enemy} 槽）。 */
    readonly start: readonly string[];
    /** 自动服用消耗品（{item} 槽）。 */
    readonly autoConsume: readonly string[];
  };
  /** 战后一行签名画像（#019 出池）：主导伤害档出画句 + 整行模板。 */
  readonly summary: {
    readonly tiers: Readonly<Record<DamageTier, readonly string[]>>;
    /** 无会心整行模板（{rounds}{flavor}）。 */
    readonly base: readonly string[];
    /** 带会心整行模板（{rounds}{flavor}{crits}）。 */
    readonly crit: readonly string[];
  };
  /** 同对手再战对照语（#019 出池）：{rounds} 今回合数 / {prev} 前番回合数。 */
  readonly compare: {
    readonly revenge: readonly string[];
    readonly faster: readonly string[];
    readonly slower: readonly string[];
    readonly even: readonly string[];
  };
}

/* ---------- 系统展示文案（#019 批 2）+ 壳层文案（#26） ---------- */

/**
 * texts 节：协议 code → 展示文案映射。
 * 协议 code 本体归引擎；code 未命中时引擎按键名回显降级（ADR-016 裁决 ④）。
 * shell 子节（#26）承载游戏壳的全部题材文案——壳零题材字符串（ADR-017 裁决 9）。
 */
export interface TextsSection {
  /** 无佩戴武器时的兵刃展示名（makeAttackText weaponName 槽兜底值）。 */
  readonly basicName: string;
  /**
   * reject 展示文案：动作协议键 → 理由 code → 文案模板；
   * `'*'` 为跨动作兜底键；槽位 {level}/{activity}/{item}/{owned}/{cost}/{gold}
   * 由引擎按协议语境填入。
   */
  readonly reject: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** 壳层文案（#26）：品牌/页签/事件/页面文案与 stat 展示标签，模板槽 {slot} 由壳填入。 */
  readonly shell: ShellTexts;
}

/* ---------- 壳层文案（#26，ADR-017 裁决 9：外壳文案归 content） ---------- */

/**
 * stat 展示标签 + 量纲标记（#26 票评，循 ADR-016 裁决 ④ 显式 bool 先例）：
 * 键 = stat id（开放键域，与 bonuses/affixPool.stat 同一注册表）；
 * 未注册 stat 由壳回退 stat 键名展示。percent 驱动 % 后缀，壳零量纲特判。
 */
export interface StatLabelDef {
  /** 展示标签（1~2 字）。 */
  readonly label: string;
  /** true = 百分比量纲（展示值后缀 %）；缺省 = 点数量纲。 */
  readonly percent?: boolean;
}

/** 品牌与启动兜底页文案（bootError 槽位 {message}）。 */
export interface ShellBrand {
  readonly sigil: string;
  /** 游戏名：顶栏品牌与 document.title。 */
  readonly name: string;
  /** 展示 locale：数字千分位格式化与文档 lang。 */
  readonly locale: string;
  readonly bootError: string;
}

/** 顶栏资源区悬浮提示（title 属性）与资源图章字。 */
export interface ShellTopbar {
  readonly statsTitle: string;
  readonly statsSigil: string;
  readonly goldTitle: string;
  readonly goldSigil: string;
  readonly hpTitle: string;
  readonly hpSigil: string;
}

/** 页签文案（键 = TabId 协议键，壳钉死四键）。 */
export interface ShellTabs {
  readonly skills: string;
  readonly combat: string;
  readonly bag: string;
  readonly shop: string;
}

/** 侧栏（修行录）文案。 */
export interface ShellSide {
  readonly title: string;
}

/** stat 展示标签表：键 = stat id（开放键域）。 */
export interface ShellStats {
  readonly labels: Readonly<Record<string, StatLabelDef>>;
}

/** 量纲单位模板：{v}=数值 {m}=分 {h}=时。 */
export interface ShellUnits {
  readonly level: string;
  readonly seconds: string;
  readonly minute: string;
  readonly hourMinute: string;
}

/** 缺省图标字（内容缺 icon 时的壳内占位）。 */
export interface ShellIcons {
  readonly buff: string;
  readonly gear: string;
  readonly unknown: string;
}

/** 跨页复用小模板：needLevel 槽位 {level}；compareWrap 槽位 {compare}；itemListSep 物品名分隔符。 */
export interface ShellCommon {
  readonly needLevel: string;
  readonly compareWrap: string;
  readonly itemListSep: string;
}

/** 事件流文案（键 = 引擎事件类型协议面，槽位见 schema 描述）。 */
export interface ShellEvents {
  readonly lootGear: string;
  readonly lootGearLog: string;
  readonly lootShowcase: string;
  readonly lootByproduct: string;
  readonly lootDrop: string;
  readonly victoryFlog: string;
  readonly victoryLog: string;
  readonly defeatFlog: string;
  readonly defeatToast: string;
  readonly eatHeal: string;
  readonly eatBuffToast: string;
  readonly eatBuffLog: string;
  readonly equipWearToast: string;
  readonly equipWearLog: string;
  readonly equipRemoveLog: string;
  readonly expCombat: string;
  readonly levelupToast: string;
  readonly levelupLog: string;
  readonly sellLog: string;
  readonly buyLog: string;
  readonly rejectFallback: string;
  readonly offlineToast: string;
  readonly offlineLog: string;
  readonly offlineNoYield: string;
  readonly offlineExpSuffix: string;
}

/** 修炼页文案。 */
export interface ShellPageSkills {
  readonly empty: string;
  readonly chipLocked: string;
  readonly expSub: string;
  readonly expMax: string;
  readonly actNow: string;
  readonly idle: string;
  readonly stopBtn: string;
  readonly running: string;
  readonly byproduct: string;
  readonly actMeta: string;
  readonly startBtn: string;
}

/** 斗法页文案。 */
export interface ShellPageCombat {
  readonly title: string;
  readonly subtitle: string;
  readonly enemyMissing: string;
  readonly resting: string;
  readonly enemyHp: string;
  readonly selfStats: string;
  readonly fleeBtn: string;
  readonly autoFightOn: string;
  readonly autoFightOff: string;
  readonly autoEatOn: string;
  readonly autoEatOff: string;
  readonly noConsumables: string;
  readonly enemyStats: string;
  readonly enemyGold: string;
  readonly dropsSuffix: string;
  readonly fightBtn: string;
}

/** 乾坤袋页文案。 */
export interface ShellPageBag {
  readonly title: string;
  readonly matGroup: string;
  readonly consumableGroup: string;
  readonly priceEach: string;
  readonly sellOneBtn: string;
  readonly sellAllBtn: string;
  readonly gearWorn: string;
  readonly gearLoose: string;
  readonly emptyWorn: string;
  readonly emptyLoose: string;
  readonly emptyAll: string;
  readonly noAffix: string;
  readonly wearBtn: string;
  readonly takeOffBtn: string;
  readonly sellBtn: string;
}

/** 坊市页文案。 */
export interface ShellPageShop {
  readonly title: string;
  readonly subtitle: string;
  readonly price: string;
  readonly owned: string;
  readonly buyBtn: string;
}

/** 页面文案分组（键 = TabId 协议键）。 */
export interface ShellPages {
  readonly skills: ShellPageSkills;
  readonly combat: ShellPageCombat;
  readonly bag: ShellPageBag;
  readonly shop: ShellPageShop;
}

/** 壳层文案节（#26）：模板槽 {slot} 由壳按语境填入，缺键回显键名（裁决 ④ 同策略）。 */
export interface ShellTexts {
  readonly brand: ShellBrand;
  readonly topbar: ShellTopbar;
  readonly tabs: ShellTabs;
  readonly side: ShellSide;
  readonly stats: ShellStats;
  readonly units: ShellUnits;
  readonly icons: ShellIcons;
  readonly common: ShellCommon;
  readonly events: ShellEvents;
  readonly pages: ShellPages;
}

/* ---------- 坊市 ---------- */

export interface ShopEntry {
  readonly item: string;
  readonly price: number;
}

/* ---------- 全局配置（槽位数据化 + 玩法参数） ---------- */

/** 槽位定义（config.slots 条目）；icon 未显式写入即不落盘（ADR-013）。 */
export interface SlotDef {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
}

/**
 * 战斗机制与属性基线参数（config.combat 子节，#020 批 3）。
 * 全部字段可选：缺省 = 引擎基线（ADR-016 裁决 ① 分策：数值参数引擎
 * 内置基线 + config 覆盖）。毫秒/百分点计量。
 */
export interface CombatConfig {
  /** 玩家攻击间隔（毫秒）；敌人未配 attackInterval 时的缺省出招间隔。 */
  readonly playerAttackInterval?: number;
  /** 减伤常数：伤害 ×(1 − def/(def+K))。 */
  readonly defenseK?: number;
  /** 伤害波动幅度（乘数 1−v ~ 1+v）。 */
  readonly damageVariance?: number;
  /** 暴击倍率。 */
  readonly critMultiplier?: number;
  /** 暴击率上限（百分点）。 */
  readonly critCap?: number;
  /** 危血线：剩余生命 ≤ 该比例视为「危」（致命一击门控）。 */
  readonly criticalHpFraction?: number;
  /** 开战气血门控与败北回血线（最大气血比例）。 */
  readonly lowHpFraction?: number;
  /** 自动嗑丹触发血线（最大气血比例）。 */
  readonly autoEatHpFraction?: number;
  /** 胜利后休整时长（毫秒）。 */
  readonly victoryRestMs?: number;
  /** 开战门控偏移：斗法层数 + 偏移 ≥ 敌人层数方可开战。 */
  readonly levelGateOffset?: number;
  /** 伤害档阈值：相对期望伤害 < 此值 = light（须 < tierMidMax，语义校验）。 */
  readonly tierLightMax?: number;
  /** 伤害档阈值（须 < tierHeavyMax，语义校验）。 */
  readonly tierMidMax?: number;
  /** 伤害档阈值：≥ 此值 = deadly。 */
  readonly tierHeavyMax?: number;
  /** 玩家属性基线：atk = statAtkBase + statAtkPerLevel × 斗法层数。 */
  readonly statAtkBase?: number;
  readonly statAtkPerLevel?: number;
  /** def = statDefBase + statDefPerLevel × 斗法层数。 */
  readonly statDefBase?: number;
  readonly statDefPerLevel?: number;
  /** 暴击率基线（百分点）。 */
  readonly statCritBase?: number;
  /** 自动再战缺省开关（新档初建与存档未写该字段时的恢复值）。 */
  readonly autoFight?: boolean;
  /** 自动嗑丹缺省开关（同上）。 */
  readonly autoEat?: boolean;
}

/** 修为曲线与气血映射（config.progression 子节，#020）。缺省 = 引擎基线。 */
export interface ProgressionConfig {
  /** 修为层数上限。 */
  readonly maxLevel?: number;
  /** 升层所需修为 = floor(xpPowCoef × L^xpExponent + xpLinearCoef × L)，L 为当前层。 */
  readonly xpPowCoef?: number;
  readonly xpExponent?: number;
  readonly xpLinearCoef?: number;
  /** 气血上限 = hpBase + hpPerLevel × 斗法层数。 */
  readonly hpBase?: number;
  readonly hpPerLevel?: number;
  /** 脱战回血：每秒回复最大气血的比例。 */
  readonly hpRegenPerSec?: number;
}

/** 装备随机词条机制参数（config.affix 子节，#020）。缺省 = 引擎基线。 */
export interface AffixConfig {
  /** 基础标尺：hp 加成参与取值前先除以该值。 */
  readonly hpDivider?: number;
  /** 基础标尺：crit 加成参与取值前先乘该系数。 */
  readonly critScale?: number;
  /** 基础标尺兜底下限。 */
  readonly baseScaleFloor?: number;
  /** 词条值随机波动幅度（乘数 1−v ~ 1+v）。 */
  readonly variance?: number;
}

export interface Config {
  readonly slots: readonly SlotDef[];
  /** 战斗机制与属性基线参数；缺省 = 引擎基线。 */
  readonly combat?: CombatConfig;
  /** 修为曲线与气血映射；缺省 = 引擎基线。 */
  readonly progression?: ProgressionConfig;
  /** 装备词条机制参数；缺省 = 引擎基线。 */
  readonly affix?: AffixConfig;
}

/* ---------- 内容包整体 ---------- */

export interface ContentPack {
  readonly skills: readonly Skill[];
  readonly items: readonly Item[];
  readonly recipes: readonly Recipe[];
  readonly enemies: readonly Enemy[];
  readonly gearDrops: readonly GearDrop[];
  /** 系别键域注册表（#25 键域开放）：enemy.element / affinities / 条件引用的系别键须在此注册。 */
  readonly elements: readonly ElementDef[];
  /** 稀有度档位词表（ADR-016 裁决 ①：validate 强制恒在，引擎零默认）。 */
  readonly rarities: readonly RarityDef[];
  /** 随机词条池（同上，节恒在）。 */
  readonly affixPool: readonly AffixDef[];
  readonly combatText: CombatText;
  /** 系统展示文案（#019 批 2）：reject 展示与兵刃兜底名，必需节。 */
  readonly texts: TextsSection;
  readonly shop: readonly ShopEntry[];
  /** 全局配置（槽位数据化）；可选节，省略=无槽位数据（引擎安全兜底）。 */
  readonly config?: Config;
}
