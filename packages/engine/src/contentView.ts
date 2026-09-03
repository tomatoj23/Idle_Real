/**
 * content 包的结构视图（issue #3）。
 *
 * "引擎零内容感知"的落地方式：不 import @wendao/content，只按内容包
 * 约定形状读取注入对象；缺节/缺字段一律安全兜底，绝不因内容缺失崩溃。
 */
import type { GameContent } from './types.js';
import { levelFromXp, maxHpForLevel } from './progression.js';
import {
  aggregateStat,
  type AggregationContext,
  type Contribution,
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

export interface ItemBonusesView {
  readonly atk?: number;
  readonly def?: number;
  readonly hp?: number;
  readonly crit?: number;
}

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
  /** pill 类：持续增益。 */
  readonly effect?: ItemEffectView;
  /** pill 类：即时恢复（percent = 气血上限比例）。 */
  readonly heal?: { readonly percent: number };
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

/** 佩戴槽位视图（config.slots 数据化，issue #13）。 */
export interface SlotView {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
}

/**
 * 槽位列表：由内容包 config.slots 驱动（换包加/减槽引擎零改动）。
 * 缺省安全兜底：无 config 节 / 无 slots / 形状非法 → 空列表。
 */
export function slotsOf(content: GameContent): readonly SlotView[] {
  const slots = (content as { config?: { slots?: unknown } }).config?.slots;
  return Array.isArray(slots) ? (slots as SlotView[]) : [];
}

/** 斗法层数（内容包里 kind=combat 的技能；无则按 0 层）。 */
export function combatLevelOf(
  content: GameContent,
  skills: Readonly<Record<string, { xp?: number }>>,
): number {
  const combat = skillsOf(content).find((skill) => skill.kind === 'combat');
  return combat ? levelFromXp(skills[combat.id]?.xp ?? 0) : 0;
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
  /** 动词池键（claw/magic…）；缺省按 claw。 */
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
}

export function enemiesOf(content: GameContent): readonly EnemyView[] {
  const enemies = (content as { enemies?: unknown }).enemies;
  return Array.isArray(enemies) ? (enemies as EnemyView[]) : [];
}

export function findEnemy(content: GameContent, enemyId: string): EnemyView | undefined {
  return enemiesOf(content).find((enemy) => enemy.id === enemyId);
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
  readonly fistName?: unknown;
  readonly reject?: unknown;
} {
  const texts = (content as { texts?: unknown }).texts;
  return texts && typeof texts === 'object' && !Array.isArray(texts)
    ? (texts as { fistName?: unknown; reject?: unknown })
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
  const base = maxHpForLevel(combatLevelOf(content, skills));
  const { value } = aggregateStat('hp', base, contributions, context);
  return Math.round(value); // 三区浮点运算的累积误差不容差 1 点
}
