/**
 * 内容包整体校验（issue #2；#16 扩展）。
 *
 * 两道关卡：
 * 1. **schema 校验**：各内容节对照 src/schema/ 下的 JSON Schema，
 *    逐字段上报（JSON Pointer 路径 + 关键字）。item 节按 type 走
 *    oneOf 五形态分流（mat/consumable/equip/blank 器胚/inscription 铭纹），
 *    跨形态字段由分支 additionalProperties:false 直接拒绝。
 * 2. **语义校验**：schema 表达不了的跨引用与形态规则——
 *    - 包根白名单（#43 D4）：包根只收 version + 16 注册节，未知顶层键
 *      （typo 节名）加载期拒绝（包=纯 content，ADR-017）；
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
 *    - 物品按类型的字段形态（equip 的 slot+bonuses 结构必填已升 schema
 *      分支 required，#45 对齐 blank 先例；语义层只管 consumable 须
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
 *
 * #94 起语义检查有第二个入口 validatePackSemantics（语义独立执行）：跳过
 * schema 面只跑语义，供带 schema 错编辑期使用（validateContentPack 在
 * schema 错误存在时提前返回、语义面缺席——editor 事务门禁 #56 的差集
 * 回滚在该状态拦不住悬空 drops 等跨引用新增）。独立入口以「节形态守卫 +
 * 条目参与守卫」对 schema 已破的包安全执行：畸形节跳过自身语义（读它的
 * 跨引用检查一并跳过——索引源失真会把好引用误报成悬空，这正是噪音级联
 * 的根因）、畸形条目跳过语义留给 schema 面，全部守卫在 schema 干净包上
 * 恒为 no-op（两入口共享同一套 semanticChecks，零第二实现漂移）。
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

/**
 * 节 schema 注册表（#11）：编辑器表单生成与节级校验的数据源——
 * 与 validateContentPack 内部用同一份 schema 对象，零拷贝零漂移。
 */
export type SectionSchemas = typeof SECTION_SCHEMAS;
export const sectionSchemas: SectionSchemas = SECTION_SCHEMAS;

type SectionName = keyof typeof SECTION_SCHEMAS;

const SECTION_NAMES = Object.keys(SECTION_SCHEMAS) as readonly SectionName[];

