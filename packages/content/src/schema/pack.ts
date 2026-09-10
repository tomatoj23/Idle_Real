/**
 * 内容包整体校验（issue #2；#16 扩展）。
 *
 * 两道关卡：
 * 1. **schema 校验**：各内容节对照 src/schema/ 下的 JSON Schema，
 *    逐字段上报（JSON Pointer 路径 + 关键字）。item 节按 type 走
 *    oneOf 五形态分流（mat/consumable/equip/blank 器胚/inscription 铭纹），
 *    跨形态字段由分支 additionalProperties:false 直接拒绝。
 * 2. **语义校验**：schema 表达不了的跨引用与形态规则——
 *    - id 去重（items / skills / enemies / config.slots）；
 *    - 掉落池 id 必须存在于 items（异宝池还须为 equip 类）；
 *    - 武器 id 与敌人 id 必须在 combatText.moves 注册招式名；
 *    - moves 注册键不得悬空（只能是 basic、武器 id 或敌人 id）；
 *    - basic 兜底招式与 basic 兜底动词池恒需存在（引擎安全兜底约定；
 *      动词池键域开放后 schema 仅强制 basic，#021 批 4）；
 *    - 动词风格存在性（#021 批 4，键域开放的存在性关卡）：equip 的
 *      verbStyle 与敌人的 kind 都必须命中 combatText.verbs 非空池；
 *    - 层数上限单一来源（#021 批 4，P2-1）：config.progression.maxLevel
 *      存在时，enemy.level 与活动/配方的 unlockLevel 都不得超过它
 *      （schema 魔法数 99 已清退；config 缺省时无从取得，跳过对照）；
 *    - 配方材料、产出、所属技艺，活动产出/副产出，敌人掉落，坊市
 *      货架的物品 id 必须存在（旧版 data.js 曾因材料 id 打错而埋雷，
 *      教训固化为校验）；
 *    - 物品按类型的字段形态（equip 须 slot+bonuses、consumable 须
 *      effect/heal；器胚胚纹与铭纹各阶的修饰符区约束：乘法区 > 0、
 *      加法%区 ≥ −100；floorRange/tierRange 方向性 min ≤ max）；
 *    - 槽位数据化（#16）：equip/blank 的 slot 须在 config.slots 有定义
 *      （config 缺省时跳过，零破坏）；
 *    - 稀有度/词条池词表（#018，ADR-016 裁决 ①：词表零默认）：rarities 与
 *      affixPool 两节 validate 强制恒在；权重正数由 schema 关卡保证
 *      （rollRarity 按占比归一化的前提），rarities 的 id 去重（存档键
 *      GearInstance.rarity 引用它），affix.stat 键域开放后由 schema 只钉
 *      键形态（#021 批 4），生效须引擎消费点（content.md 注册表）；
 *    - 系别存在性（#25 键域开放，循 #21 动词风格先例）：elements 节是包内
 *      系别键域的唯一注册表（schema 不钉七系枚举），敌人 element、affinities
 *      键、铭纹条件 element 引用的系别键都必须命中注册表（坏包加载期拒绝，
 *      报错逐字段可定位）；敌人不填 element = 凡击，引擎条件匹配语义不变；
 *      #15 扩引用面：武器 element（equip/blank）与 elementFlavor 池键同律
 *      xref；机制签名原语对照引擎闭集镜像（未注册原语 = 假系，加载期大声
 *      拒绝；机械原语的 value/duration 必填，schema 边界 + 语义校验双关卡）；
 *    - config 玩法参数子节（#020，ADR-016 裁决 ① 分策）：combat/
 *      progression/affix 子节全可选（缺省 = 引擎基线），伤害档阈值
 *      跨字段递增由语义检查补全；
 *    - 原型继承三检（#16，ADR-015/SexyMUD ADR-0030）：prototypeKey 须等
 *      于自身 id、prototypeParent 须指向同集合内已声明 prototypeKey 的
 *      条目、父链不得成环（展平留待后续票，此处为门禁侧保险）；
 *    - 转生节（#6，可选节）：重置/保留清单键域 = 引擎注册表闭集且两集
 *      不相交；天赋树 id 去重、requires xref + DFS 查环（菱形合法）、效果
 *      修饰符区约束；解锁表目标 xref + 同目标重复拒绝；境界词表同层数重复拒绝；
 *    - 成就节（#9，可选节）：id 去重（state.achievements 存档键）；条件 stat
 *      对照引擎统计注册表闭集镜像（死条件加载期拒绝）；布尔型条件带 op 拒绝
 *      （语义缝隙）；奖励物品 xref items 且只收 mat/consumable（equip 整袋
 *      发放成不可见死物）。
 */

import affixPoolSchemaJson from './affix-pool.schema.json';
import achievementsSchemaJson from './achievements.schema.json';
import bossSchemaJson from './boss.schema.json';
import combatTextSchemaJson from './combat-text.schema.json';
import configSchemaJson from './config.schema.json';
import dungeonSchemaJson from './dungeon.schema.json';
import elementSchemaJson from './element.schema.json';
import enemySchemaJson from './enemy.schema.json';
import gearDropSchemaJson from './gear-drop.schema.json';
import itemSchemaJson from './item.schema.json';
import raritySchemaJson from './rarity.schema.json';
import rebirthSchemaJson from './rebirth.schema.json';
import recipeSchemaJson from './recipe.schema.json';
import shopSchemaJson from './shop.schema.json';
import skillSchemaJson from './skill.schema.json';
import textsSchemaJson from './texts.schema.json';
import type {
  BossDef,
  Config,
  ContentPack,
  DungeonDef,
  AchievementDef,
  Item,
  Modifier,
  ModifierCondition,
  Range,
  RebirthSection,
  Skill,
  TalentNode,
} from './types.js';
import { validateContent } from './validate.js';
import type { ContentError, JsonSchema } from './validate.js';

const skillSchema = skillSchemaJson as unknown as JsonSchema;
const itemSchema = itemSchemaJson as unknown as JsonSchema;
const recipeSchema = recipeSchemaJson as unknown as JsonSchema;
const enemySchema = enemySchemaJson as unknown as JsonSchema;
const gearDropSchema = gearDropSchemaJson as unknown as JsonSchema;
const elementSchema = elementSchemaJson as unknown as JsonSchema;
const raritySchema = raritySchemaJson as unknown as JsonSchema;
const affixPoolSchema = affixPoolSchemaJson as unknown as JsonSchema;
const combatTextSchema = combatTextSchemaJson as unknown as JsonSchema;
const textsSchema = textsSchemaJson as unknown as JsonSchema;
const shopSchema = shopSchemaJson as unknown as JsonSchema;
const configSchema = configSchemaJson as unknown as JsonSchema;
const rebirthSchema = rebirthSchemaJson as unknown as JsonSchema;
const dungeonSchema = dungeonSchemaJson as unknown as JsonSchema;
const bossSchema = bossSchemaJson as unknown as JsonSchema;
const achievementsSchema = achievementsSchemaJson as unknown as JsonSchema;

