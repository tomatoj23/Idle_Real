/**
 * 内容包整体校验（issue #2）。
 *
 * 两道关卡：
 * 1. **schema 校验**：各内容节对照 src/schemas/ 下的 JSON Schema，
 *    逐字段上报（JSON Pointer 路径 + 关键字）。
 * 2. **语义校验**：schema 表达不了的跨引用与形态规则——
 *    - id 去重（items / skills / enemies）；
 *    - 掉落池 id 必须存在于 items（异宝池还须为 equip 类）；
 *    - 武器 id 与敌人 id 必须在 combatText.moves 注册招式名；
 *    - moves 注册键不得悬空（只能是 fist、武器 id 或敌人 id）；
 *    - fist 兜底招式与四系动词池恒需存在（引擎安全兜底约定）；
 *    - 配方材料、产出、所属技艺，活动产出/副产出，敌人掉落，坊市
 *      货架的物品 id 必须存在（旧版 data.js 曾因材料 id 打错而埋雷，
 *      教训固化为校验）；
 *    - 物品按类型的字段形态（equip 须 slot+bonuses、pill 须
 *      effect/heal、mat 不得携带任何装备/丹药字段）。
 */

import defaultPackJson from './content/default.json';
import combatTextSchemaJson from './schemas/combat-text.schema.json';
import enemySchemaJson from './schemas/enemy.schema.json';
import gearDropSchemaJson from './schemas/gear-drop.schema.json';
import itemSchemaJson from './schemas/item.schema.json';
import recipeSchemaJson from './schemas/recipe.schema.json';
import shopSchemaJson from './schemas/shop.schema.json';
import skillSchemaJson from './schemas/skill.schema.json';
import type { ContentPack, Item, Skill } from './types.js';
import { validateContent } from './validate.js';
import type { ContentError, JsonSchema } from './validate.js';

const skillSchema = skillSchemaJson as unknown as JsonSchema;
const itemSchema = itemSchemaJson as unknown as JsonSchema;
const recipeSchema = recipeSchemaJson as unknown as JsonSchema;
const enemySchema = enemySchemaJson as unknown as JsonSchema;
const gearDropSchema = gearDropSchemaJson as unknown as JsonSchema;
const combatTextSchema = combatTextSchemaJson as unknown as JsonSchema;
const shopSchema = shopSchemaJson as unknown as JsonSchema;

/** 内容节 → 该节值的独立 schema。 */
const SECTION_SCHEMAS = {
  skills: skillSchema,
  items: itemSchema,
  recipes: recipeSchema,
  enemies: enemySchema,
  gearDrops: gearDropSchema,
  combatText: combatTextSchema,
  shop: shopSchema,
} as const;

type SectionName = keyof typeof SECTION_SCHEMAS;

const SECTION_NAMES = Object.keys(SECTION_SCHEMAS) as readonly SectionName[];

export type PackValidationResult =
  | { readonly ok: true; readonly pack: ContentPack }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

/** 校验完整内容包：先过各节 schema，再跑跨引用与形态语义检查。 */
export function validateContentPack(json: unknown): PackValidationResult {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return {
      ok: false,
      errors: [{ path: '', keyword: 'type', message: '内容包必须是对象' }],
    };
  }

  const errors: ContentError[] = [];
  const pack = json as Record<string, unknown>;

  for (const section of SECTION_NAMES) {
    const value = pack[section];
    if (value === undefined) {
      errors.push({ path: `/${section}`, keyword: 'required', message: '缺少内容节' });
      continue;
    }
    const result = validateContent(value, SECTION_SCHEMAS[section]);
    if (!result.ok) {
      for (const e of result.errors) {
        errors.push({ ...e, path: `/${section}${e.path}` });
      }
    }
  }

  // schema 已破则不做语义检查：畸形的节会让跨引用检查产生噪音级联。
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  semanticChecks(json as unknown as ContentPack, errors);
  return errors.length === 0
    ? { ok: true, pack: json as unknown as ContentPack }
    : { ok: false, errors };
}

/** 加载并强校验默认内容包；失败即抛错（启动期 fail-fast）。 */
export function loadDefaultContent(): ContentPack {
  const result = validateContentPack(defaultPackJson as unknown);
  if (!result.ok) {
    throw new Error(`默认内容包校验失败：\n${formatContentErrors(result.errors)}`);
  }
  return result.pack;
}

/** 把字段级错误列表格式化为多行文本（红屏/日志用）。 */
export function formatContentErrors(errors: readonly ContentError[]): string {
  return errors
    .map((e) => `${e.path === '' ? '/' : e.path} [${e.keyword}] ${e.message}`)
    .join('\n');
}

/* ==================== 语义检查 ==================== */

