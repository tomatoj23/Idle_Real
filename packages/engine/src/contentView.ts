/**
 * content 包的结构视图（issue #3）。
 *
 * "引擎零内容感知"的落地方式：不 import @wendao/content，只按内容包
 * 约定形状读取注入对象；缺节/缺字段一律安全兜底，绝不因内容缺失崩溃。
 */
import type { GameContent, PlayerStatsView } from './types.js';
import {
  BASE_PROGRESSION,
  levelFromXp,
  maxHpForLevel,
  type ProgressionParams,
} from './progression.js';
import {
  BASE_DAMAGE_MECHANICS,
  ELEMENT_COMBAT_PRIMITIVES,
  type DamageMechanics,
  type ElementCombatPrimitive,
} from './combat.js';
import { BASE_AFFIX_PARAMS, type AffixParams, type GearBonuses } from './gear.js';
import {
  aggregateStat,
  type AggregationContext,
  type Contribution,
  type Modifier,
} from './modifiers.js';

export interface StackView {
  readonly item: string;
  readonly count: number;
}

export interface ByproductView {
  readonly item: string;
  readonly chance: number;
}

export interface ActivityView {
  readonly name: string;
  readonly unlockLevel: number;
  readonly interval: number;
  readonly exp: number;
  readonly output: StackView;
  readonly byproduct?: ByproductView;
}

export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly kind: string;
  readonly activities?: readonly ActivityView[];
}

/**
 * 物品基础加成视图（#021 批 4 键域开放）：与 gear.ts GearBonuses 同一
 * 类型（单一来源），键 = stat id，值 = flat 基础量。
 */
export type ItemBonusesView = GearBonuses;

/** 丹药持续增益（duration 毫秒；multipliers 键 = 属性 id，值 = 倍率）。 */
export interface ItemEffectView {
  readonly duration: number;
  readonly multipliers?: Readonly<Record<string, number>>;
  /** 额外暴击率（百分点）。 */
  readonly crit?: number;
}

export interface ItemView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly type: string;
  readonly sell: number;
  /** equip 类：佩戴槽位 id。 */
  readonly slot?: string;
  /** equip 类：基础加成模板（稀有度/词条在实例化时另行掷定）。 */
  readonly bonuses?: ItemBonusesView;
  /**
   * equip 类（引擎只消费 weapon 槽位物品）：动词池键（开放键域，#021 批 4）。
   * 缺省/非法 = 引擎兜底键 basic 池；存在性由内容包校验强制。
   */
  readonly verbStyle?: string;
  /** consumable 类：持续增益。 */
  readonly effect?: ItemEffectView;
  /** consumable 类：即时恢复（percent = 气血上限比例）。 */
  readonly heal?: { readonly percent: number };
  /**
   * 系别（#15，键域 = elements 注册表）：引擎只消费武器槽物品——佩戴后玩家
   * 攻击携带该系（机制签名/亲和度/风味句路由的攻方来源）；其余槽位为未来留门。
   */
  readonly element?: string;
}

export interface ShopEntryView {
  readonly item: string;
  readonly price: number;
}

export function skillsOf(content: GameContent): readonly SkillView[] {
  const skills = (content as { skills?: unknown }).skills;
  return Array.isArray(skills) ? (skills as SkillView[]) : [];
}

export function itemsOf(content: GameContent): readonly ItemView[] {
  const items = (content as { items?: unknown }).items;
  return Array.isArray(items) ? (items as ItemView[]) : [];
}

export function shopOf(content: GameContent): readonly ShopEntryView[] {
  const shop = (content as { shop?: unknown }).shop;
  return Array.isArray(shop) ? (shop as ShopEntryView[]) : [];
}

export function findSkill(content: GameContent, skillId: string): SkillView | undefined {
  return skillsOf(content).find((skill) => skill.id === skillId);
}