/** 内容节 → 该节值的独立 schema。 */
const SECTION_SCHEMAS = {
  skills: skillSchema,
  items: itemSchema,
  recipes: recipeSchema,
  enemies: enemySchema,
  gearDrops: gearDropSchema,
  elements: elementSchema,
  rarities: raritySchema,
  affixPool: affixPoolSchema,
  combatText: combatTextSchema,
  texts: textsSchema,
  shop: shopSchema,
  config: configSchema,
  rebirth: rebirthSchema,
  dungeons: dungeonSchema,
  bosses: bossSchema,
  achievements: achievementsSchema,
} as const;

type SectionName = keyof typeof SECTION_SCHEMAS;

const SECTION_NAMES = Object.keys(SECTION_SCHEMAS) as readonly SectionName[];

/** 可选内容节：缺省合法（引擎安全兜底），存在则整节强校验。 */
const OPTIONAL_SECTIONS: ReadonlySet<SectionName> = new Set([
  'config',
  'rebirth',
  'dungeons',
  'bosses',
  'achievements',
]);

export type PackValidationResult =
  | { readonly ok: true; readonly pack: ContentPack }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

/** 包版本形态（#12 版本策略）：semver 三段，prerelease/build 后缀可并存（1.2.3-rc.1+b1）。 */
const PACK_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

  // 包版本（#12）：非内容节，先行单独校验（游戏内版本行 + 发版追踪的依据）。
  const version = pack['version'];
  if (version === undefined) {
    errors.push({
      path: '/version',
      keyword: 'required',
      message: '缺少包版本 version（semver 三段，如 1.2.3）',
    });
  } else if (typeof version !== 'string') {
    errors.push({
      path: '/version',
      keyword: 'type',
      message: `包版本 version 须为字符串，实际：${typeof version}`,
    });
  } else if (!PACK_VERSION_RE.test(version)) {
    errors.push({
      path: '/version',
      keyword: 'pattern',
      message: `包版本须为 semver 三段（如 1.2.3），实际：${JSON.stringify(version)}`,
    });
  }

  for (const section of SECTION_NAMES) {
    const value = pack[section];
    if (value === undefined) {
      if (!OPTIONAL_SECTIONS.has(section)) {
        errors.push({ path: `/${section}`, keyword: 'required', message: '缺少内容节' });
      }
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
  pushDuplicates(pack.rarities, '/rarities', errors);
  pushDuplicates(pack.elements, '/elements', errors);
  const slotIds = checkConfig(pack.config, itemIndex, pack.items, errors);

  // 武器语义槽位（#14 role 放宽，与引擎 weaponSlotOf 同律）：role === 'weapon'
  // 优先，未声明 role 的包按 id === 'weapon' 兜底；无 config（旧包形态）回落
  // 'weapon' 字面量——既有包零破坏。
  const weaponSlotIds = new Set<string>();
  if (pack.config === undefined) {
    weaponSlotIds.add('weapon');
  } else {
    for (const slot of pack.config.slots) {
      if (slot.role === 'weapon' || slot.id === 'weapon') weaponSlotIds.add(slot.id);
    }
  }

  const weaponIds = checkItemShapes(pack.items, slotIds, weaponSlotIds, errors);

  // 层数上限单一来源（#021 批 4，P2-1）：config.progression.maxLevel 存在时，
  // enemy.level 与活动/配方 unlockLevel 一律对照它（schema 魔法数 99 已清退）。
  const maxLevel = pack.config?.progression?.maxLevel;

  checkSkills(pack.skills, itemIndex, pack.items, maxLevel, errors);
  checkRecipes(pack.recipes, itemIndex, pack.items, skillIndex, pack.skills, maxLevel, errors);

  const moves = pack.combatText.moves;
  const verbs = pack.combatText.verbs;
  checkEnemies(pack.enemies, itemIndex, pack.items, moves, maxLevel, errors);
  checkGearDrops(pack.gearDrops, itemIndex, enemyIndex, pack.items, errors);
  checkShop(pack.shop, itemIndex, pack.items, errors);
  checkWeaponMoves(weaponIds, pack.items, moves, errors);
  // Boss 节（#8）：先于招式注册表检查（变招 moveKey 扩展合法注册键集）。
  const bossMoveKeys = checkBosses(pack.bosses ?? [], enemyIndex, itemIndex, moves, errors);
  checkMoveRegistry(moves, weaponIds, enemyIndex, bossMoveKeys, errors);
  checkBasicFallback(moves, errors);
  checkVerbStyles(pack.items, pack.enemies, verbs, errors);

  // 系别存在性（#25 键域开放）：注册表构建一次，三处引用面统一对照。
  const elementIds = new Set(pack.elements.map((entry) => entry.id));
  checkElementRefs(pack, elementIds, errors);
  // 系别机制签名（#15，ADR-012）：原语闭集镜像 + 机械原语参数必填。
  checkElementSignatures(pack.elements, errors);

  // 转生节（#6）：可选节，存在则查清单键域、天赋树 xref/查环、解锁表 xref、境界词表。
  checkRebirth(pack, enemyIndex, skillIndex, errors);

  // 秘境节（#7）：可选节，存在则查 id 去重、钥匙/敌人/奖励 xref、生命周期覆盖。
  checkDungeons(pack.dungeons ?? [], enemyIndex, itemIndex, errors);

  // 成就节（#9）：可选节，存在则查 id 去重、统计键域闭集、奖励物品 xref + 类型关卡。
  checkAchievements(pack.achievements ?? [], itemIndex, pack.items, errors);

  checkPrototypes(pack.skills, '/skills', errors);
  checkPrototypes(pack.items, '/items', errors);
  checkPrototypes(pack.enemies, '/enemies', errors);
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

/**
 * 槽位数据化（#16）：config 存在时返回槽位 id 集合并查重；
 * 缺省时返回 undefined（跳过槽位跨引用检查，对既有包零破坏）。
 * 玩法参数子节（#020）：字段边界由 schema 关卡保证，此处只补
 * schema 表达不了的跨字段规则——伤害档阈值须严格递增；
 * gear 子节（#14）：shardItem xref items 且须为 mat 类（熔炼入袋的
 * 必须是可堆叠材料，equip/consumable 类器屑是死物或药神）。
 */
function checkConfig(
  config: Config | undefined,
  items: ReadonlyMap<string, number>,
  itemDefs: readonly Item[],
  errors: ContentError[],
): ReadonlySet<string> | undefined {
  if (config === undefined) {
    return undefined;
  }
  pushDuplicates(config.slots, '/config/slots', errors);
  const combat = config.combat;
  if (
    combat?.tierLightMax !== undefined &&
    combat.tierMidMax !== undefined &&
    combat.tierHeavyMax !== undefined &&
    !(combat.tierLightMax < combat.tierMidMax && combat.tierMidMax < combat.tierHeavyMax)
  ) {
    errors.push({
      path: '/config/combat/tierLightMax',
      keyword: 'shape',
      message: `伤害档阈值须严格递增（light ${combat.tierLightMax} < mid ${combat.tierMidMax} < heavy ${combat.tierHeavyMax}）`,
    });
  }
  const shardItem = config.gear?.shardItem;
  if (shardItem !== undefined) {
    const itemAt = items.get(shardItem);
    if (itemAt === undefined) {
      errors.push({
        path: '/config/gear/shardItem',
        keyword: 'xref',
        message: `器屑物品 "${shardItem}" 不存在于 items`,
      });
    } else if (itemDefs[itemAt]?.type !== 'mat') {
      errors.push({
        path: '/config/gear/shardItem',
        keyword: 'xref',
        message: `器屑物品 "${shardItem}" 须为 mat 类（熔炼产物入袋堆叠）`,
      });
    }
  }
  return new Set(config.slots.map((slot) => slot.id));
}

/**
 * 模板类物品（blank 器胚 / inscription 铭纹）禁入袋流（#14）：
 * 两类是掉落管线的实例化模板，经袋子流通只会成为不可见死物
 * （bag 只渲染 mat/consumable 分组），还能按 sell 折算灵石套利。
 */
function rejectTemplateItem(
  itemDefs: readonly Item[],
  itemAt: number | undefined,
  path: string,
  label: string,
  errors: ContentError[],
): void {
  const def = itemAt !== undefined ? itemDefs[itemAt] : undefined;
  if (def?.type === 'blank' || def?.type === 'inscription') {
    errors.push({
      path,
      keyword: 'xref',
      message: `${label} "${def.id}" 是${def.type === 'blank' ? '器胚' : '铭纹'}模板类（只经掉落管线实例化，不得进入袋流）`,
    });
  }
}

/**
 * 物品按类型的字段形态检查；返回武器 id 集合。
 * 跨形态字段冲突（mat 携带装备字段等）已由 item schema 的 oneOf 分支
 * additionalProperties:false 在 schema 关卡拦截，此处只做分支内规则。
 */
function checkItemShapes(
  items: readonly Item[],
  slotIds: ReadonlySet<string> | undefined,
  weaponSlotIds: ReadonlySet<string>,
  errors: ContentError[],
): ReadonlySet<string> {
  const weaponIds = new Set<string>();
  items.forEach((item, index) => {
    const at = (field: string) => `/items/${index}/${field}`;
    // 槽位数据化跨引用：equip/blank 声明的 slot 须在 config.slots 有定义。
    if (item.slot !== undefined && slotIds !== undefined && !slotIds.has(item.slot)) {
      errors.push({
        path: at('slot'),
        keyword: 'xref',
        message: `槽位 "${item.slot}" 未在 config.slots 定义`,
      });
    }
    // 武器语义槽（#14 器胚同律 + role 放宽）：武器槽上的 equip/器胚都承担
    // 武器语义（佩戴后引擎 weaponMoveKey 用其 itemId），招式注册键随之放行。
    if ((item.type === 'equip' || item.type === 'blank') && item.slot !== undefined && weaponSlotIds.has(item.slot)) {
      weaponIds.add(item.id);
    }
    if (item.type === 'equip') {
      if (item.slot === undefined) {
        errors.push({ path: at('slot'), keyword: 'shape', message: 'equip 类物品缺少 slot' });
      }
      if (item.bonuses === undefined) {
        errors.push({ path: at('bonuses'), keyword: 'shape', message: 'equip 类物品缺少 bonuses' });
      }
    } else if (item.type === 'consumable') {
      if (item.effect === undefined && item.heal === undefined) {
        errors.push({
          path: at('effect'),
          keyword: 'shape',
          message: 'consumable 类物品必须声明 effect（持续增益）或 heal（即时恢复）',
        });
      }
    } else if (item.type === 'blank') {
      checkRangeDirection(item.floorRange, at('floorRange'), errors);
      checkRangeDirection(item.tierRange, at('tierRange'), errors);
      checkModifiers(item.inherentModifiers ?? [], at('inherentModifiers'), errors);
    } else if (item.type === 'inscription') {
      (item.tiers ?? []).forEach((tier, tierIndex) => {
        checkModifiers(tier, `${at('tiers')}/${tierIndex}`, errors);
      });
    }
  });
  return weaponIds;
}

/** 区间方向性：min 不得大于 max（floorRange/tierRange 与敌人 gold 同律）。 */
function checkRangeDirection(range: Range | undefined, path: string, errors: ContentError[]): void {
  if (range !== undefined && range.min > range.max) {
    errors.push({
      path,
      keyword: 'shape',
      message: `区间 min(${range.min}) 不得大于 max(${range.max})`,
    });
  }
}

/** 修饰符区约束（ADR-011 聚合区）：乘法区须 > 0，加法%区不得低于 −100。 */
function checkModifiers(
  modifiers: readonly Modifier[],
  basePath: string,
  errors: ContentError[],
): void {
  modifiers.forEach((mod, i) => {
    if (mod.zone === 'mult' && mod.value <= 0) {
      errors.push({
        path: `${basePath}/${i}/value`,
        keyword: 'shape',
        message: `乘法区修饰符（${mod.stat}）value 必须 > 0`,
      });
    }
    if (mod.zone === 'addPct' && mod.value < -100) {
      errors.push({
        path: `${basePath}/${i}/value`,
        keyword: 'shape',
        message: `加法%区修饰符（${mod.stat}）value 不得小于 −100`,
      });
    }
  });
}

interface PrototypeEntry {
  readonly id: string;
  readonly prototypeKey?: string;
  readonly prototypeParent?: string;
}

/**
 * 原型继承三检（#16，ADR-015 / SexyMUD ADR-0030 纪律）：
 * - prototypeKey 须等于自身 id（同 id 空间，唯一性免费）；
 * - prototypeParent 须指向同集合内**已声明 prototypeKey** 的条目
 *   （显式声明才可被继承，未声明的被引用即大声失败）；
 * - 父链不得成环（门禁侧保险，与后续展平票据的注册表检测构成双保险）。
 * 加载期展平继承留待后续票；本检查只拦数据，不改写数据。
 */
function checkPrototypes(
  entries: ReadonlyArray<PrototypeEntry>,
  basePath: string,
  errors: ContentError[],
): void {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  entries.forEach((entry, index) => {
    if (entry.prototypeKey !== undefined && entry.prototypeKey !== entry.id) {
      errors.push({
        path: `${basePath}/${index}/prototypeKey`,
        keyword: 'prototype',
        message: `prototypeKey ("${entry.prototypeKey}") 必须等于条目自身 id ("${entry.id}")`,
      });
    }
    const parent = entry.prototypeParent;
    if (parent === undefined) {
      return;
    }
    const at = `${basePath}/${index}/prototypeParent`;
    const parentEntry = byId.get(parent);
    if (parentEntry === undefined) {
      errors.push({
        path: at,
        keyword: 'prototype',
        message: `父原型 "${parent}" 不存在于同集合`,
      });
      return;
    }
    if (parentEntry.prototypeKey === undefined) {
      errors.push({
        path: at,
        keyword: 'prototype',
        message: `父原型 "${parent}" 未声明 prototypeKey，不可被继承`,
      });
      return;
    }
    const seen = new Set<string>([entry.id]);
    let cursor: PrototypeEntry | undefined = parentEntry;
    while (cursor !== undefined) {
      if (seen.has(cursor.id)) {
        errors.push({
          path: at,
          keyword: 'prototype',
          message: `原型继承链存在环：${[...seen, cursor.id].join(' → ')}`,
        });
        return;
      }
      seen.add(cursor.id);
      cursor = cursor.prototypeParent !== undefined ? byId.get(cursor.prototypeParent) : undefined;
    }
  });
}

function checkSkills(
  skills: readonly Skill[],
  items: ReadonlyMap<string, number>,
  itemDefs: readonly Item[],
  maxLevel: number | undefined,
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
      // 层数上限单一来源（#021 批 4，P2-1）：schema 魔法数 99 清退后对照 config。
      if (maxLevel !== undefined && activity.unlockLevel > maxLevel) {
        errors.push({
          path: `/skills/${i}/activities/${j}/unlockLevel`,
          keyword: 'shape',
          message: `解锁层数 ${activity.unlockLevel} 超过层数上限（config.progression.maxLevel = ${maxLevel}）`,
        });
      }
      if (!items.has(activity.output.item)) {
        errors.push({
          path: `/skills/${i}/activities/${j}/output/item`,
          keyword: 'xref',
          message: `产出物品 "${activity.output.item}" 不存在于 items`,
        });
      } else {
        rejectTemplateItem(itemDefs, items.get(activity.output.item), `/skills/${i}/activities/${j}/output/item`, '产出物品', errors);
      }
      const bonus = activity.byproduct;
      if (bonus !== undefined && !items.has(bonus.item)) {
        errors.push({
          path: `/skills/${i}/activities/${j}/byproduct/item`,
          keyword: 'xref',
          message: `副产出物品 "${bonus.item}" 不存在于 items`,
        });
      } else if (bonus !== undefined) {
        rejectTemplateItem(itemDefs, items.get(bonus.item), `/skills/${i}/activities/${j}/byproduct/item`, '副产出物品', errors);
      }
    }
  });
}