function semanticChecks(pack: ContentPack, errors: ContentError[]): void {
  const itemIndex = indexIds(pack.items);
  const skillIndex = indexIds(pack.skills);
  const enemyIndex = indexIds(pack.enemies);

  pushDuplicates(pack.items, '/items', errors);
  pushDuplicates(pack.skills, '/skills', errors);
  pushDuplicates(pack.enemies, '/enemies', errors);

  const weaponIds = checkItemShapes(pack.items, errors);

  checkSkills(pack.skills, itemIndex, errors);
  checkRecipes(pack.recipes, itemIndex, skillIndex, pack.skills, errors);

  const moves = pack.combatText.moves;
  checkEnemies(pack.enemies, itemIndex, moves, errors);
  checkGearDrops(pack.gearDrops, itemIndex, enemyIndex, pack.items, errors);
  checkShop(pack.shop, itemIndex, errors);
  checkWeaponMoves(weaponIds, pack.items, moves, errors);
  checkMoveRegistry(moves, weaponIds, enemyIndex, errors);
  checkFistFallback(moves, errors);
}

/** id → 首次出现的下标。 */
function indexIds(entries: ReadonlyArray<{ readonly id: string }>): Map<string, number> {
  const map = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!map.has(entry.id)) {
      map.set(entry.id, index);
    }
  });
  return map;
}

function pushDuplicates(
  entries: ReadonlyArray<{ readonly id: string }>,
  basePath: string,
  errors: ContentError[],
): void {
  const firstSeen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const first = firstSeen.get(entry.id);
    if (first === undefined) {
      firstSeen.set(entry.id, index);
    } else {
      errors.push({
        path: `${basePath}/${index}`,
        keyword: 'duplicate',
        message: `id "${entry.id}" 与第 ${first} 项重复`,
      });
    }
  });
}

/** 物品按类型的字段形态检查；返回武器 id 集合。 */
function checkItemShapes(
  items: readonly Item[],
  errors: ContentError[],
): ReadonlySet<string> {
  const weaponIds = new Set<string>();
  items.forEach((item, index) => {
    const at = (field: string) => `/items/${index}/${field}`;
    if (item.type === 'equip') {
      if (item.slot === undefined) {
        errors.push({ path: at('slot'), keyword: 'shape', message: 'equip 类物品缺少 slot' });
      } else if (item.slot === 'weapon') {
        weaponIds.add(item.id);
      }
      if (item.bonuses === undefined) {
        errors.push({ path: at('bonuses'), keyword: 'shape', message: 'equip 类物品缺少 bonuses' });
      }
    } else if (item.type === 'pill') {
      if (item.effect === undefined && item.heal === undefined) {
        errors.push({
          path: at('effect'),
          keyword: 'shape',
          message: 'pill 类物品必须声明 effect（持续增益）或 heal（即时恢复）',
        });
      }
    } else {
      for (const field of ['slot', 'bonuses', 'effect', 'heal'] as const) {
        if (item[field] !== undefined) {
          errors.push({
            path: at(field),
            keyword: 'shape',
            message: `mat 类物品不应携带 /${field}`,
          });
        }
      }
    }
  });
  return weaponIds;
}

function checkSkills(
  skills: readonly Skill[],
  items: ReadonlyMap<string, number>,
  errors: ContentError[],
): void {
  skills.forEach((skill, i) => {
    const hasActivities = skill.activities !== undefined && skill.activities.length > 0;
    if (skill.kind === 'gather' && !hasActivities) {
      errors.push({
        path: `/skills/${i}`,
        keyword: 'shape',
        message: 'gather 类技能必须携带至少一个活动',
      });
    }
    if (skill.kind !== 'gather' && skill.activities !== undefined) {
      errors.push({
        path: `/skills/${i}/activities`,
        keyword: 'shape',
        message: `只有 gather 类技能携带活动（${skill.kind} 类的动作由 recipes/斗法定义）`,
      });
    }
    for (const [j, activity] of (skill.activities ?? []).entries()) {
      if (!items.has(activity.output.item)) {
        errors.push({
          path: `/skills/${i}/activities/${j}/output/item`,
          keyword: 'xref',
          message: `产出物品 "${activity.output.item}" 不存在于 items`,
        });
      }
      const bonus = activity.byproduct;
      if (bonus !== undefined && !items.has(bonus.item)) {
        errors.push({
          path: `/skills/${i}/activities/${j}/byproduct/item`,
          keyword: 'xref',
          message: `副产出物品 "${bonus.item}" 不存在于 items`,
        });
      }
    }
  });
}

function checkRecipes(
  recipes: ContentPack['recipes'],
  items: ReadonlyMap<string, number>,
  skills: ReadonlyMap<string, number>,
  skillDefs: readonly Skill[],
  errors: ContentError[],
): void {
  recipes.forEach((recipe, i) => {
    if (!items.has(recipe.output.item)) {
      errors.push({
        path: `/recipes/${i}/output/item`,
        keyword: 'xref',
        message: `产出物品 "${recipe.output.item}" 不存在于 items`,
      });
    }
    for (const [matId] of Object.entries(recipe.materials)) {
      if (!items.has(matId)) {
        errors.push({
          path: `/recipes/${i}/materials/${matId}`,
          keyword: 'xref',
          message: `材料 "${matId}" 不存在于 items`,
        });
      }
    }
    const skillAt = skills.get(recipe.skill);
    if (skillAt === undefined) {
      errors.push({
        path: `/recipes/${i}/skill`,
        keyword: 'xref',
        message: `所属技艺 "${recipe.skill}" 不存在于 skills`,
      });
    } else if (skillDefs[skillAt]?.kind !== 'craft') {
      errors.push({
        path: `/recipes/${i}/skill`,
        keyword: 'xref',
        message: `所属技艺 "${recipe.skill}" 须为 craft 类技能`,
      });
    }
  });
}