/** 按技能 id + 活动下标取活动；越界/缺技能返回 undefined。 */
export function findActivity(
  content: GameContent,
  skillId: string,
  index: number,
): { readonly skill: SkillView; readonly activity: ActivityView } | undefined {
  const skill = findSkill(content, skillId);
  const activity = skill?.activities?.[index];
  return skill && activity ? { skill, activity } : undefined;
}

export function findItem(content: GameContent, itemId: string): ItemView | undefined {
  return itemsOf(content).find((item) => item.id === itemId);
}

export function findShopEntry(content: GameContent, itemId: string): ShopEntryView | undefined {
  return shopOf(content).find((entry) => entry.item === itemId);
}

/* ---------- 配方与炼制（#5 垂直切片③） ---------- */

/**
 * 配方视图（recipes 节条目）：无 id 关系行，`index` = 包内 recipes 数组
 * 下标（活动槽持久化该下标，恢复时按配方名做稳定引用校验，ADR-015）。
 */
export interface RecipeView {
  readonly name: string;
  /** 所属技艺 id（craft 类技能，包校验强制）。 */
  readonly skill: string;
  readonly unlockLevel: number;
  readonly output: StackView;
  /** 材料表：物品 id → 数量（失败时全损，只返还修为）。 */
  readonly materials: Readonly<Record<string, number>>;
  /** 基础成功率（0~1）；必定成功（炼器）填 1。 */
  readonly successRate: number;
  /** 单次炼制耗时（毫秒）。 */
  readonly interval: number;
  readonly exp: number;
}

/** 配方列表：缺节/形状非法 → 空表（安全兜底，绝不因内容缺失崩溃）。 */
export function recipesOf(content: GameContent): readonly RecipeView[] {
  const recipes = (content as { recipes?: unknown }).recipes;
  return Array.isArray(recipes) ? (recipes as RecipeView[]) : [];
}

/** 按包内下标取配方；越界返回 undefined。 */
export function findRecipe(content: GameContent, index: number): RecipeView | undefined {
  return recipesOf(content)[index];
}

/** 佩戴槽位视图（config.slots 数据化，issue #13；role #14 放宽）。 */
export interface SlotView {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  /** 槽位角色（开放键域）：引擎只消费 'weapon'；缺省按 id === 'weapon' 兜底。 */
  readonly role?: string;
}

/**
 * 槽位列表：由内容包 config.slots 驱动（换包加/减槽引擎零改动）。
 * 缺省安全兜底：无 config 节 / 无 slots / 形状非法 → 空列表。
 */
export function slotsOf(content: GameContent): readonly SlotView[] {
  const slots = (content as { config?: { slots?: unknown } }).config?.slots;
  return Array.isArray(slots) ? (slots as SlotView[]) : [];
}

/**
 * 武器槽位解析（#14 放宽，'weapon' 键不再是引擎硬编码）：先查 role === 'weapon'
 * 的槽位（role 开放键域中引擎唯一消费者），未声明 role 的包按 id === 'weapon'
 * 兜底识别——自定义武器槽改名 = 纯 JSON 改动。无槽位表（#16 前旧包形态）回落
 * 起步约定键 'weapon'（既有包零破坏）。
 */
export function weaponSlotOf(content: GameContent): string | undefined {
  const slots = slotsOf(content);
  if (slots.length === 0) return 'weapon';
  return slots.find((slot) => slot.role === 'weapon')?.id ?? slots.find((slot) => slot.id === 'weapon')?.id;
}

/** 斗法层数（内容包里 kind=combat 的技能；无则按 0 层）。修为曲线读 config.progression。 */
export function combatLevelOf(
  content: GameContent,
  skills: Readonly<Record<string, { xp?: number }>>,
): number {
  const combat = skillsOf(content).find((skill) => skill.kind === 'combat');
  return combat ? levelFromXp(skills[combat.id]?.xp ?? 0, progressionParamsOf(content)) : 0;
}

