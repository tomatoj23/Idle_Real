/**
 * content 包的结构视图（issue #3）。
 *
 * "引擎零内容感知"的落地方式：不 import @wendao/content，只按内容包
 * 约定形状读取注入对象；缺节/缺字段一律安全兜底，绝不因内容缺失崩溃。
 */
import type { GameContent } from './types.js';
import { levelFromXp, maxHpForLevel } from './progression.js';

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

/** 斗法层数（内容包里 kind=combat 的技能；无则按 0 层）。 */
export function combatLevelOf(
  content: GameContent,
  skills: Readonly<Record<string, { xp?: number }>>,
): number {
  const combat = skillsOf(content).find((skill) => skill.kind === 'combat');
  return combat ? levelFromXp(skills[combat.id]?.xp ?? 0) : 0;
}

/** 玩家气血上限：斗法修为映射（旧版基线公式）。 */
export function playerMaxHp(
  content: GameContent,
  skills: Readonly<Record<string, { xp?: number }>>,
): number {
  return maxHpForLevel(combatLevelOf(content, skills));
}