function checkRecipes(
  recipes: ContentPack['recipes'],
  items: ReadonlyMap<string, number>,
  itemDefs: readonly Item[],
  skills: ReadonlyMap<string, number>,
  skillDefs: readonly Skill[],
  maxLevel: number | undefined,
  errors: ContentError[],
): void {
  recipes.forEach((recipe, i) => {
    // 层数上限单一来源（#021 批 4，P2-1）：同 checkSkills。
    if (maxLevel !== undefined && recipe.unlockLevel > maxLevel) {
      errors.push({
        path: `/recipes/${i}/unlockLevel`,
        keyword: 'shape',
        message: `解锁层数 ${recipe.unlockLevel} 超过层数上限（config.progression.maxLevel = ${maxLevel}）`,
      });
    }
    if (!items.has(recipe.output.item)) {
      errors.push({
        path: `/recipes/${i}/output/item`,
        keyword: 'xref',
        message: `产出物品 "${recipe.output.item}" 不存在于 items`,
      });
    } else {
      rejectTemplateItem(itemDefs, items.get(recipe.output.item), `/recipes/${i}/output/item`, '产出物品', errors);
    }
    for (const [matId] of Object.entries(recipe.materials)) {
      if (!items.has(matId)) {
        errors.push({
          path: `/recipes/${i}/materials/${matId}`,
          keyword: 'xref',
          message: `材料 "${matId}" 不存在于 items`,
        });
      } else {
        rejectTemplateItem(itemDefs, items.get(matId), `/recipes/${i}/materials/${matId}`, '材料', errors);
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
  itemDefs: readonly Item[],
  moves: Readonly<Record<string, readonly string[]>>,
  maxLevel: number | undefined,
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
      } else {
        rejectTemplateItem(itemDefs, items.get(drop.item), `/enemies/${i}/drops/${j}/item`, '掉落物品', errors);
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
    // 层数上限单一来源（#021 批 4，P2-1）：schema 魔法数 99 清退后，
    // 上限对照 config.progression.maxLevel；config 缺省时无法取得上限，跳过
    // （引擎侧层数只影响开战门控，超高层数内容不可达但不致崩）。
    if (maxLevel !== undefined && enemy.level > maxLevel) {
      errors.push({
        path: `/enemies/${i}/level`,
        keyword: 'shape',
        message: `敌人层数 ${enemy.level} 超过层数上限（config.progression.maxLevel = ${maxLevel}）`,
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
      } else if (itemDefs[itemAt]?.type !== 'equip' && itemDefs[itemAt]?.type !== 'blank') {
        // #14：异宝池放行器胚（掉落管线 ②③ 走底材实例化）；equip 兼容旧池。
        errors.push({
          path: `/gearDrops/${i}/pool/${j}`,
          keyword: 'xref',
          message: `异宝池只能引用 equip/blank（器胚）类物品，"${itemId}" 不是装备或器胚`,
        });
      }
    }
  });
}

function checkShop(
  shop: ContentPack['shop'],
  items: ReadonlyMap<string, number>,
  itemDefs: readonly Item[],
  errors: ContentError[],
): void {
  shop.forEach((entry, i) => {
    if (!items.has(entry.item)) {
      errors.push({
        path: `/shop/${i}/item`,
        keyword: 'xref',
        message: `货架物品 "${entry.item}" 不存在于 items`,
      });
    } else {
      rejectTemplateItem(itemDefs, items.get(entry.item), `/shop/${i}/item`, '货架物品', errors);
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
  bossMoveKeys: ReadonlySet<string>,
  errors: ContentError[],
): void {
  for (const key of Object.keys(moves)) {
    if (key !== 'basic' && !weaponIds.has(key) && !enemies.has(key) && !bossMoveKeys.has(key)) {
      errors.push({
        path: `/combatText/moves/${key}`,
        keyword: 'xref',
        message: '招式注册键必须是 basic、武器物品 id（equip/器胚武器，#14）、敌人 id 或 Boss 变招键（#8）',
      });
    }
  }
}

/**
 * 引擎安全兜底约定：basic 兜底招式必须恒在（未注册招式一律回退基础动作）。
 * basic 兜底动词池由 combat-text schema 的 required + minItems 保证
 * （键域开放后仅 basic 恒需，#021 批 4），此处不重复。
 */
function checkBasicFallback(
  moves: Readonly<Record<string, readonly string[]>>,
  errors: ContentError[],
): void {
  if (!hasMove(moves, 'basic')) {
    errors.push({
      path: '/combatText/moves',
      keyword: 'xref',
      message: '缺少 basic 兜底招式（引擎约定：未注册招式一律回退基础动作）',
    });
  }
}

/**
 * 动词风格存在性（#021 批 4，键域开放的存在性关卡，ADR-016 裁决 ⑦）：
 * schema 只钉键形态不钉取值，引用合法性在此收口——equip 声明的 verbStyle
 * 与敌人的 kind 都必须命中 combatText.verbs 非空池（坏引用大声失败）。
 */
function checkVerbStyles(
  items: readonly Item[],
  enemies: ContentPack['enemies'],
  verbs: ContentPack['combatText']['verbs'],
  errors: ContentError[],
): void {
  const hasPool = (style: string): boolean => {
    const pool = verbs[style];
    return Array.isArray(pool) && pool.length > 0;
  };
  items.forEach((item, i) => {
    if (item.verbStyle !== undefined && !hasPool(item.verbStyle)) {
      errors.push({
        path: `/items/${i}/verbStyle`,
        keyword: 'xref',
        message: `动词风格 "${item.verbStyle}" 未在 combatText.verbs 注册`,
      });
    }
  });
  enemies.forEach((enemy, i) => {
    if (!hasPool(enemy.kind)) {
      errors.push({
        path: `/enemies/${i}/kind`,
        keyword: 'xref',
        message: `敌人 "${enemy.id}" 的动词风格 "${enemy.kind}" 未在 combatText.verbs 注册`,
      });
    }
  });
}

/**
 * 系别存在性（#25 键域开放的存在性关卡，循 #21 动词风格先例）：
 * schema 只钉键形态不钉取值，引用合法性在此收口——敌人 element、
 * affinities 键、铭纹条件 element（胚纹/三阶表/feature 三落点）、武器
 * element（equip/blank，#15）、elementFlavor 池键（#15）引用的系别键都
 * 必须命中 elements 节注册表（坏包加载期拒绝，逐字段可定位）。
 * 缺省/兜底约定：敌人/武器不填 element = 凡击；聚合语境无 element 维度时
 * 条件修饰符不生效（引擎 conditionMatches 语义不变）。
 */
function checkElementRefs(
  pack: ContentPack,
  registered: ReadonlySet<string>,
  errors: ContentError[],
): void {
  const message = (id: string): string => `系别 "${id}" 未在包 elements 节注册`;
  pack.enemies.forEach((enemy, i) => {
    if (enemy.element !== undefined && !registered.has(enemy.element)) {
      errors.push({
        path: `/enemies/${i}/element`,
        keyword: 'xref',
        message: message(enemy.element),
      });
    }
    for (const key of Object.keys(enemy.affinities ?? {})) {
      if (!registered.has(key)) {
        errors.push({
          path: `/enemies/${i}/affinities/${key}`,
          keyword: 'xref',
          message: message(key),
        });
      }
    }
  });
  pack.items.forEach((item, i) => {
    // 武器系别（#15）：equip/blank 分支的 element 引用合法性（schema 已按
    // 分支钉形态，此处只收键域——引擎只消费武器槽，其余槽位为未来留门）。
    if (item.element !== undefined && !registered.has(item.element)) {
      errors.push({
        path: `/items/${i}/element`,
        keyword: 'xref',
        message: message(item.element),
      });
    }
    const checkCondition = (condition: ModifierCondition | undefined, path: string): void => {
      if (condition?.element !== undefined && !registered.has(condition.element)) {
        errors.push({ path, keyword: 'xref', message: message(condition.element) });
      }
    };
    (item.inherentModifiers ?? []).forEach((mod, j) => {
      checkCondition(mod.condition, `/items/${i}/inherentModifiers/${j}/condition/element`);
    });
    (item.tiers ?? []).forEach((tier, t) => {
      tier.forEach((mod, j) => {
        checkCondition(mod.condition, `/items/${i}/tiers/${t}/${j}/condition/element`);
      });
    });
    if (item.feature !== undefined) {
      checkCondition(item.feature.condition, `/items/${i}/feature/condition/element`);
    }
  });
  // 系别风味句池键（#15）：combatText.elementFlavor 键 = elements 注册系别。
  for (const [key] of Object.entries(pack.combatText.elementFlavor ?? {})) {
    if (!registered.has(key)) {
      errors.push({
        path: `/combatText/elementFlavor/${key}`,
        keyword: 'xref',
        message: message(key),
      });
    }
  }
}

/* ==================== 系别机制签名（#15，ADR-012） ==================== */

/**
 * 引擎机制签名原语注册表镜像（#15，与 engine combat.ts
 * ELEMENT_COMBAT_PRIMITIVES 同值闭集；STAT_KEYS 镜像先例：schema 只钉键
 * 形态，键域合法性在语义层收口）。未注册原语 = 引擎静默忽略的假系
 * （ADR-012：宁 4 真系勿 7 假系），加载期大声拒绝；
 * 火/木 DoT 原语第二波另票，届时两侧镜像同步扩展。
 */
const ELEMENT_COMBAT_PRIMITIVES: ReadonlySet<string> = new Set(['defenseBreak', 'slow', 'swift']);

/**
 * 系别机制签名检查（#15，可选字段，声明才查）：
 * - primitive 须命中引擎原语注册表镜像（假系大声失败）；
 * - 机械原语 value/duration 必填（schema 边界只钉 (0,1)/>0 的形态，
 *   「有没有」由语义校验收口——纯风味系如雷·霆爆不声明签名，零参数路径）。
 */
function checkElementSignatures(
  elements: ContentPack['elements'],
  errors: ContentError[],
): void {
  elements.forEach((element, i) => {
    const signature = element.signature;
    if (signature === undefined) return;
    const at = (field: string) => `/elements/${i}/signature/${field}`;
    if (!ELEMENT_COMBAT_PRIMITIVES.has(signature.primitive)) {
      errors.push({
        path: at('primitive'),
        keyword: 'xref',
        message: `机制原语 "${signature.primitive}" 不在引擎签名注册表（${[...ELEMENT_COMBAT_PRIMITIVES].join('/')}）`,
      });
    }
    if (typeof signature.value !== 'number' || !(signature.value > 0)) {
      errors.push({
        path: at('value'),
        keyword: 'shape',
        message: `机械原语（${signature.primitive}）缺 value（缩减/延长比例，0~1）`,
      });
    }
    if (typeof signature.duration !== 'number' || !(signature.duration > 0)) {
      errors.push({
        path: at('duration'),
        keyword: 'shape',
        message: `机械原语（${signature.primitive}）缺 duration（临时态时长，毫秒）`,
      });
    }
  });
}

/* ==================== 秘境节（#7） ==================== */

/**
 * 秘境节语义检查（#7，可选节，存在才查）：
 * - id 去重（state.dungeonBest 存档键）；
 * - 进入条件 key 引用 xref items；
 * - 层表生命周期覆盖：floor 行须无缝覆盖 1..floors（缺口 = 攻略中断点，
 *   重叠 = 同层双行歧义，皆拒绝）；超出总层数的层段拒绝；
 * - 层敌人权重行 xref enemies；层奖励 items xref；
 * - recommendedPower 方向性 min ≤ max。
 */
function checkDungeons(
  dungeons: readonly DungeonDef[],
  enemies: ReadonlyMap<string, number>,
  items: ReadonlyMap<string, number>,
  errors: ContentError[],
): void {
  pushDuplicates(dungeons, '/dungeons', errors);
  dungeons.forEach((dungeon, i) => {
    const at = (field: string) => `/dungeons/${i}/${field}`;
    if (dungeon.entry?.key !== undefined && !items.has(dungeon.entry.key)) {
      errors.push({
        path: at('entry/key'),
        keyword: 'xref',
        message: `钥匙物品 "${dungeon.entry.key}" 不存在于 items`,
      });
    }

    // 逐行引用与方向性检查。
    dungeon.layers.forEach((layer, j) => {
      const layerAt = (field: string) => `/dungeons/${i}/layers/${j}/${field}`;
      for (const [k, entry] of layer.enemies.entries()) {
        if (!enemies.has(entry.enemy)) {
          errors.push({
            path: layerAt(`enemies/${k}/enemy`),
            keyword: 'xref',
            message: `层敌人 "${entry.enemy}" 不存在于 enemies`,
          });
        }
      }
      for (const [k, stack] of (layer.rewards?.items ?? []).entries()) {
        if (!items.has(stack.item)) {
          errors.push({
            path: layerAt(`rewards/items/${k}/item`),
            keyword: 'xref',
            message: `层奖励物品 "${stack.item}" 不存在于 items`,
          });
        }
      }
      if (
        layer.recommendedPower !== undefined &&
        layer.recommendedPower.min > layer.recommendedPower.max
      ) {
        errors.push({
          path: layerAt('recommendedPower'),
          keyword: 'shape',
          message: `推荐战力区间 min(${layer.recommendedPower.min}) 不得大于 max(${layer.recommendedPower.max})`,
        });
      }
    });

    // —— 生命周期覆盖（区间算术，避免逐层步进的巨数循环）：行按 min 排序
    // 后须无缝衔接 1..floors；缝隙 = 覆盖缺口，先行覆盖内再起行 = 重叠歧义。
    const ordered = [...dungeon.layers.keys()].sort(
      (a, b) => dungeon.layers[a]!.floor.min - dungeon.layers[b]!.floor.min,
    );
    let expectNext = 1;
    const gaps: string[] = [];
    let overlapSeen = false;
    for (const j of ordered) {
      const { min, max } = dungeon.layers[j]!.floor;
      if (max > dungeon.floors) {
        errors.push({
          path: `/dungeons/${i}/layers/${j}/floor`,
          keyword: 'shape',
          message: `层段终点 ${max} 超出秘境总层数（floors = ${dungeon.floors}）`,
        });
      }
      if (min < expectNext) {
        if (!overlapSeen) {
          errors.push({
            path: `/dungeons/${i}/layers/${j}/floor`,
            keyword: 'duplicate',
            message: `层段 ${min}~${max} 与先行层表行重叠（同层歧义）`,
          });
          overlapSeen = true;
        }
        continue;
      }
      if (min > expectNext && expectNext <= dungeon.floors) {
        gaps.push(`${expectNext}~${Math.min(min - 1, dungeon.floors)}`);
      }
      expectNext = Math.max(expectNext, max + 1);
    }
    if (expectNext <= dungeon.floors) {
      gaps.push(`${expectNext}~${dungeon.floors}`);
    }
    if (gaps.length > 0) {
      errors.push({
        path: at('layers'),
        keyword: 'shape',
        message: `层表未覆盖全部层数（生命周期覆盖缺口：${gaps.join('、')}）`,
      });
    }
  });
}

/* ==================== Boss 节（#8） ==================== */

/**
 * Boss 节语义检查（#8，可选节，存在才查）：
 * - enemy xref enemies + 每敌人至多一条 Boss 定义（战斗引用无歧义）；
 * - 阶段阈值全数组严格递减（递进顺序：血量比例 ≤ threshold 进入该阶段，
 *   降序保证阶段推进无歧义）；
 * - 阶段 moveKey（变招）须在 combatText.moves 注册（xref），注册键集随之
 *   放行给 checkMoveRegistry（悬空招式键检查不受影响）；
 * - 阶段 summons（#30）：召唤池行 enemy xref enemies + 行内去重（投影按
 *   敌 id 定位，重复即歧义）；专属掉落表 items xref。
 * 返回 Boss 变招注册键集合（供招式注册表检查扩展合法键域）。
 */
function checkBosses(
  bosses: readonly BossDef[],
  enemies: ReadonlyMap<string, number>,
  items: ReadonlyMap<string, number>,
  moves: Readonly<Record<string, readonly string[]>>,
  errors: ContentError[],
): ReadonlySet<string> {
  const moveKeys = new Set<string>();
  const firstSeen = new Map<string, number>();
  bosses.forEach((boss, i) => {
    const at = (field: string) => `/bosses/${i}/${field}`;
    if (!enemies.has(boss.enemy)) {
      errors.push({
        path: at('enemy'),
        keyword: 'xref',
        message: `Boss 敌人 "${boss.enemy}" 不存在于 enemies`,
      });
    }
    const first = firstSeen.get(boss.enemy);
    if (first !== undefined) {
      errors.push({
        path: at('enemy'),
        keyword: 'duplicate',
        message: `敌人 "${boss.enemy}" 已在第 ${first} 条登记 Boss 定义（每敌人至多一条）`,
      });
    } else {
      firstSeen.set(boss.enemy, i);
    }
    boss.phases.forEach((phase, j) => {
      const phaseAt = (field: string) => `/bosses/${i}/phases/${j}/${field}`;
      const prev = j > 0 ? boss.phases[j - 1] : undefined;
      if (prev !== undefined && phase.threshold >= prev.threshold) {
        errors.push({
          path: phaseAt('threshold'),
          keyword: 'shape',
          message: `阶段阈值须严格递减（${phase.threshold} 不得大于等于前一阶段的 ${prev.threshold}）`,
        });
      }
      if (phase.moveKey !== undefined) {
        moveKeys.add(phase.moveKey);
        if (!hasMove(moves, phase.moveKey)) {
          errors.push({
            path: phaseAt('moveKey'),
            keyword: 'xref',
            message: `变招键 "${phase.moveKey}" 未在 combatText.moves 注册`,
          });
        }
      }
      // 召唤脚本（#30）：池行 enemy xref enemies + 行内去重（投影定位无歧义）。
      const seenSummons = new Map<string, number>();
      (phase.summons?.enemies ?? []).forEach((entry, k) => {
        if (!enemies.has(entry.enemy)) {
          errors.push({
            path: phaseAt(`summons/enemies/${k}/enemy`),
            keyword: 'xref',
            message: `召唤物敌人 "${entry.enemy}" 不存在于 enemies`,
          });
        }
        const seenAt = seenSummons.get(entry.enemy);
        if (seenAt !== undefined) {
          errors.push({
            path: phaseAt(`summons/enemies/${k}/enemy`),
            keyword: 'duplicate',
            message: `召唤池 enemy "${entry.enemy}" 与第 ${seenAt} 行重复（投影按敌 id 定位，重复即歧义）`,
          });
        } else {
          seenSummons.set(entry.enemy, k);
        }
      });
    });
    for (const [k, drop] of (boss.drops ?? []).entries()) {
      if (!items.has(drop.item)) {
        errors.push({
          path: at(`drops/${k}/item`),
          keyword: 'xref',
          message: `专属掉落物品 "${drop.item}" 不存在于 items`,
        });
      }
    }
  });
  return moveKeys;
}

/* ==================== 成就节（#9） ==================== */

/**
 * 引擎统计键注册表镜像（#9，与 engine src/stats.ts STAT_KEYS 同值闭集；
 * REBIRTH_RESET_KEYS 先例：schema 只钉键形态，键域合法性在语义层收口）。
 * 条件 stat 引用未登记键 = 死条件（引擎永不累积该键），加载期大声拒绝。
 */
const STAT_KEYS: ReadonlySet<string> = new Set([
  'kills',
  'deaths',
  'rebirths',
  'cycles',
  'dungeonFloorBest',
  'maxHit',
  'fastestKill',
]);

/**
 * 成就节语义检查（#9，可选节，存在才查）：
 * - id 去重（state.achievements 存档键）；
 * - 条件 stat 须命中引擎统计注册表（闭集镜像）；
 * - 奖励物品 xref items + 类型关卡：只收 mat/consumable（装备实例走
 *   掉落/炼制管线离散实例化，整袋发放只会成不可见死物——bag 不渲染
 *   items 键，gear 卡只认 state.gear）。
 */
function checkAchievements(
  achievements: readonly AchievementDef[],
  items: ReadonlyMap<string, number>,
  itemDefs: readonly Item[],
  errors: ContentError[],
): void {
  pushDuplicates(achievements, '/achievements', errors);
  achievements.forEach((achievement, i) => {
    const at = (field: string) => `/achievements/${i}/${field}`;
    if (!STAT_KEYS.has(achievement.condition.stat)) {
      errors.push({
        path: at('condition/stat'),
        keyword: 'xref',
        message: `统计键 "${achievement.condition.stat}" 不在引擎统计注册表（${[...STAT_KEYS].join('/')}）`,
      });
    }
    // 布尔型（无 target）声明 op = 语义歧义（引擎静默忽略，作者误以为反向阈值生效）：
    // 加载期大声拒绝，堵校验缝隙（双轴评审 spec(c)4）。
    if (achievement.condition.target === undefined && achievement.condition.op !== undefined) {
      errors.push({
        path: at('condition/op'),
        keyword: 'shape',
        message: '布尔型条件（无 target）不应声明 op（比较方向仅对阈值型有意义）',
      });
    }
    for (const [j, stack] of (achievement.reward?.items ?? []).entries()) {
      const itemAt = items.get(stack.item);
      if (itemAt === undefined) {
        errors.push({
          path: at(`reward/items/${j}/item`),
          keyword: 'xref',
          message: `奖励物品 "${stack.item}" 不存在于 items`,
        });
      } else if (itemDefs[itemAt]?.type === 'equip') {
        // 装备实例走掉落/炼制管线离散实例化，整袋发放只会成不可见死物
        // （bag 不渲染 items 键，gear 卡只认 state.gear）。
        errors.push({
          path: at(`reward/items/${j}/item`),
          keyword: 'xref',
          message: `奖励物品 "${stack.item}" 是 equip 类（装备须经掉落/炼制管线实例化，不能整袋发放）`,
        });
      }
    }
  });
}

/* ==================== 转生节（#6） ==================== */

/**
 * 重置/保留清单键域 = 引擎注册表闭集（与 rebirth.schema.json 的 enum 钉死一致，
 * 单一来源以 schema 为准，此处为语义侧同值镜像；引擎对未知键防御性忽略）。
 * reset 键由引擎逐键解释重置语义；keep 键由引擎绑定保留语义（gear 保留时
 * 佩戴表与 uid 序列器随动）；瞬态（活动/战斗/气血）由引擎一律清空回满，
 * 不进清单。协议文档：docs/agents/content.md「rebirth 转生节」。
 */
const REBIRTH_RESET_KEYS: ReadonlySet<string> = new Set(['skills', 'items', 'gold', 'buffs', 'lastEncounter']);
const REBIRTH_KEEP_KEYS: ReadonlySet<string> = new Set(['gear']);

/**
 * 转生节语义检查（#6，可选节，存在才查）：
 * - 重置/保留清单键域闭集 + 两集不相交（兵解语义不能同时清零又保留）；
 * - 天赋树：id 去重（state.talents 存档键）、requires xref 同树节点 + 查环、
 *   效果修饰符区约束（乘法区 > 0、加法%区 ≥ −100，与铭纹同律）；
 * - 解锁表：enemies/skills 引用 xref（enemies/skills 节）、同目标重复登记拒绝；
 * - 境界词表：同层数重复拒绝（映射歧义）。
 */
function checkRebirth(
  pack: ContentPack,
  enemies: ReadonlyMap<string, number>,
  skills: ReadonlyMap<string, number>,
  errors: ContentError[],
): void {
  const section: RebirthSection | undefined = pack.rebirth;
  if (section === undefined) return;

  // —— 清单键域与互斥。
  for (const [i, key] of section.reset.entries()) {
    if (!REBIRTH_RESET_KEYS.has(key)) {
      errors.push({
        path: `/rebirth/reset/${i}`,
        keyword: 'xref',
        message: `重置键 "${key}" 不在引擎重置注册表（${[...REBIRTH_RESET_KEYS].join('/')}）`,
      });
    }
  }
  for (const [i, key] of section.keep.entries()) {
    if (!REBIRTH_KEEP_KEYS.has(key)) {
      errors.push({
        path: `/rebirth/keep/${i}`,
        keyword: 'xref',
        message: `保留键 "${key}" 不在引擎保留注册表（${[...REBIRTH_KEEP_KEYS].join('/')}）`,
      });
    }
  }
  const resetSet = new Set(section.reset);
  for (const [i, key] of section.keep.entries()) {
    if (resetSet.has(key)) {
      errors.push({
        path: `/rebirth/keep/${i}`,
        keyword: 'shape',
        message: `保留键 "${key}" 与重置集冲突（同一资产不能既重置又保留）`,
      });
    }
  }

  // —— 天赋树：id 去重 + requires xref + 查环 + 效果修饰符区约束。
  const talents: readonly TalentNode[] = section.talents;
  pushDuplicates(talents, '/rebirth/talents', errors);
  const talentIds = new Set(talents.map((node) => node.id));
  talents.forEach((node, i) => {
    const at = (field: string) => `/rebirth/talents/${i}/${field}`;
    for (const [j, req] of (node.requires ?? []).entries()) {
      if (!talentIds.has(req)) {
        errors.push({
          path: at(`requires/${j}`),
          keyword: 'xref',
          message: `前置节点 "${req}" 不在同树 talents`,
        });
      }
    }
    checkModifiers(node.effects ?? [], at('effects'), errors);
  });
  // 查环（门禁侧保险，与原型继承同律）：DFS 三色标记，回边即环——
  // 菱形依赖（两节点共享前置）合法，不误报；环上每个成员各报一次。
  const requiresOf = new Map<string, readonly string[]>(
    talents.map((node) => [node.id, node.requires ?? []]),
  );
  const mark = new Map<string, 'visiting' | 'done'>();
  const detectsCycle = (id: string): boolean => {
    const m = mark.get(id);
    if (m === 'visiting') return true;
    if (m === 'done') return false;
    mark.set(id, 'visiting');
    let cycle = false;
    for (const req of requiresOf.get(id) ?? []) {
      if (talentIds.has(req) && detectsCycle(req)) cycle = true;
    }
    mark.set(id, 'done');
    return cycle;
  };
  talents.forEach((node, i) => {
    if (detectsCycle(node.id)) {
      errors.push({
        path: `/rebirth/talents/${i}/requires`,
        keyword: 'shape',
        message: `天赋 "${node.id}" 位于前置环上（requires 链成环）`,
      });
    }
  });

  // —— 解锁表：目标 xref + 同目标重复登记拒绝。
  const claimedEnemies = new Map<string, number>();
  const claimedSkills = new Map<string, number>();
  section.unlocks?.forEach((unlock, i) => {
    for (const [j, enemyId] of (unlock.enemies ?? []).entries()) {
      if (!enemies.has(enemyId)) {
        errors.push({
          path: `/rebirth/unlocks/${i}/enemies/${j}`,
          keyword: 'xref',
          message: `解锁目标敌人 "${enemyId}" 不存在于 enemies`,
        });
      }
      const first = claimedEnemies.get(enemyId);
      if (first !== undefined) {
        errors.push({
          path: `/rebirth/unlocks/${i}/enemies/${j}`,
          keyword: 'duplicate',
          message: `敌人 "${enemyId}" 已在第 ${first} 条解锁表登记（同目标重复）`,
        });
      } else {
        claimedEnemies.set(enemyId, i);
      }
    }
    for (const [j, skillId] of (unlock.skills ?? []).entries()) {
      if (!skills.has(skillId)) {
        errors.push({
          path: `/rebirth/unlocks/${i}/skills/${j}`,
          keyword: 'xref',
          message: `解锁目标技艺 "${skillId}" 不存在于 skills`,
        });
      }
      const first = claimedSkills.get(skillId);
      if (first !== undefined) {
        errors.push({
          path: `/rebirth/unlocks/${i}/skills/${j}`,
          keyword: 'duplicate',
          message: `技艺 "${skillId}" 已在第 ${first} 条解锁表登记（同目标重复）`,
        });
      } else {
        claimedSkills.set(skillId, i);
      }
    }
  });

  // —— 境界词表：同层数重复拒绝（层数 → 称号映射歧义）。
  const seenLevels = new Map<number, number>();
  section.realms?.forEach((realm, i) => {
    const first = seenLevels.get(realm.level);
    if (first !== undefined) {
      errors.push({
        path: `/rebirth/realms/${i}`,
        keyword: 'duplicate',
        message: `境界层数 ${realm.level} 与第 ${first} 项重复`,
      });
    } else {
      seenLevels.set(realm.level, i);
    }
  });
}