/* ---------- 敌人（issue #4） ---------- */

/** 敌人掉落行：物品 id + 掉率。 */
export interface EnemyDropView {
  readonly item: string;
  readonly chance: number;
}

export interface EnemyView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly level: number;
  /**
   * 动词池键（开放键域，#021 批 4，ADR-016 裁决 ⑦）：须在内容包
   * combatText.verbs 注册（校验关卡）；'claw'/'magic' 只是官方包的内容
   * 约定，引擎不感知。缺省（防御路径）按引擎兜底 basic 池。
   */
  readonly kind?: string;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  /** 攻击间隔（毫秒）。 */
  readonly attackInterval?: number;
  readonly exp: number;
  /** 击杀灵石掉落区间。 */
  readonly gold?: { readonly min: number; readonly max: number };
  readonly drops?: readonly EnemyDropView[];
  /** 系别（#15 起启用）；缺省 = 凡击。 */
  readonly element?: string;
  /**
   * 系别亲和（#15，#25 预留字段的引擎消费面）：键 = 系别键，值 = 受该系
   * 攻击的伤害调整百分点（负 = 抗性被克，正 = 易伤克制）；缺省/缺键 = 无调整。
   * 形状与 content 包 Affinities（Partial Record）同构，坏键防御交 affinityMultiplier。
   */
  readonly affinities?: Readonly<Partial<Record<string, number>>>;
}

export function enemiesOf(content: GameContent): readonly EnemyView[] {
  const enemies = (content as { enemies?: unknown }).enemies;
  return Array.isArray(enemies) ? (enemies as EnemyView[]) : [];
}

export function findEnemy(content: GameContent, enemyId: string): EnemyView | undefined {
  return enemiesOf(content).find((enemy) => enemy.id === enemyId);
}

/* ---------- 系别（#15：结构签名机制面，ADR-012） ---------- */

/**
 * 系别机制签名（elements[].signature，#15）：content 声明该系占用的引擎
 * 机制原语与系数——原语归引擎闭集注册表（combat.ts ELEMENT_COMBAT_PRIMITIVES，
 * 存在性由包校验强制），数值/时长全归 content（换包改系数引擎零改动）。
 */
export interface ElementSignatureView {
  /** 机制原语键（engine 闭集：defenseBreak/slow/swift；火/木 DoT 原语第二波另票）。 */
  readonly primitive: string;
  /** 原语参数：defenseBreak/swift = 缩减比例（0~1），slow = 延长比例（0~1）。 */
  readonly value?: number;
  /** 临时态时长（毫秒）；机械原语必填（包校验）。 */
  readonly duration?: number;
}

/** 系别视图（elements 节条目）：包内系别键域注册表（#25）+ 机制签名（#15）。 */
export interface ElementView {
  readonly id: string;
  readonly name: string;
  readonly signature?: ElementSignatureView;
}

/** 系别列表：缺节/形状非法 → 空表（安全兜底，无系别玩法）。 */
export function elementsOf(content: GameContent): readonly ElementView[] {
  const elements = (content as { elements?: unknown }).elements;
  return Array.isArray(elements) ? (elements as ElementView[]) : [];
}

/** 按系别键取定义；未注册返回 undefined。 */
export function findElementOf(content: GameContent, elementId: string): ElementView | undefined {
  return elementsOf(content).find((element) => element.id === elementId);
}

/**
 * 系别机制签名解析：元素未注册 / 未声明签名 / 签名形状非法（原语不在引擎
 * 注册表、参数非正数）一律 undefined——无签名 = 纯风味系，机制层零降级路径。
 */