/** 包根合法键全集（#43 D4 白名单）：version + 16 注册节；包 = 纯 content（ADR-017）。 */
const KNOWN_ROOT_KEYS: ReadonlySet<string> = new Set<string>([
  'version',
  ...SECTION_NAMES,
]);

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

  // 包根白名单（#43 D4）：未注册顶层键（typo 节名如 "achivements"）加载期
  // 大声拒绝——曾静默过校验、可导出、editor 不可见。将来确需例外，显式扩
  // KNOWN_ROOT_KEYS（ADR-017"包=纯 content"，拒绝是对的）。
  for (const key of Object.keys(pack)) {
    if (!KNOWN_ROOT_KEYS.has(key)) {
      errors.push({
        path: `/${key}`,
        keyword: 'additionalProperties',
        message: `未知的包顶层键；合法键 = ${[...KNOWN_ROOT_KEYS].join(' / ')}`,
      });
    }
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

/* ==================== 语义独立入口（#94） ==================== */

/** 运行时形态守卫（#94）：record 判定（数组不算——数组节另有 Array.isArray 守卫）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 语义检查信任面（#94）：各节是否「结构完好」——可安全读作数组/对象、
 * 可作跨引用索引源。validateContentPack 路径 schema 已过，恒全可信
 * （SEMANTIC_ALL_TRUSTED 缺省）；语义独立入口按节形态现算。
 */
interface SemanticScope {
  readonly skills: boolean;
  readonly items: boolean;
  readonly recipes: boolean;
  readonly enemies: boolean;
  readonly gearDrops: boolean;
  readonly elements: boolean;
  readonly rarities: boolean;
  readonly shop: boolean;
  /** combatText 可读：本体 + moves/verbs 为对象（elementFlavor 声明了才查形态）。 */
  readonly combatText: boolean;
  /** config 可读：本体为对象且 slots 为数组（缺省 = 旧包形态，可信）。 */
  readonly config: boolean;
  readonly rebirth: boolean;
  readonly dungeons: boolean;
  readonly bosses: boolean;
  readonly achievements: boolean;
}

const SEMANTIC_ALL_TRUSTED: SemanticScope = {
  skills: true,
  items: true,
  recipes: true,
  enemies: true,
  gearDrops: true,
  elements: true,
  rarities: true,
  shop: true,
  combatText: true,
  config: true,
  rebirth: true,
  dungeons: true,
  bosses: true,
  achievements: true,
};

/** 可选数组字段守卫：缺省合法，存在须为数组。 */
function optArray(value: unknown): boolean {
  return value === undefined || Array.isArray(value);
}

/**
 * 节形态守卫现算（#94）：只做结构级判定（数组/对象形态），不做字段级
 * schema 校验——字段级破坏由条目参与守卫在检查内部防御。
 */
function semanticScopeOf(pack: Record<string, unknown>): SemanticScope {
  const isArray = (key: string): boolean => Array.isArray(pack[key]);
  const combatText = pack['combatText'];
  const config = pack['config'];
  const rebirth = pack['rebirth'];
  const elementFlavor = isRecord(combatText) ? combatText['elementFlavor'] : undefined;
  return {
    skills: isArray('skills'),
    items: isArray('items'),
    recipes: isArray('recipes'),
    enemies: isArray('enemies'),
    gearDrops: isArray('gearDrops'),
    elements: isArray('elements'),
    rarities: isArray('rarities'),
    shop: isArray('shop'),
    combatText:
      isRecord(combatText) &&
      isRecord(combatText['moves']) &&
      isRecord(combatText['verbs']) &&
      optRecord(elementFlavor),
    config: config === undefined || (isRecord(config) && Array.isArray(config['slots'])),
    rebirth:
      rebirth === undefined ||
      (isRecord(rebirth) &&
        Array.isArray(rebirth['reset']) &&
        Array.isArray(rebirth['keep']) &&
        Array.isArray(rebirth['talents']) &&
        optArray(rebirth['unlocks']) &&
        optArray(rebirth['realms'])),
    dungeons: optArray(pack['dungeons']),
    bosses: optArray(pack['bosses']),
    achievements: optArray(pack['achievements']),
  };
}

/** elementFlavor 专项：缺省合法，存在须为对象（池键遍历用 Object.keys）。 */
function optRecord(value: unknown): boolean {
  return value === undefined || isRecord(value);
}

/**
 * 语义检查独立入口（#94）：跳过 schema 面、只跑跨引用与形态语义，返回
 * 语义错误集（空集 = 语义面干净；包根非对象时无可语义对象，返回空集）。
 *
 * 与 validateContentPack 的分工：后者 schema 破即提前返回（防噪音级联的
 * 既有裁决），带错编辑期语义面缺席；本入口以节形态守卫（畸形节跳过自身
 * 语义，读它的跨引用检查一并跳过）+ 条目参与守卫（畸形条目留给 schema
 * 面）对任意包安全执行——不崩溃、错误集可控。schema 干净包上两入口的
 * 语义面同集（守卫恒 no-op）。
 */
export function validatePackSemantics(json: unknown): readonly ContentError[] {
  if (!isRecord(json)) {
    return [];
  }
  const errors: ContentError[] = [];
  semanticChecks(json as unknown as ContentPack, errors, semanticScopeOf(json));
  return errors;
}

/* ==================== 语义检查 ==================== */

/**
 * 跨引用与形态语义检查（#94 起带信任面 scope）：scope 缺省 = 全可信
 * （validateContentPack 路径，schema 已过、各节结构必然完好）；语义独立
 * 入口（validatePackSemantics）传入按节形态现算的 scope——不可信的节
 * 跳过自身语义检查，读它作索引源的跨引用检查一并跳过（索引源失真会把
 * 好引用误报成悬空，即噪音级联的根因），只留 schema 面报告。
 * 条目级破坏（节是数组但条目畸形）由各检查内部的条目参与守卫防御：
 * 畸形条目跳过语义留给 schema 面，好条目照查——守卫在 schema 干净包上
 * 恒为 no-op。
 */
function semanticChecks(
  pack: ContentPack,
  errors: ContentError[],
  scope: SemanticScope = SEMANTIC_ALL_TRUSTED,
): void {
  const itemIndex = scope.items ? indexIds(pack.items) : new Map<string, number>();
  const skillIndex = scope.skills ? indexIds(pack.skills) : new Map<string, number>();
  const enemyIndex = scope.enemies ? indexIds(pack.enemies) : new Map<string, number>();

  if (scope.items) checkIds(pack.items, '/items', errors);
  if (scope.skills) checkIds(pack.skills, '/skills', errors);
  if (scope.enemies) checkIds(pack.enemies, '/enemies', errors);
  if (scope.rarities) {
    checkIds(pack.rarities, '/rarities', errors);
    // rarities 数组序 = 档位序（低→高，#35 阈值比较严格按此序）：schema 无 rank
    // 字段，数组序是内容包作者的排档约定——倍率（mult）须随序单调不减，防「高档
    // 低倍」倒挂让阈值语义与直觉相悖（排档约定的语义守护，三处同步口径见文档）。
    // 倍率类型坏（非数值）不比（字典序会误报倒挂），留给 schema 面（#94）。
    for (let i = 1; i < pack.rarities.length; i++) {
      const prev = pack.rarities[i - 1];
      const cur = pack.rarities[i];
      // 条目 record 判定先行（审计 N-B）：null/畸形条目参与会让下面的 typeof
      // 守卫自身在读 .mult 时崩——不崩溃承诺先于比较律。
      if (!isRecord(prev) || !isRecord(cur)) continue;
      if (typeof prev.mult !== 'number' || typeof cur.mult !== 'number') continue;
      if (cur.mult < prev.mult) {
        errors.push({
          path: `/rarities/${i}/mult`,
          keyword: 'monotonic',
          message: `稀有度倍率与数组序倒挂：${cur.id}（mult ${cur.mult}）排在 ${prev.id}（mult ${prev.mult}）之后——档位序 = 数组序（低→高），mult 须单调不减`,
        });
      }
    }
  }
  if (scope.elements) checkIds(pack.elements, '/elements', errors);
  const slotIds =
    scope.config && scope.items && scope.skills
      ? checkConfig(pack.config, itemIndex, pack.items, skillIndex, errors)
      : undefined;

  // 武器语义槽位（#14 role 放宽，与引擎 weaponSlotOf 同律）：role === 'weapon'
  // 优先，未声明 role 的包按 id === 'weapon' 兜底；无 config（旧包形态）回落
  // 'weapon' 字面量——既有包零破坏。config 不可信（#94 语义独立路径）时武器
  // 身份无从判定，不推导（空集）——招式注册表家族随之跳过，防把真武器招式
  // 键误报成悬空键。
  const weaponSlotIds = new Set<string>();
  if (!scope.config) {
    // config 形态已破：槽位表不可读，跳过武器推导。
  } else if (pack.config === undefined) {
    weaponSlotIds.add('weapon');
  } else {
    for (const slot of pack.config.slots) {
      if (!isRecord(slot)) continue; // 畸形槽位留给 schema 面（#94）
      if (slot.role === 'weapon' || slot.id === 'weapon') weaponSlotIds.add(slot.id);
    }
  }

  const weaponIds = scope.items
    ? checkItemShapes(pack.items, slotIds, weaponSlotIds, errors)
    : new Set<string>();

  // 层数上限单一来源（#021 批 4，P2-1）：config.progression.maxLevel 存在时，
  // enemy.level 与活动/配方 unlockLevel 一律对照它（schema 魔法数 99 已清退）。
  // config 不可信或值类型坏时不对照（无从取得可信上限，#94 同「缺省跳过」律）。
  const rawMaxLevel = pack.config?.progression?.maxLevel;
  const maxLevel = scope.config && typeof rawMaxLevel === 'number' ? rawMaxLevel : undefined;

  if (scope.skills && scope.items) checkSkills(pack.skills, itemIndex, pack.items, maxLevel, errors);
  if (scope.recipes && scope.items && scope.skills) {
    checkRecipes(pack.recipes, itemIndex, pack.items, skillIndex, pack.skills, maxLevel, errors);
  }

  // combatText 不可信时以空注册表替代（依赖它的检查全部自空转，#94）。
  const moves: ContentPack['combatText']['moves'] = scope.combatText ? pack.combatText.moves : {};
  const verbs: ContentPack['combatText']['verbs'] = scope.combatText ? pack.combatText.verbs : {};
  if (scope.enemies && scope.items && scope.combatText) {
    checkEnemies(pack.enemies, itemIndex, pack.items, moves, maxLevel, errors);
  }
  if (scope.gearDrops && scope.items && scope.enemies) {
    checkGearDrops(pack.gearDrops, itemIndex, enemyIndex, pack.items, errors);
  }
  if (scope.shop && scope.items) checkShop(pack.shop, itemIndex, pack.items, errors);
  if (scope.items && scope.combatText) checkWeaponMoves(weaponIds, pack.items, moves, errors);
  // Boss 节（#8）：先于招式注册表检查（变招 moveKey 扩展合法注册键集）。
  const bossMoveKeys =
    scope.bosses && scope.enemies && scope.items && scope.combatText
      ? checkBosses(pack.bosses ?? [], enemyIndex, itemIndex, moves, errors)
      : new Set<string>();
  // 招式注册键合法性依赖全部键源（武器 = items+config、敌人、Boss 变招）
  // 可信——任一失真即把真键误报成悬空键，整体跳过（#94）。
  if (scope.combatText && scope.items && scope.config && scope.enemies && scope.bosses) {
    checkMoveRegistry(moves, weaponIds, enemyIndex, bossMoveKeys, errors);
  }
  if (scope.combatText) checkBasicFallback(moves, errors);
  if (scope.items && scope.enemies && scope.combatText) {
    checkVerbStyles(pack.items, pack.enemies, verbs, errors);
  }

  // 系别存在性（#25 键域开放）：注册表构建一次，三处引用面统一对照。
  // elements 不可信时空注册表会把一切引用误报成未注册，检查整体跳过（#94）。
  const elementIds = scope.elements
    ? new Set(pack.elements.filter((entry) => isRecord(entry)).map((entry) => entry.id))
    : new Set<string>();
  // 招式注册键集（审计修复④）：与 checkMoveRegistry 同源同律（basic 兜底 +
  // 武器 + 敌人 + Boss 变招），供铭纹条件 moveId 引用检查复用，零第二份键集逻辑。
  const moveKeys = new Set<string>(['basic', ...weaponIds, ...enemyIndex.keys(), ...bossMoveKeys]);
  if (scope.elements && scope.enemies && scope.items && scope.combatText && scope.config && scope.bosses) {
    checkElementRefs(pack, elementIds, moveKeys, errors);
  }
  // 系别机制签名（#15，ADR-012）：原语闭集镜像 + 机械原语参数必填。
  if (scope.elements) checkElementSignatures(pack.elements, errors);
  // 铭纹 feature 原语（#58 项 2）：键域闭集镜像 + 概率值域。
  if (scope.items) checkInscriptionFeatures(pack.items, errors);

  // 转生节（#6）：可选节，存在则查清单键域、天赋树 xref/查环、解锁表 xref、境界词表。
  if (scope.rebirth && scope.enemies && scope.skills) checkRebirth(pack, enemyIndex, skillIndex, errors);

  // 秘境节（#7）：可选节，存在则查 id 去重、钥匙/敌人/奖励 xref、生命周期覆盖。
  if (scope.dungeons && scope.enemies && scope.items) {
    checkDungeons(pack.dungeons ?? [], enemyIndex, itemIndex, errors);
  }

  // 成就节（#9）：可选节，存在则查 id 去重、统计键域闭集、奖励物品 xref + 类型关卡。
  if (scope.achievements && scope.items) {
    checkAchievements(pack.achievements ?? [], itemIndex, pack.items, errors);
  }

  if (scope.skills) checkPrototypes(pack.skills, '/skills', errors);
  if (scope.items) checkPrototypes(pack.items, '/items', errors);
  if (scope.enemies) checkPrototypes(pack.enemies, '/enemies', errors);
}

/** id → 首次出现的下标（#94：畸形条目不参与——留给 schema 面，防崩溃防噪音）。 */
function indexIds(entries: ReadonlyArray<{ readonly id: string }>): Map<string, number> {
  const map = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return;
    if (!map.has(entry.id)) {
      map.set(entry.id, index);
    }
  });
  return map;
}

