/**
 * 页面注册表（#46 架构评审二轮·卡1 D6/D7）：九页 PageView 装配单点。
 *
 * Record<TabId, PageView> 编译期穷尽——加页签 = TabId 加值 + 此表加条目 +
 * 壳核 nav 可用性开关三处，漏一处编译红。运行时未知 tab 串由壳核
 * normalizeTab 拦截（warn + 回落修炼页），不再有裸 cast。
 */
import type { PageEnv, PageView, TabId } from './pages/types';
import { createAchievementsPage } from './pages/achievements';
import { createBagPage } from './pages/bag';
import { createCombatPage } from './pages/combat';
import { createCraftPage } from './pages/craft';
import { createDungeonPage } from './pages/dungeon';
import { createRebirthPage } from './pages/rebirth';
import { createShopPage } from './pages/shop';
import { createSkillsPage } from './pages/skills';
import { createTalentsPage } from './pages/talents';

/** 页签渲染顺序（导航模板与运行时校验共用）。 */
export const TAB_ORDER: readonly TabId[] = [
  'skills',
  'craft',
  'combat',
  'dungeon',
  'bag',
  'shop',
  'rebirth',
  'talents',
  'achievements',
];

/** 运行时 tab 值校验（D7：未知串 → false，壳核 warn + 回落）。 */
export const isTabId = (value: string): value is TabId =>
  (TAB_ORDER as readonly string[]).includes(value);

/** 注册表装配：每页一工厂，环境（词表/查表/壳核服务）闭包捕获。 */
export function createPages(env: PageEnv): Record<TabId, PageView> {
  return {
    skills: createSkillsPage(env),
    craft: createCraftPage(env),
    combat: createCombatPage(env),
    dungeon: createDungeonPage(env),
    bag: createBagPage(env),
    shop: createShopPage(env),
    rebirth: createRebirthPage(env),
    talents: createTalentsPage(env),
    achievements: createAchievementsPage(env),
  };
}