export function signatureOf(
  content: GameContent,
  elementId: string | undefined,
): ElementSignatureView | undefined {
  const signature = elementId !== undefined ? findElementOf(content, elementId)?.signature : undefined;
  if (!signature || typeof signature !== 'object') return undefined;
  if (typeof signature.primitive !== 'string') return undefined;
  if (!ELEMENT_COMBAT_PRIMITIVES.includes(signature.primitive as ElementCombatPrimitive)) return undefined;
  if (typeof signature.duration !== 'number' || !(signature.duration > 0)) return undefined;
  if (typeof signature.value !== 'number' || !(signature.value > 0)) return undefined;
  return signature;
}

/* ---------- 异宝掉落表 ---------- */

export interface GearDropView {
  readonly enemy: string;
  readonly chance: number;
  readonly pool: readonly string[];
}

export function gearDropsOf(content: GameContent): readonly GearDropView[] {
  const drops = (content as { gearDrops?: unknown }).gearDrops;
  return Array.isArray(drops) ? (drops as GearDropView[]) : [];
}

export function findGearDrop(content: GameContent, enemyId: string): GearDropView | undefined {
  return gearDropsOf(content).find((drop) => drop.enemy === enemyId);
}

/* ---------- 稀有度与词条池（#018 批 1，ADR-016 词表零默认） ---------- */

/** 稀有度档位视图（content 包 rarities 节条目，形状与 @wendao/content 的 RarityDef 同形）。 */
export interface RarityView {
  readonly id: string;
  readonly name: string;
  /** 掷点权重（rollRarity 按占比归一化）。 */
  readonly weight: number;
  /** 基础加成倍率。 */
  readonly mult: number;
  /** 随机词条数。 */
  readonly affix: number;
  /** 卖价倍率。 */
  readonly sell: number;
  /** 熔炼产出（#14）：熔炼该档装备所得器屑数量；缺省 = 引擎基线 1。 */
  readonly smelt?: number;
  /** UI 特判开关（ADR-016 裁决 ④）。 */
  readonly showcase?: boolean;
}

/** 随机词条池条目视图（content 包 affixPool 节条目）。 */
export interface AffixPoolView {
  readonly name: string;
  readonly stat: string;
  /** 量级系数：词条值 = max(1, round(基础标尺 × scale × 波动))。 */
  readonly scale: number;
}

/**
 * 稀有度词表：由内容包 rarities 节驱动（换档位/概率 = 纯 JSON 改动，
 * ADR-016 裁决 ① 词表零默认）。缺省安全兜底：缺节/形状非法 → 空表，
 * 引擎按中性值降级，绝不因内容缺失崩溃。
 */
export function raritiesOf(content: GameContent): readonly RarityView[] {
  const rarities = (content as { rarities?: unknown }).rarities;
  return Array.isArray(rarities) ? (rarities as RarityView[]) : [];
}

/** 随机词条池：同上，缺节 → 空池。 */
export function affixPoolOf(content: GameContent): readonly AffixPoolView[] {
  const pool = (content as { affixPool?: unknown }).affixPool;
  return Array.isArray(pool) ? (pool as AffixPoolView[]) : [];
}

/**
 * 档位解析：命中返回该档；未命中（存档坏键/内容包改档位）回退**第一档**
 * ——安全兜底路径而非默认表（ADR-016）；空表返回 undefined（更深一层的
 * 中性降级：mult/sell 取 1、零词条、展示名省略前缀）。
 */
export function findRarity(content: GameContent, rarity: string): RarityView | undefined {
  const table = raritiesOf(content);
  return table.find((def) => def.id === rarity) ?? table[0];
}

/* ---------- 器胚与铭纹（#14：装备构筑循环的内容面） ---------- */

/**
 * 器胚视图（items 节 type=blank 条目）：装备底材模板——槽位 + 掉落层数段 +
 * 纹阶天花板 + 偏好标签 + 胚纹（固有词条）。从 itemsOf 过滤派生，缺节 → 空表。
 */