function hasMove(moves: Readonly<Record<string, readonly string[]>>, key: string): boolean {
  const names = moves[key];
  return Array.isArray(names) && names.length > 0;
}

function checkEnemies(
  enemies: ContentPack['enemies'],
  items: ReadonlyMap<string, number>,
  moves: Readonly<Record<string, readonly string[]>>,
  errors: ContentError[],
): void {
  enemies.forEach((enemy, i) => {
    for (const [j, drop] of enemy.drops.entries()) {
      if (!items.has(drop.item)) {
        errors.push({
          path: `/enemies/${i}/drops/${j}/item`,
          keyword: 'xref',
          message: `掉落物品 "${drop.item}" 不存在于 items`,
        });
      }
    }
    if (!hasMove(moves, enemy.id)) {
      errors.push({
        path: `/enemies/${i}`,
        keyword: 'xref',
        message: `敌人 "${enemy.id}" 未在 combatText.moves 注册招式名`,
      });
    }
    if (enemy.gold.min > enemy.gold.max) {
      errors.push({
        path: `/enemies/${i}/gold`,
        keyword: 'shape',
        message: `灵石区间 min(${enemy.gold.min}) 不得大于 max(${enemy.gold.max})`,
      });
    }
  });
}

function checkGearDrops(
  gearDrops: ContentPack['gearDrops'],
  items: ReadonlyMap<string, number>,
  enemies: ReadonlyMap<string, number>,
  itemDefs: readonly Item[],
  errors: ContentError[],
): void {
  gearDrops.forEach((gearDrop, i) => {
    if (!enemies.has(gearDrop.enemy)) {
      errors.push({
        path: `/gearDrops/${i}/enemy`,
        keyword: 'xref',
        message: `掉落归属敌人 "${gearDrop.enemy}" 不存在于 enemies`,
      });
    }
    for (const [j, itemId] of gearDrop.pool.entries()) {
      const itemAt = items.get(itemId);
      if (itemAt === undefined) {
        errors.push({
          path: `/gearDrops/${i}/pool/${j}`,
          keyword: 'xref',
          message: `异宝池引用的物品 "${itemId}" 不存在于 items`,
        });
      } else if (itemDefs[itemAt]?.type !== 'equip') {
        errors.push({
          path: `/gearDrops/${i}/pool/${j}`,
          keyword: 'xref',
          message: `异宝池只能引用 equip 类物品，"${itemId}" 不是装备`,
        });
      }
    }
  });
}

function checkShop(
  shop: ContentPack['shop'],
  items: ReadonlyMap<string, number>,
  errors: ContentError[],
): void {
  shop.forEach((entry, i) => {
    if (!items.has(entry.item)) {
      errors.push({
        path: `/shop/${i}/item`,
        keyword: 'xref',
        message: `货架物品 "${entry.item}" 不存在于 items`,
      });
    }
  });
}

function checkWeaponMoves(
  weaponIds: ReadonlySet<string>,
  items: readonly Item[],
  moves: Readonly<Record<string, readonly string[]>>,
  errors: ContentError[],
): void {
  items.forEach((item, i) => {
    if (weaponIds.has(item.id) && !hasMove(moves, item.id)) {
      errors.push({
        path: `/items/${i}`,
        keyword: 'xref',
        message: `武器 "${item.id}" 未在 combatText.moves 注册招式名`,
      });
    }
  });
}

function checkMoveRegistry(
  moves: Readonly<Record<string, readonly string[]>>,
  weaponIds: ReadonlySet<string>,
  enemies: ReadonlyMap<string, number>,
  errors: ContentError[],
): void {
  for (const key of Object.keys(moves)) {
    if (key !== 'fist' && !weaponIds.has(key) && !enemies.has(key)) {
      errors.push({
        path: `/combatText/moves/${key}`,
        keyword: 'xref',
        message: '招式注册键必须是 fist、武器物品 id 或敌人 id',
      });
    }
  }
}

/**
 * 引擎安全兜底约定：fist 兜底招式必须恒在（未注册招式一律回退拳脚）。
 * 四系动词池由 combat-text schema 的 required + minItems 保证，此处不重复。
 */
function checkFistFallback(
  moves: Readonly<Record<string, readonly string[]>>,
  errors: ContentError[],
): void {
  if (!hasMove(moves, 'fist')) {
    errors.push({
      path: '/combatText/moves',
      keyword: 'xref',
      message: '缺少 fist 兜底招式（引擎约定：未注册招式一律回退拳脚）',
    });
  }
}
