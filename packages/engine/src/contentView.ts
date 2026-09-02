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

export interface ItemView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly type: string;
  readonly sell: number;
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