export interface BlankView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly slot: string;
  /** 掉落层数段（秘境层数，1 起）；缺省 = 不限层。 */
  readonly floorRange?: { readonly min: number; readonly max: number };
  /** 纹阶天花板区间 T1~T3；重铸与实例化掷阶都不得突破。 */
  readonly tierRange?: { readonly min: number; readonly max: number };
  /** 偏好标签：铭纹抽取权重 = 基础 × (1+匹配数×加成)。 */
  readonly preferredTags?: readonly string[];
  /** 胚纹：固有词条，固定非随机，实例化时直接附加。 */
  readonly inherentModifiers?: readonly Modifier[];
}

/** 铭纹视图（items 节 type=inscription 条目）：三阶数值表 + feature + tags。 */
export interface InscriptionView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  /** 三阶数值表：下标 0/1/2 = 纹阶 T1/T2/T3。 */
  readonly tiers: readonly (readonly Modifier[])[];
  /** 机制型特色表达（原语未注册时引擎忽略，零新增）。 */
  readonly feature?: { readonly primitive: string; readonly condition?: Modifier['condition']; readonly value?: number };
  /** 标签加权抽取归类（ADR-015）。 */
  readonly tags?: readonly string[];
}

/** 器胚列表：items 节 type=blank 条目（换包增减器胚 = 纯 JSON 改动）。 */
export function blanksOf(content: GameContent): readonly BlankView[] {
  const blanks = itemsOf(content).filter((item) => item.type === 'blank');
  return blanks as unknown as readonly BlankView[];
}

export function findBlank(content: GameContent, blankId: string): BlankView | undefined {
  return blanksOf(content).find((blank) => blank.id === blankId);
}

/** 铭纹池：items 节 type=inscription 条目（扩池 = 纯 JSON 改动，引擎零改动）。 */
export function inscriptionsOf(content: GameContent): readonly InscriptionView[] {
  const inscriptions = itemsOf(content).filter((item) => item.type === 'inscription');
  return inscriptions as unknown as readonly InscriptionView[];
}

export function findInscription(content: GameContent, inscriptionId: string): InscriptionView | undefined {
  return inscriptionsOf(content).find((inscription) => inscription.id === inscriptionId);
}

/* ---------- 战斗词库（CTEXT 数据化，issue #2/#4） ---------- */

/**
 * 战斗词库视图：按内容包约定形状读取 combatText 节，
 * 缺节返回空对象（combat.ts 全链路安全兜底）。
 * #019 批 2 扩：templates/notes/summary/compare 四键（文案模板出池）。
 */
export function combatTextOf(content: GameContent): {
  readonly verbs?: unknown;
  readonly moves?: unknown;
  readonly openings?: unknown;
  readonly critIntro?: unknown;
  readonly cons?: unknown;
  readonly fatal?: unknown;
  readonly templates?: unknown;
  readonly notes?: unknown;
  readonly summary?: unknown;
  readonly compare?: unknown;
} {
  const text = (content as { combatText?: unknown }).combatText;
  return text && typeof text === 'object' && !Array.isArray(text)
    ? (text as {
        verbs?: unknown;
        moves?: unknown;
        openings?: unknown;
        critIntro?: unknown;
        cons?: unknown;
        fatal?: unknown;
        templates?: unknown;
        notes?: unknown;
        summary?: unknown;
        compare?: unknown;
      })
    : {};
}

/**
 * 系统展示文案视图（#019 批 2）：texts 节按形状读取，
 * 缺节返回空对象（game.ts 按键名回显降级，零崩溃）。
 */
export function textsOf(content: GameContent): {
  readonly basicName?: unknown;
  readonly reject?: unknown;
} {
  const texts = (content as { texts?: unknown }).texts;
  return texts && typeof texts === 'object' && !Array.isArray(texts)
    ? (texts as { basicName?: unknown; reject?: unknown })
    : {};
}