/**
 * 内容 id 撞名黑名单（#75 项 12 根治，复审扩围全集）：Object.prototype 的
 * 全部成员名（constructor/hasOwnProperty/toString/valueOf/…，含访问器）
 * 恰好都过 id 形态 pattern，一旦成 id 就遮蔽状态表的属性读（#69 恢复期
 * 「静默丢数据 vs 容忍方法遮蔽」两难的源头）。导入期在此大声拒绝，包作者
 * 当场改名——schema pattern 表达不了名字黑名单（负向断言不进 draft-07
 * 子集），语义层单点收口。
 *
 * 名单**运行时派生**（Object.getOwnPropertyNames(Object.prototype)）而非
 * 手抄三名：同族名一个不漏、不随口误漂移；另加 'prototype'（非
 * Object.prototype 成员，但票面点名的同族误用名一并拒）。'__proto__' 在
 * 派生集内（前导下划线本也过不了 id pattern，双保险）。
 */
const UNSAFE_CONTENT_IDS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);

/**
 * id 域检查单点（#75 项 12）：重复 id + Object.prototype 撞名黑名单。
 * 所有 id 制声明节（items/skills/enemies/rarities/elements/slots/dungeons/
 * achievements/talents）皆经此收口。
 */
function checkIds(
  entries: ReadonlyArray<{ readonly id: string }>,
  basePath: string,
  errors: ContentError[],
): void {
  const firstSeen = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return; // 畸形条目留给 schema 面（#94）
    if (UNSAFE_CONTENT_IDS.has(entry.id)) {
      errors.push({
        path: `${basePath}/${index}`,
        keyword: 'reserved',
        message: `id "${entry.id}" 是 Object.prototype 方法名（会遮蔽状态表属性读），禁用`,
      });
      return;
    }
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
  skills: ReadonlyMap<string, number>,
  errors: ContentError[],
): ReadonlySet<string> | undefined {
  if (config === undefined) {
    return undefined;
  }
  checkIds(config.slots, '/config/slots', errors);
  const combat = config.combat;
  if (
    combat?.tierLightMax !== undefined &&
    combat.tierMidMax !== undefined &&
    combat.tierHeavyMax !== undefined &&
    typeof combat.tierLightMax === 'number' &&
    typeof combat.tierMidMax === 'number' &&
    typeof combat.tierHeavyMax === 'number' &&
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
  // 掉落侧稀有度偏置供体（#62 P1-2）：xref skills——引擎侧缺技能静默无偏置
  //（零降级路径），声明了不存在的技能是包作者的拼写错，加载期大声拒绝。
  const biasSkillId = config.gear?.biasSkillId;
  if (biasSkillId !== undefined && !skills.has(biasSkillId)) {
    errors.push({
      path: '/config/gear/biasSkillId',
      keyword: 'xref',
      message: `掉落偏置供体技能 "${biasSkillId}" 不存在于 skills`,
    });
  }
  // 槽位 id 集（畸形槽位条目不参与，#94）。
  return new Set(config.slots.flatMap((slot) => (isRecord(slot) && typeof slot.id === 'string' ? [slot.id] : [])));
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
    if (!isRecord(item)) return; // 畸形条目留给 schema 面（#94）
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
    if (item.type === 'consumable') {
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
      if (Array.isArray(item.inherentModifiers)) {
        checkModifiers(item.inherentModifiers, at('inherentModifiers'), errors);
      }
    } else if (item.type === 'inscription') {
      (Array.isArray(item.tiers) ? item.tiers : []).forEach((tier, tierIndex) => {
        if (Array.isArray(tier)) {
          checkModifiers(tier, `${at('tiers')}/${tierIndex}`, errors);
        }
      });
    }
  });
  return weaponIds;
}