/**
 * 玩家气血上限：斗法修为映射基线，再走修饰符聚合管线（issue #13，ADR-011）。
 *
 * 这是管线的第一个引擎内消费点——装备加成（#4）、丹药 buff（#4）、
 * 系别抗性（#15）将来一律产出 Contribution 注入，不存在第二条直算路径。
 * 无贡献时行为与旧基线完全一致（管线空转）。
 * 注意：需要事件语境（breakdown.applied）的下游（#4 战斗事件）应直接调
 * aggregateStat 取完整快照，不要经本函数（本函数只回数值上限）。
 */
export function playerMaxHp(
  content: GameContent,
  skills: Readonly<Record<string, { xp?: number }>>,
  contributions: readonly Contribution[] = [],
  context: AggregationContext = {},
): number {
  const base = maxHpForLevel(combatLevelOf(content, skills), progressionParamsOf(content));
  const { value } = aggregateStat('hp', base, contributions, context);
  return Math.round(value); // 三区浮点运算的累积误差不容差 1 点
}

/* ---------- 玩法参数视图（#020 批 3，ADR-016 裁决 ① 分策：引擎基线 + config 覆盖） ---------- */

/**
 * 战斗参数视图（已解析基线）：config.combat 缺省字段逐项回落引擎基线。
 * 结构上兼容 DamageMechanics，可直接传给 combat.ts 解算函数。
 */
export interface CombatParamsView extends DamageMechanics {
  /** 玩家攻击间隔（毫秒）；敌人未配 attackInterval 时的缺省出招间隔。 */
  readonly playerAttackInterval: number;
  readonly critMultiplier: number;
  readonly critCap: number;
  readonly lowHpFraction: number;
  readonly autoEatHpFraction: number;
  readonly victoryRestMs: number;
  readonly levelGateOffset: number;
  readonly statAtkBase: number;
  readonly statAtkPerLevel: number;
  readonly statDefBase: number;
  readonly statDefPerLevel: number;
  readonly statCritBase: number;
  readonly autoFight: boolean;
  readonly autoEat: boolean;
}

/** 引擎基线（旧版 data.js 沿革）：间隔 2200、暴击 ×1.6/上限 75、门控偏移 +2 等。 */
export const BASE_COMBAT_PARAMS: CombatParamsView = {
  ...BASE_DAMAGE_MECHANICS,
  playerAttackInterval: 2200,
  critMultiplier: 1.6,
  critCap: 75,
  lowHpFraction: 0.3,
  autoEatHpFraction: 0.5,
  victoryRestMs: 1500,
  levelGateOffset: 2,
  statAtkBase: 8,
  statAtkPerLevel: 3,
  statDefBase: 2,
  statDefPerLevel: 1.2,
  statCritBase: 5,
  autoFight: true,
  autoEat: true,
};

/** 战斗参数：config.combat 覆盖基线（字段全可选，缺省 = 引擎基线）。 */
export function combatParamsOf(content: GameContent): CombatParamsView {
  const combat = (content as { config?: { combat?: unknown } }).config?.combat;
  return resolveParams(combat, BASE_COMBAT_PARAMS);
}

/** 修为曲线与气血映射参数：config.progression 覆盖基线。 */
export function progressionParamsOf(content: GameContent): ProgressionParams {
  const progression = (content as { config?: { progression?: unknown } }).config?.progression;
  return resolveParams(progression, BASE_PROGRESSION);
}

/** 装备词条机制参数：config.affix 覆盖基线。 */
export function affixParamsOf(content: GameContent): AffixParams {
  const affix = (content as { config?: { affix?: unknown } }).config?.affix;
  return resolveParams(affix, BASE_AFFIX_PARAMS);
}

/* ---------- 炼制参数（#5，ADR-016 裁决 ① 分策：引擎基线 + config.crafting 覆盖） ---------- */

/**
 * 炼制参数视图（已解析基线）。旧版 craft 参数位（#5 票评 round3 A4 清单）
 * 全部数据化：成功率层加成/上限、失败修为返还、稀有度偏置系数——
 * per-recipe 差异归 Recipe.successRate；「炼器必得」由 successRate: 1 表达，
 * 引擎零规则硬编码。
 */
export interface CraftParamsView {
  /** 成功率层加成：每层技艺 +该值（旧版 js/game.js:410 沿革 +0.004/层）。 */
  readonly successPerLevel: number;
  /** 成功率上限：层级加成抬升的天花板（旧版 0.99）。 */
  readonly successCap: number;
  /** 失败修为返还比例：失败仍得 round(配方修为 × 该值)，材料全损（旧版 js/game.js:412）。 */
  readonly failExpRefund: number;
  /** 装备产出稀有度偏置系数：掷档点数上移 技艺层 × 该值（旧版 js/game.js:95 沿革 0.0004）。 */
  readonly rarityBiasPerLevel: number;
}

/** 引擎基线（旧版 game.js 沿革）；config.crafting 缺省字段逐项回落到此。 */
export const BASE_CRAFT_PARAMS: CraftParamsView = {
  successPerLevel: 0.004,
  successCap: 0.99,
  failExpRefund: 0.25,
  rarityBiasPerLevel: 0.0004,
};

/** 炼制参数：config.crafting 覆盖基线（可选子节，缺省 = 引擎基线）。 */
export function craftParamsOf(content: GameContent): CraftParamsView {
  const crafting = (content as { config?: { crafting?: unknown } }).config?.crafting;
  return resolveParams(crafting, BASE_CRAFT_PARAMS);
}

/* ---------- 装备构筑循环参数（#14，ADR-016 裁决 ① 分策：引擎基线 + config.gear 覆盖） ---------- */

/**
 * 装备构筑循环参数视图（已解析基线）。重铸消耗与标签加权系数是机制参数位；
 * shardItem 是内容引用（器屑物品 id），缺省 = 无器屑经济（熔炼/重铸零降级路径）。
 */
export interface GearParamsView {
  /** 器屑物品 id（熔炼产物/重铸消耗）；undefined = 该包无熔炼/重铸玩法。 */
  readonly shardItem?: string;
  /** 单条铭纹重铸消耗（器屑数量）。 */
  readonly reforgeCost: number;
  /** 标签加权系数：铭纹抽取权重 = 基础 × (1+匹配数×该值)。 */
  readonly tagWeightPerMatch: number;
}

/** 引擎基线；config.gear 缺省字段逐项回落到此。 */
export const BASE_GEAR_PARAMS: Omit<GearParamsView, 'shardItem'> = {
  reforgeCost: 1,
  tagWeightPerMatch: 1,
};

/** 装备构筑循环参数：config.gear 覆盖基线（可选子节；shardItem 缺省 = 无器屑经济）。 */
export function gearParamsOf(content: GameContent): GearParamsView {
  const gear = (content as { config?: { gear?: unknown } }).config?.gear;
  const source =
    gear !== null && typeof gear === 'object' && !Array.isArray(gear)
      ? (gear as Record<string, unknown>)
      : undefined;
  const rawShard = source?.shardItem;
  return {
    ...resolveParams(source, BASE_GEAR_PARAMS),
    shardItem:
      typeof rawShard === 'string' && rawShard.length > 0 ? rawShard : undefined,
  };
}

/**
 * 炼制成功率（单一来源，#5）：min(cap, 基础 + perLevel × 技艺层)，但**不低于
 * 基础值**——否则 successRate: 1 的「炼器必得」会被上限击穿（票评裁决点：
 * 必得由内容表达，引擎只保证上限只作用于层级加成的抬升段）。
 * 引擎掷点与 UI 成功率展示同调此函数，禁另写第二份公式。
 */
export function craftSuccessRateOf(
  content: GameContent,
  skills: Readonly<Record<string, { xp?: number }>>,
  recipe: RecipeView,
): number {
  const params = craftParamsOf(content);
  const level = levelFromXp(skills[recipe.skill]?.xp ?? 0, progressionParamsOf(content));
  const bonus = Math.max(0, params.successPerLevel) * level;
  return Math.min(
    1,
    Math.max(recipe.successRate, Math.min(params.successCap, recipe.successRate + bonus)),
  );
}