/** 区间方向性：min 不得大于 max（floorRange/tierRange 与敌人 gold 同律）。 */
function checkRangeDirection(range: Range | undefined, path: string, errors: ContentError[]): void {
  // 区间端点类型坏（非数值）不比（字典序会误报方向倒挂），留给 schema 面（#94）。
  if (
    range !== undefined &&
    typeof range.min === 'number' &&
    typeof range.max === 'number' &&
    range.min > range.max
  ) {
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
    // 畸形修饰符/值类型坏不比，留给 schema 面（#94）。
    if (!isRecord(mod) || typeof mod.value !== 'number') return;
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
  const byId = new Map<string, PrototypeEntry>();
  for (const entry of entries) {
    if (isRecord(entry) && typeof entry.id === 'string') byId.set(entry.id, entry);
  }
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return; // 畸形条目留给 schema 面（#94）
    if (typeof entry.prototypeKey === 'string' && entry.prototypeKey !== entry.id) {
      errors.push({
        path: `${basePath}/${index}/prototypeKey`,
        keyword: 'prototype',
        message: `prototypeKey ("${entry.prototypeKey}") 必须等于条目自身 id ("${entry.id}")`,
      });
    }
    const parent = entry.prototypeParent;
    if (typeof parent !== 'string') {
      return; // 未声明或类型坏（后者留给 schema 面，#94）
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
      cursor =
        typeof cursor.prototypeParent === 'string' ? byId.get(cursor.prototypeParent) : undefined;
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
    if (!isRecord(skill)) return; // 畸形条目留给 schema 面（#94）
    // activities 表形态坏（null/非数组）不读 .length（审计 N-B 同族：属性读取
    // 前须判型），按「无可查活动」处理，类型错留给 schema 面。
    const hasActivities = Array.isArray(skill.activities) && skill.activities.length > 0;
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
    if (!Array.isArray(skill.activities)) return; // 活动表畸形留给 schema 面，逐活动检查跳过（#94）
    for (const [j, activity] of skill.activities.entries()) {
      if (!isRecord(activity)) continue; // 畸形活动留给 schema 面（#94）
      // 层数上限单一来源（#021 批 4，P2-1）：schema 魔法数 99 清退后对照 config。
      if (maxLevel !== undefined && typeof activity.unlockLevel === 'number' && activity.unlockLevel > maxLevel) {
        errors.push({
          path: `/skills/${i}/activities/${j}/unlockLevel`,
          keyword: 'shape',
          message: `解锁层数 ${activity.unlockLevel} 超过层数上限（config.progression.maxLevel = ${maxLevel}）`,
        });
      }
      if (!isRecord(activity.output) || typeof activity.output.item !== 'string') continue; // 产出形态坏留给 schema 面，xref 跳过（#94）
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
      const bonusItem = bonus !== undefined && isRecord(bonus) ? bonus['item'] : undefined;
      if (typeof bonusItem !== 'string') continue; // 副产出形态坏留给 schema 面（#94）
      if (!items.has(bonusItem)) {
        errors.push({
          path: `/skills/${i}/activities/${j}/byproduct/item`,
          keyword: 'xref',
          message: `副产出物品 "${bonusItem}" 不存在于 items`,
        });
      } else {
        rejectTemplateItem(itemDefs, items.get(bonusItem), `/skills/${i}/activities/${j}/byproduct/item`, '副产出物品', errors);
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
  const recipeNames = new Set<string>();
  recipes.forEach((recipe, i) => {
    if (!isRecord(recipe)) return; // 畸形条目留给 schema 面（#94）
    // 配方名唯一（#35 复核收口）：recipes 无 id，下标+名是唯二身份（activity 恢复
    // 与配方自动化规则的 ADR-015 对名守卫皆以此为前提）——重名会让守卫对
    // 「重排+重名」失明、规则静默换目标。名类型坏不参与去重（留给 schema 面，#94）。
    if (typeof recipe.name === 'string') {
      if (recipeNames.has(recipe.name)) {
        errors.push({
          path: `/recipes/${i}/name`,
          keyword: 'duplicate',
          message: `配方名 "${recipe.name}" 重复：配方无 id，下标+名是唯二身份（恢复期对名守卫的前提）`,
        });
      }
      recipeNames.add(recipe.name);
    }
    // 层数上限单一来源（#021 批 4，P2-1）：同 checkSkills。
    if (maxLevel !== undefined && typeof recipe.unlockLevel === 'number' && recipe.unlockLevel > maxLevel) {
      errors.push({
        path: `/recipes/${i}/unlockLevel`,
        keyword: 'shape',
        message: `解锁层数 ${recipe.unlockLevel} 超过层数上限（config.progression.maxLevel = ${maxLevel}）`,
      });
    }
    if (!isRecord(recipe.output) || typeof recipe.output.item !== 'string') return; // 产出形态坏留给 schema 面（#94）
    if (!items.has(recipe.output.item)) {
      errors.push({
        path: `/recipes/${i}/output/item`,
        keyword: 'xref',
        message: `产出物品 "${recipe.output.item}" 不存在于 items`,
      });
    } else {
      rejectTemplateItem(itemDefs, items.get(recipe.output.item), `/recipes/${i}/output/item`, '产出物品', errors);
    }
    if (!isRecord(recipe.materials)) return; // 材料表形态坏留给 schema 面（Object.keys 对字符串会产索引键噪音，#94）
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
    if (typeof recipe.skill !== 'string') return; // 所属技艺类型坏留给 schema 面（#94）
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
    if (!isRecord(enemy)) return; // 畸形条目留给 schema 面（#94）
    // 掉落表畸形留给 schema 面，drops xref 跳过（#94）；引用字段类型坏不查
    // 存在性（同 #94 参与律：类型对的引用照查）。
    if (Array.isArray(enemy.drops)) {
      for (const [j, drop] of enemy.drops.entries()) {
        if (!isRecord(drop) || typeof drop.item !== 'string') continue;
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
    }
    if (typeof enemy.id === 'string' && !hasMove(moves, enemy.id)) {
      errors.push({
        path: `/enemies/${i}`,
        keyword: 'xref',
        message: `敌人 "${enemy.id}" 未在 combatText.moves 注册招式名`,
      });
    }
    // 灵石区间端点类型坏不比（字典序会误报方向倒挂），留给 schema 面（#94）。
    if (
      isRecord(enemy.gold) &&
      typeof enemy.gold.min === 'number' &&
      typeof enemy.gold.max === 'number' &&
      enemy.gold.min > enemy.gold.max
    ) {
      errors.push({
        path: `/enemies/${i}/gold`,
        keyword: 'shape',
        message: `灵石区间 min(${enemy.gold.min}) 不得大于 max(${enemy.gold.max})`,
      });
    }
    // 层数上限单一来源（#021 批 4，P2-1）：schema 魔法数 99 清退后，
    // 上限对照 config.progression.maxLevel；config 缺省时无法取得上限，跳过
    // （引擎侧层数只影响开战门控，超高层数内容不可达但不致崩）。
    if (maxLevel !== undefined && typeof enemy.level === 'number' && enemy.level > maxLevel) {
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
    if (!isRecord(gearDrop)) return; // 畸形条目留给 schema 面（#94）
    if (typeof gearDrop.enemy === 'string' && !enemies.has(gearDrop.enemy)) {
      errors.push({
        path: `/gearDrops/${i}/enemy`,
        keyword: 'xref',
        message: `掉落归属敌人 "${gearDrop.enemy}" 不存在于 enemies`,
      });
    }
    if (!Array.isArray(gearDrop.pool)) return; // 池形态坏留给 schema 面（#94）
    for (const [j, itemId] of gearDrop.pool.entries()) {
      if (typeof itemId !== 'string') continue; // 引用类型坏留给 schema 面（#94）
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
    if (!isRecord(entry) || typeof entry.item !== 'string') return; // 畸形条目留给 schema 面（#94）
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
    if (!isRecord(item)) return; // 畸形条目留给 schema 面（#94）
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
    if (!isRecord(item)) return; // 畸形条目留给 schema 面（#94）
    if (typeof item.verbStyle === 'string' && !hasPool(item.verbStyle)) {
      errors.push({
        path: `/items/${i}/verbStyle`,
        keyword: 'xref',
        message: `动词风格 "${item.verbStyle}" 未在 combatText.verbs 注册`,
      });
    }
  });
  enemies.forEach((enemy, i) => {
    if (!isRecord(enemy) || typeof enemy.kind !== 'string') return; // 畸形条目留给 schema 面（#94）
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
 * 系别/招式引用存在性（#25 键域开放的存在性关卡，循 #21 动词风格先例）：
 * schema 只钉键形态不钉取值，引用合法性在此收口——敌人 element、
 * affinities 键、铭纹条件 element（胚纹/纹阶表/feature 三落点）、武器
 * element（equip/blank，#15）、elementFlavor 池键（#15）引用的系别键都
 * 必须命中 elements 节注册表；铭纹条件 moveId（审计修复④）必须命中
 * 招式注册键集（basic/武器/敌人/Boss 变招，与 checkMoveRegistry 同源）。
 * 坏引用加载期大声拒绝，逐字段可定位。
 * 缺省/兜底约定：敌人/武器不填 element = 凡击；聚合语境无 element 维度时
 * 条件修饰符不生效（引擎 conditionMatches 语义不变）。
 */
function checkElementRefs(
  pack: ContentPack,
  registered: ReadonlySet<string>,
  moveKeys: ReadonlySet<string>,
  errors: ContentError[],
): void {
  const message = (id: string): string => `系别 "${id}" 未在包 elements 节注册`;
  pack.enemies.forEach((enemy, i) => {
    if (!isRecord(enemy)) return; // 畸形条目留给 schema 面（#94）
    if (typeof enemy.element === 'string' && !registered.has(enemy.element)) {
      errors.push({
        path: `/enemies/${i}/element`,
        keyword: 'xref',
        message: message(enemy.element),
      });
    }
    // affinities 形态坏留给 schema 面（Object.keys 对字符串会产索引键噪音，#94）。
    if (isRecord(enemy.affinities)) {
      for (const key of Object.keys(enemy.affinities)) {
        if (!registered.has(key)) {
          errors.push({
            path: `/enemies/${i}/affinities/${key}`,
            keyword: 'xref',
            message: message(key),
          });
        }
      }
    }
  });
  pack.items.forEach((item, i) => {
    if (!isRecord(item)) return; // 畸形条目留给 schema 面（#94）
    // 武器系别（#15）：equip/blank 分支的 element 引用合法性（schema 已按
    // 分支钉形态，此处只收键域——引擎只消费武器槽，其余槽位为未来留门）。
    if (typeof item.element === 'string' && !registered.has(item.element)) {
      errors.push({
        path: `/items/${i}/element`,
        keyword: 'xref',
        message: message(item.element),
      });
    }
    const checkCondition = (condition: unknown, path: string): void => {
      if (!isRecord(condition)) return; // 条件形态坏留给 schema 面（#94）
      const element = condition['element'];
      if (typeof element === 'string' && !registered.has(element)) {
        errors.push({ path: `${path}/element`, keyword: 'xref', message: message(element) });
      }
      // 条件招式定向（审计修复④）：moveId 悬空 = 永不命中的死条件
      // （引擎 conditionMatches 按战斗语境 moveKey 精确比对），加载期拒绝。
      const moveId = condition['moveId'];
      if (typeof moveId === 'string' && !moveKeys.has(moveId)) {
        errors.push({
          path: `${path}/moveId`,
          keyword: 'xref',
          message: `招式 "${moveId}" 未在招式注册键集（basic/武器/敌人/Boss 变招）中注册`,
        });
      }
    };
    if (Array.isArray(item.inherentModifiers)) {
      item.inherentModifiers.forEach((mod, j) => {
        if (isRecord(mod)) checkCondition(mod.condition, `/items/${i}/inherentModifiers/${j}/condition`);
      });
    }
    if (Array.isArray(item.tiers)) {
      item.tiers.forEach((tier, t) => {
        if (!Array.isArray(tier)) return; // 纹阶行形态坏留给 schema 面（#94）
        tier.forEach((mod, j) => {
          if (isRecord(mod)) checkCondition(mod.condition, `/items/${i}/tiers/${t}/${j}/condition`);
        });
      });
    }
    if (isRecord(item.feature)) {
      checkCondition(item.feature.condition, `/items/${i}/feature/condition`);
    }
  });
  // 系别风味句池键（#15）：combatText.elementFlavor 键 = elements 注册系别。
  const elementFlavor = pack.combatText.elementFlavor ?? {};
  if (isRecord(elementFlavor)) {
    for (const [key] of Object.entries(elementFlavor)) {
      if (!registered.has(key)) {
        errors.push({
          path: `/combatText/elementFlavor/${key}`,
          keyword: 'xref',
          message: message(key),
        });
      }
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
export const ELEMENT_COMBAT_PRIMITIVES: ReadonlySet<string> = new Set(['defenseBreak', 'slow', 'swift']);

/**
 * 铭纹 feature 原语注册表镜像（#58 项 2，与 engine contentView.ts
 * INSCRIPTION_FEATURE_PRIMITIVES 同值闭集）：键 = 原语名，值 = value 域类别
 * （probability = 概率语义，feature.value 须落在 [0,1]）。未注册原语 = 引擎
 * 静默忽略的废牌铭纹（引擎对该原语的既有语义 = 忽略，无 loud 路径），加载期
 * 大声拒绝；值域越界同律（概率传 1.5 此前无界放行）。机制激活状态不在校验
 * 职责内（在册 = 键域/值域锚定，战斗消费实现属引擎后续票）。
 */
export const INSCRIPTION_FEATURE_PRIMITIVES: Readonly<Record<string, 'probability'>> = {
  poisonSpread: 'probability',
  chainBolt: 'probability',
};

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
    if (!isRecord(element)) return; // 畸形条目留给 schema 面（#94）
    const signature = element.signature;
    if (signature === undefined) return;
    if (!isRecord(signature)) return; // 签名形态坏留给 schema 面，不误报原语键域（#94）
    const at = (field: string) => `/elements/${i}/signature/${field}`;
    if (typeof signature.primitive !== 'string' || !ELEMENT_COMBAT_PRIMITIVES.has(signature.primitive)) {
      errors.push({
        path: at('primitive'),
        keyword: 'xref',
        message: `机制原语 "${String(signature.primitive)}" 不在引擎签名注册表（${[...ELEMENT_COMBAT_PRIMITIVES].join('/')}）`,
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

/* ==================== 铭纹 feature 原语（#58 项 2） ==================== */

/**
 * 铭纹 feature 检查（#58 项 2，可选字段，声明才查；condition 引用合法性
 * 已在 checkElementRefs 三落点收口，此处只收原语键域与 value 域）：
 * - primitive 须命中引擎铭纹 feature 注册表镜像（未注册 = 引擎静默忽略的
 *   废牌铭纹，加载期大声拒绝）；
 * - probability 类原语的 value 有值时须落 [0,1]（概率语义域；此前无界，
 *   传 1.5 照单全收）。
 */
function checkInscriptionFeatures(
  items: ContentPack['items'],
  errors: ContentError[],
): void {
  items.forEach((item, i) => {
    if (!isRecord(item)) return; // 畸形条目留给 schema 面（#94）
    const feature = item.feature;
    if (feature === undefined) return;
    if (!isRecord(feature) || typeof feature.primitive !== 'string') return; // 形态坏留给 schema 面（#94）
    const at = (field: string) => `/items/${i}/feature/${field}`;
    const domain = INSCRIPTION_FEATURE_PRIMITIVES[feature.primitive];
    if (domain === undefined) {
      errors.push({
        path: at('primitive'),
        keyword: 'xref',
        message: `机制原语 "${feature.primitive}" 不在引擎铭纹 feature 注册表（${Object.keys(INSCRIPTION_FEATURE_PRIMITIVES).join('/')}）`,
      });
      return; // 键域已坏，值域不再对号（错误信息保持单点可定位）
    }
    if (feature.value !== undefined && domain === 'probability' && !(feature.value >= 0 && feature.value <= 1)) {
      errors.push({
        path: at('value'),
        keyword: 'shape',
        message: `概率原语（${feature.primitive}）value 须落在 0~1，得 ${feature.value}`,
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
  checkIds(dungeons, '/dungeons', errors);
  dungeons.forEach((dungeon, i) => {
    if (!isRecord(dungeon)) return; // 畸形条目留给 schema 面（#94）
    const at = (field: string) => `/dungeons/${i}/${field}`;
    if (isRecord(dungeon.entry) && typeof dungeon.entry.key === 'string' && !items.has(dungeon.entry.key)) {
      errors.push({
        path: at('entry/key'),
        keyword: 'xref',
        message: `钥匙物品 "${dungeon.entry.key}" 不存在于 items`,
      });
    }
    if (!Array.isArray(dungeon.layers)) return; // 层表形态坏留给 schema 面，逐层检查跳过（#94）

    // 逐行引用与方向性检查。
    dungeon.layers.forEach((layer, j) => {
      if (!isRecord(layer)) return; // 畸形层行留给 schema 面（#94）
      const layerAt = (field: string) => `/dungeons/${i}/layers/${j}/${field}`;
      if (Array.isArray(layer.enemies)) {
        for (const [k, entry] of layer.enemies.entries()) {
          if (!isRecord(entry) || typeof entry.enemy !== 'string') continue; // 引用类型坏留给 schema 面（#94）
          if (!enemies.has(entry.enemy)) {
            errors.push({
              path: layerAt(`enemies/${k}/enemy`),
              keyword: 'xref',
              message: `层敌人 "${entry.enemy}" 不存在于 enemies`,
            });
          }
        }
      }
      const rewardItems = isRecord(layer.rewards) ? layer.rewards.items : undefined;
      if (Array.isArray(rewardItems)) {
        for (const [k, stack] of rewardItems.entries()) {
          if (!isRecord(stack) || typeof stack.item !== 'string') continue; // 引用类型坏留给 schema 面（#94）
          if (!items.has(stack.item)) {
            errors.push({
              path: layerAt(`rewards/items/${k}/item`),
              keyword: 'xref',
              message: `层奖励物品 "${stack.item}" 不存在于 items`,
            });
          }
        }
      }
      // 推荐战力方向性：端点类型坏不比（字典序误报），留给 schema 面（#94）。
      if (
        isRecord(layer.recommendedPower) &&
        typeof layer.recommendedPower.min === 'number' &&
        typeof layer.recommendedPower.max === 'number' &&
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
    // 层数/层段形态坏（非数值）时区间算术不可信，整段跳过留给 schema 面（#94）。
    const floorsFormOk =
      typeof dungeon.floors === 'number' &&
      dungeon.layers.every((layer) => {
        const floor = isRecord(layer) ? layer.floor : undefined;
        return isRecord(floor) && typeof floor.min === 'number' && typeof floor.max === 'number';
      });
    if (!floorsFormOk) return;
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
    if (!isRecord(boss)) return; // 畸形条目留给 schema 面（#94）
    const at = (field: string) => `/bosses/${i}/${field}`;
    if (typeof boss.enemy === 'string') {
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
    }
    if (!Array.isArray(boss.phases)) return; // 阶段表形态坏留给 schema 面（#94）
    boss.phases.forEach((phase, j) => {
      if (!isRecord(phase)) return; // 畸形阶段留给 schema 面（#94）
      const phaseAt = (field: string) => `/bosses/${i}/phases/${j}/${field}`;
      const prev = j > 0 ? boss.phases[j - 1] : undefined;
      // 阈值类型坏不比（字典序会误报递减违例），留给 schema 面（#94）。
      if (
        isRecord(prev) &&
        typeof phase.threshold === 'number' &&
        typeof prev.threshold === 'number' &&
        phase.threshold >= prev.threshold
      ) {
        errors.push({
          path: phaseAt('threshold'),
          keyword: 'shape',
          message: `阶段阈值须严格递减（${phase.threshold} 不得大于等于前一阶段的 ${prev.threshold}）`,
        });
      }
      if (typeof phase.moveKey === 'string') {
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
      const summons = isRecord(phase.summons) ? phase.summons.enemies : undefined;
      (Array.isArray(summons) ? summons : []).forEach((entry, k) => {
        if (!isRecord(entry) || typeof entry.enemy !== 'string') return; // 引用类型坏留给 schema 面（#94）
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
    const bossDrops = Array.isArray(boss.drops) ? boss.drops : [];
    for (const [k, drop] of bossDrops.entries()) {
      if (!isRecord(drop) || typeof drop.item !== 'string') continue; // 引用类型坏留给 schema 面（#94）
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
export const STAT_KEYS: ReadonlySet<string> = new Set([
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
  checkIds(achievements, '/achievements', errors);
  achievements.forEach((achievement, i) => {
    if (!isRecord(achievement) || !isRecord(achievement.condition)) return; // 畸形条目留给 schema 面（#94）
    const at = (field: string) => `/achievements/${i}/${field}`;
    if (typeof achievement.condition.stat === 'string' && !STAT_KEYS.has(achievement.condition.stat)) {
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
    const rewardItems = isRecord(achievement.reward) ? achievement.reward.items : undefined;
    if (!Array.isArray(rewardItems)) return; // 奖励表形态坏留给 schema 面（#94）
    for (const [j, stack] of rewardItems.entries()) {
      if (!isRecord(stack) || typeof stack.item !== 'string') continue; // 引用类型坏留给 schema 面（#94）
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
export const REBIRTH_RESET_KEYS: ReadonlySet<string> = new Set(['skills', 'items', 'gold', 'buffs', 'lastEncounter']);
export const REBIRTH_KEEP_KEYS: ReadonlySet<string> = new Set(['gear']);

/**
 * 转生节语义检查（#6，可选节，存在才查）：
 * - 重置/保留清单键域闭集 + 两集不相交（兵解语义不能同时清零又保留）；
 * - 天赋树：id 去重（state.talents 存档键）、requires xref 同树节点 + 查环、
 *   效果修饰符区约束（乘法区 > 0、加法%区 ≥ −100，与铭纹同律）、
 *   repeatable 价梯长度 = maxStacks − 1（#61，跨字段一致性）；
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

  // —— 清单键域与互斥（reset/keep/talents/unlocks/realms 的节级数组形态
  // 由信任面 scope 保证——clean 路径靠 schema、独立路径靠 semanticScopeOf，#94）。
  for (const [i, key] of section.reset.entries()) {
    if (typeof key === 'string' && !REBIRTH_RESET_KEYS.has(key)) {
      errors.push({
        path: `/rebirth/reset/${i}`,
        keyword: 'xref',
        message: `重置键 "${key}" 不在引擎重置注册表（${[...REBIRTH_RESET_KEYS].join('/')}）`,
      });
    }
  }
  for (const [i, key] of section.keep.entries()) {
    if (typeof key === 'string' && !REBIRTH_KEEP_KEYS.has(key)) {
      errors.push({
        path: `/rebirth/keep/${i}`,
        keyword: 'xref',
        message: `保留键 "${key}" 不在引擎保留注册表（${[...REBIRTH_KEEP_KEYS].join('/')}）`,
      });
    }
  }
  const resetSet = new Set(section.reset);
  for (const [i, key] of section.keep.entries()) {
    if (typeof key === 'string' && resetSet.has(key)) {
      errors.push({
        path: `/rebirth/keep/${i}`,
        keyword: 'shape',
        message: `保留键 "${key}" 与重置集冲突（同一资产不能既重置又保留）`,
      });
    }
  }

  // —— 天赋树：id 去重 + requires xref + 查环 + 效果修饰符区约束。
  const talents: readonly TalentNode[] = section.talents;
  checkIds(talents, '/rebirth/talents', errors);
  const talentIds = new Set(
    talents.filter((node) => isRecord(node) && typeof node.id === 'string').map((node) => node.id),
  );
  talents.forEach((node, i) => {
    if (!isRecord(node)) return; // 畸形条目留给 schema 面（#94）
    const at = (field: string) => `/rebirth/talents/${i}/${field}`;
    if (Array.isArray(node.requires)) {
      for (const [j, req] of node.requires.entries()) {
        if (typeof req !== 'string') continue; // 引用类型坏留给 schema 面（#94）
        if (!talentIds.has(req)) {
          errors.push({
            path: at(`requires/${j}`),
            keyword: 'xref',
            message: `前置节点 "${req}" 不在同树 talents`,
          });
        }
      }
    }
    if (Array.isArray(node.effects)) {
      checkModifiers(node.effects, at('effects'), errors);
    }
    // —— repeatable 价梯（#61）：costs = 第 2..maxStacks 层各一档，长度须
    // = maxStacks − 1（首层价 = 节点 cost；无 costs = 恒价，合法）。
    // maxStacks ≥ 1 / costs 项正整数归 schema 形态，此处只查跨字段一致性；
    // 字段形态坏（maxStacks 非数值/costs 非数组）不比，留给 schema 面（#94）。
    const repeatable = node.repeatable;
    if (
      isRecord(repeatable) &&
      Array.isArray(repeatable.costs) &&
      typeof repeatable.maxStacks === 'number' &&
      repeatable.costs.length !== repeatable.maxStacks - 1
    ) {
      errors.push({
        path: at('repeatable'),
        keyword: 'shape',
        message: `天赋 "${node.id}" 价梯长度 ${repeatable.costs.length} ≠ maxStacks − 1（${repeatable.maxStacks - 1}：第 2..${repeatable.maxStacks} 层各一档，首层归 cost）`,
      });
    }
  });
  // 查环（门禁侧保险，与原型继承同律）：DFS 三色标记，回边即环——
  // 菱形依赖（两节点共享前置）合法，不误报；环上每个成员各报一次。
  const requiresOf = new Map<string, readonly string[]>(
    talents
      .filter((node) => isRecord(node) && typeof node.id === 'string')
      .map((node) => [node.id, Array.isArray(node.requires) ? node.requires : []]),
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
    if (!isRecord(node) || typeof node.id !== 'string') return; // 畸形条目不参与查环（#94）
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
    if (!isRecord(unlock)) return; // 畸形条目留给 schema 面（#94）
    if (Array.isArray(unlock.enemies)) {
      for (const [j, enemyId] of unlock.enemies.entries()) {
        if (typeof enemyId !== 'string') continue; // 引用类型坏留给 schema 面（#94）
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
    }
    if (Array.isArray(unlock.skills)) {
      for (const [j, skillId] of unlock.skills.entries()) {
        if (typeof skillId !== 'string') continue; // 引用类型坏留给 schema 面（#94）
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
    }
  });

  // —— 境界词表：同层数重复拒绝（层数 → 称号映射歧义）。
  const seenLevels = new Map<number, number>();
  section.realms?.forEach((realm, i) => {
    if (!isRecord(realm) || typeof realm.level !== 'number') return; // 畸形条目留给 schema 面（#94）
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