/**
 * 配方材料缺口（单一来源，#5）：返回数量不足的材料 id 列表。
 * 引擎缺料停炉判定与 UI 材料着色同调此函数，禁另写第二份比较式。
 */
export function craftMissingOf(
  recipe: RecipeView,
  items: Readonly<Record<string, number>>,
): string[] {
  return Object.entries(recipe.materials)
    .filter(([matId, need]) => (items[matId] ?? 0) < need)
    .map(([matId]) => matId);
}

/**
 * 逐字段回落解析：以基线对象为键域模板，config 子节同名字段合法
 * （number 有限 / boolean）才覆盖，其余原样回落基线。
 * 非法子节整体（非对象/数组）= 全基线，绝不因形状错误崩溃。
 */
function resolveParams<T extends object>(raw: unknown, base: T): T {
  const out: Record<string, unknown> = {};
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
  for (const [key, fallback] of Object.entries(base)) {
    const value = source?.[key];
    if (typeof fallback === 'boolean') {
      out[key] = typeof value === 'boolean' ? value : fallback;
    } else {
      out[key] = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }
  }
  return out as T;
}

/* ---------- 坊市购买力（N4 判定侧单一来源，#26） ---------- */

/**
 * 坊市购买力视图：可否买一件。与引擎 shop:buy 拒绝判定同一比较式
 * （gold ≥ price，单件 cost = price × 1）——UI 禁壳内复制 gold >= price
 * 公式（先例 enemyGateOf 的 N1 收敛）。货架未收录的物品按不可购买兜底。
 */
export function shopAffordOf(content: GameContent, gold: number, itemId: string): boolean {
  const entry = findShopEntry(content, itemId);
  return entry !== undefined && gold >= entry.price;
}

/* ---------- 开战门控（N1 判定侧单一来源，#020） ---------- */

/** 敌人开战门控视图：锁定判定与展示所需层数（与引擎 combat:start 判定同源）。 */
export interface EnemyGateView {
  /** 斗法层数 + 门控偏移 < 敌人层数 → 锁定（引擎 combat:start 拒绝同一公式）。 */
  readonly locked: boolean;
  /** 展示用最低斗法层数：敌人层数 − 门控偏移（钳 0）。 */
  readonly requiredLevel: number;
}

/**
 * 敌人开战门控（引擎单一来源）：UI 锁定态/需层数展示一律调此函数，
 * 禁止复制 clv+offset 公式（N1 收敛，#020）。敌人不存在时按锁定兜底
 * （渲染防御路径，引擎 dispatch 侧 not-found 兜底语义一致）。
 */
export function enemyGateOf(
  content: GameContent,
  skills: Readonly<Record<string, { xp?: number }>>,
  enemyId: string,
): EnemyGateView {
  const enemy = findEnemy(content, enemyId);
  const offset = combatParamsOf(content).levelGateOffset;
  if (!enemy) return { locked: true, requiredLevel: 0 };
  const clv = combatLevelOf(content, skills);
  return {
    locked: clv + offset < enemy.level,
    requiredLevel: Math.max(0, enemy.level - offset),
  };
}

/* ---------- 玩家战力读数（软提示对照，#7 推荐战力） ---------- */

/**
 * 玩家战力（#7 软提示读数）：atk + def + maxHp/10 + crit 的确定性合成，
 * 供层表 recommendedPower 推荐战力区间（content 软提示字段）同量纲对照。
 * 引擎单一来源，壳零公式（shopAffordOf 同款收敛）；快照 stats 直接代入。
 */
export function powerOf(stats: PlayerStatsView): number {
  return Math.round(stats.atk + stats.def + stats.maxHp / 10 + stats.crit);
}
