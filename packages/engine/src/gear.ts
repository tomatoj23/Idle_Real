/**
 * 装备实例机制（issue #4；#018 批 1 数据化后对齐 ADR-016）。
 *
 * 本文件只保留**运行时机制**：稀有度掷点（参数化：读内容表权重）、
 * 词条实例化（读内容词条池）、倍率投影（ADR-011 单管线）。档位表、
 * 词条池、掷点概率、量级系数等玩法参数全部由 content 包
 * `rarities`/`affixPool` 节定义（ADR-016 裁决 ①：词表零默认，validate
 * 强制节恒在）——引擎内置默认表已废除；对缺失内容按"缺档回退第一档 /
 * 空表中性降级"安全兜底，兜底是路径不是数据。
 * 装备实例以 uid 常驻状态（GameState.gear），槽位只存 uid。
 *
 * ADR-011 纪律：装备对属性的贡献一律投影为 Modifier 贡献走统一聚合管线
 * （#13），本模块不直接算玩家属性。稀有度倍率在实例化投影时折算进 flat
 * 值（round(基础 × 倍率)，沿用旧版 gearStats 基线）——装备产出方只有
 * flat 一种区，不存在第二条直算路径。
 */
import type { GameContent } from './types.js';
import {
  BASE_GEAR_PARAMS,
  affixParamsOf,
  affixPoolOf,
  findBlank,
  findInscription,
  findItem,
  findRarity,
  gearParamsOf,
  inscriptionsOf,
  raritiesOf,
  type AffixPoolView,
  type BlankView,
  type GearDropView,
} from './contentView.js';
import { buildTagIndex, queryByTag } from './tags.js';
import type { ModifierSource } from './modifiers.js';

/** 档位 id 开放键域：具体取值由内容包 rarities 节定义，引擎不理解任何具体档位。 */
export type Rarity = string;

/** 已实例化的随机词条。 */
export interface Affix {
  readonly name: string;
  readonly stat: string;
  readonly val: number;
}

/**
 * 已实例化的铭纹（#14）：id 稳定引用内容铭纹条目（ADR-015），tier = 纹阶
 * 1~3；数值不落盘——展示与投影时按 tiers[tier] 从内容表读（内容改表 = 改
 * 全部同纹阶实例，口诀「纹阶是果（质量）」的实例化形态）。
 */
export interface GearInscription {
  readonly id: string;
  readonly tier: number;
}

/** 装备实例：uid 全局唯一，随档持久化。 */
export interface GearInstance {
  readonly uid: number;
  /** 内容包物品 id（type=equip 或 type=blank 器胚，#14）。 */
  readonly itemId: string;
  readonly rarity: Rarity;
  readonly affixes: readonly Affix[];
  /** 铭纹（#14，器胚实例专用）；空/缺省 = 无（未显式写入字段不落盘，ADR-013）。 */
  readonly inscriptions?: readonly GearInscription[];
}

/**
 * 装备模板加成形状（#021 批 4，N3 五处副本单一来源裁决）：键 = stat id
 * （开放键域，与 content 包 bonuses / affixPool.stat 同源），值 = flat 基础量。
 * 与 Modifier 的形状统一决策：bonuses 是装备模板的 flat 简写（省 zone/condition，
 * 投影时折算稀有度倍率后走 ADR-011 单管线），键域与 Modifier.stat 同一注册表
 * （消费点清单见 docs/agents/content.md）。
 */
export type GearBonuses = Readonly<Record<string, number>>;

/* ---------- 掷点（随机源一律注入，ADR-013） ---------- */

/**
 * 稀有度掷点（参数化机制，ADR-016 判例）：权重表由内容包 rarities 节提供，
 * 按权重占比归一化掷档（权重无需配成 1）。`bias` 是外部加权输入位（#5 落地，
 * #14 掉落管线复用同签名）：正值上移掷点 → 数组序后段（高档位）实际占比
 * 单调上升（旧版 js/game.js:84-95 的 `r - lvBonus` 同义，方向适配本表
 * 「数组顺序即档位顺序、末位最高」的约定）；不传（= 0）时与旧签名逐点同分布。
 * 空表/无正权重返回空串：缺内容降级，一切档位解析方按中性值兜底。
 */
export function rollRarity(content: GameContent, random: () => number, bias = 0): Rarity {
  const table = raritiesOf(content).filter((def) => def.weight > 0);
  const total = table.reduce((sum, def) => sum + def.weight, 0);
  if (!(total > 0)) return '';
  let roll = (random() + Math.max(0, bias)) * total;
  for (const def of table) {
    roll -= def.weight;
    if (roll < 0) return def.id;
  }
  const last = table[table.length - 1];
  return last ? last.id : '';
}

/* ---------- 词条机制参数（#020 批 3：引擎基线 + config.affix 覆盖） ---------- */

/**
 * 装备随机词条机制参数：config.affix 同名字段覆盖引擎基线
 * （ADR-016 裁决 ① 分策）。量级标尺系数与波动幅度是机制参数位；
 * 每条词条的量级系数（scale）本身仍归内容词条池（#018）。
 */
export interface AffixParams {
  /** 基础标尺：hp 加成参与取值前先除以该值。 */
  readonly hpDivider: number;
  /** 基础标尺：crit 加成参与取值前先乘该系数。 */
  readonly critScale: number;
  /** 基础标尺兜底下限。 */
  readonly baseScaleFloor: number;
  /** 词条值随机波动幅度（乘数 1−v ~ 1+v）。 */
  readonly variance: number;
}

/** 引擎基线（旧版 gearStats 沿革：hp÷5 / crit×0.8 / 兜底 3、±20% 波动）。 */
export const BASE_AFFIX_PARAMS: AffixParams = {
  hpDivider: 5,
  critScale: 0.8,
  baseScaleFloor: 3,
  variance: 0.2,
};

/**
 * 基础加成的量级标尺（逐项折算，#021 批 4 开放键域）：hp÷divider、
 * crit×critScale 按参数折算（量纲差异归引擎机制 stat），其余 stat（含
 * 新增键）原值参与，兜底下限封底。
 */
function baseScaleOf(bonuses: GearBonuses, p: AffixParams): number {
  // 使用点防崩（先例 rollRarity 的 weight>0 过滤）：divider ≤ 0 会产生
  // Infinity 标尺并持久化进词条值，回落基线 divider（包校验关卡本应拒绝）。
  const divider = p.hpDivider > 0 ? p.hpDivider : BASE_AFFIX_PARAMS.hpDivider;
  let scale = p.baseScaleFloor;
  for (const [stat, value] of Object.entries(bonuses)) {
    if (typeof value !== 'number' || !(value > 0)) continue;
    const scaled = stat === 'hp' ? value / divider : stat === 'crit' ? value * p.critScale : value;
    if (scaled > scale) scale = scaled;
  }
  return scale;
}

/**
 * 词条数值：max(1, round(基础标尺 × scale × 波动))。量级系数（scale）来自
 * 内容词条池；波动幅度由 config.affix.variance 承载（#020）。
 */
function rollAffixVal(
  baseScale: number,
  entry: AffixPoolView,
  random: () => number,
  p: AffixParams,
): number {
  return Math.max(1, Math.round(baseScale * entry.scale * (1 - p.variance + random() * p.variance * 2)));
}

/** makeGear 尾参选项对象（ADR-017 附带推论 5：API 形态优先，尾参收 options）。 */
export interface MakeGearOptions {
  /** 显式档位；缺省 = rollRarity(content, random)（调用方自带偏置时显式传入）。 */
  readonly rarity?: Rarity;
  /** 词条机制参数；缺省 = 引擎基线（config.affix 缺省时的等价路径）。 */
  readonly affix?: AffixParams;
}

/**
 * 生成装备实例（equip 路径）：roll 稀有度（或调用方指定）→ 按稀有度词条数
 * 从内容词条池掷不重复 stat 词条。uid 由调用方（game 状态机）分配并写入
 * gearSeq。affix 缺省用引擎基线（config.affix 缺省时的等价路径）。
 */
export function makeGear(
  content: GameContent,
  itemId: string,
  bonuses: GearBonuses,
  uid: number,
  random: () => number,
  options: MakeGearOptions = {},
): GearInstance {
  const rarity = options.rarity ?? rollRarity(content, random);
  const affix = options.affix ?? BASE_AFFIX_PARAMS;
  const affixCount = findRarity(content, rarity)?.affix ?? 0;
  const scale = baseScaleOf(bonuses, affix);
  const affixes: Affix[] = [];
  if (affixCount > 0) {
    const pool = affixPoolOf(content);
    const used = new Set<string>();
    let guard = 0;
    while (affixes.length < affixCount && guard++ < 20) {
      const entry = pool[Math.floor(random() * pool.length) % pool.length];
      if (!entry || used.has(entry.stat)) continue;
      used.add(entry.stat);
      affixes.push({ name: entry.name, stat: entry.stat, val: rollAffixVal(scale, entry, random, affix) });
    }
  }
  return { uid, itemId, rarity, affixes };
}

/* ---------- 器胚 × 铭纹（#14：掉落管线 ④~⑧ 与重铸的实例化机制） ---------- */

/** 纹阶合法域 1~3（schema 关卡同域；运行时兜底钳制）。 */
function clampTier(tier: number): number {
  return Math.max(1, Math.min(3, Math.floor(tier)));
}

/**
 * 器胚纹阶域（#14 单一来源）：tierRange 按合法域 1~3 钳制后的 [min, max]，
 * 方向性兜底（min > max 时收成单点）。实例化掷阶（⑦）、重铸铭纹、存档恢复
 * 钳制三处共用——「天花板由器胚 tierRange 数据锁死」只此一份实现。
 */
export function tierBoundsOf(blank: {
  readonly tierRange?: { readonly min: number; readonly max: number };
}): readonly [number, number] {
  const min = clampTier(blank.tierRange?.min ?? 1);
  return [min, Math.max(min, clampTier(blank.tierRange?.max ?? min))];
}

/**
 * 标签加权抽铭纹（管线 ⑥⑦）：权重 = 基础 1 × (1+匹配数×加成系数)，匹配数 =
 * 器胚 preferredTags ∩ 铭纹 tags（倒排索引查交集，扩池零改动）；同实例不重复
 * 铭纹 id；每条铭纹按器胚 tierRange 掷纹阶（⑦，天花板数据锁死）。
 * 池空/词条数为 0 → 空表（中性降级）。
 */
function drawInscriptions(
  content: GameContent,
  blank: BlankView,
  count: number,
  random: () => number,
  tagWeightPerMatch: number,
): GearInscription[] {
  const pool = inscriptionsOf(content);
  if (count <= 0 || pool.length === 0) return [];
  const [tierMin, tierMax] = tierBoundsOf(blank);
  const index = buildTagIndex(pool);
  const preferred = blank.preferredTags ?? [];
  const weight = Math.max(0, tagWeightPerMatch);
  const chosen: GearInscription[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (chosen.length < count && guard++ < 50) {
    const candidates = pool.filter((def) => !used.has(def.id));
    if (candidates.length === 0) break;
    const weights = candidates.map((def) => {
      let matches = 0;
      for (const tag of preferred) {
        if (queryByTag(index, tag).some((entry) => entry.id === def.id)) matches += 1;
      }
      return 1 + matches * weight;
    });
    let roll = random() * weights.reduce((sum, w) => sum + w, 0);
    let picked = candidates[candidates.length - 1]!;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) {
        picked = candidates[i]!;
        break;
      }
    }
    used.add(picked.id);
    chosen.push({ id: picked.id, tier: tierMin + Math.floor(random() * (tierMax - tierMin + 1)) });
  }
  return chosen;
}

/** makeInscribedGear 尾参选项对象（器胚实例化，#14）。 */
export interface MakeInscribedGearOptions {
  /** 显式档位；缺省 = rollRarity(content, random)。 */
  readonly rarity?: Rarity;
  /** 标签加权系数（config.gear.tagWeightPerMatch 参数位）；缺省 = 引擎基线。 */
  readonly tagWeightPerMatch?: number;
}

/**
 * 生成器胚实例（管线 ④⑤⑥⑦）：读稀有度 def 的词条数（「稀有度是因」）→
 * 标签加权抽铭纹 → 按器胚 tierRange 掷纹阶（「纹阶是果（质量）」）。胚纹与
 * 铭纹数值不进实例——投影时从内容表读（见 gearContributions）。
 * 器胚定义缺失/非器胚：安全降级为无词条裸实例，绝不因内容缺失崩溃。
 */
export function makeInscribedGear(
  content: GameContent,
  blankId: string,
  uid: number,
  random: () => number,
  options: MakeInscribedGearOptions = {},
): GearInstance {
  const rarity = options.rarity ?? rollRarity(content, random);
  const blank = findBlank(content, blankId);
  if (!blank) return { uid, itemId: blankId, rarity, affixes: [] };
  const affixCount = findRarity(content, rarity)?.affix ?? 0;
  const inscriptions = drawInscriptions(
    content,
    blank,
    affixCount,
    random,
    options.tagWeightPerMatch ?? BASE_GEAR_PARAMS.tagWeightPerMatch,
  );
  return {
    uid,
    itemId: blankId,
    rarity,
    affixes: [],
    ...(inscriptions.length > 0 ? { inscriptions } : {}),
  };
}

/** 掉落管线语境（#14）：秘境层数驱动管线 ② 的器胚 floorRange 筛选。 */
export interface GearDropContext {
  /** 当前秘境层数（1 起）；缺省 = 无层语境（野战），不筛层。 */
  readonly floor?: number;
}

/**
 * 掉落管线（#14 补全 ①②③⑦，ADR-0012 八步的项目版）：
 * ① 掉不掉（chance 掷点）→ ② 按秘境层数筛器胚池（equip 条目不受层筛，
 * 兼容旧池）→ ③ 均匀选底材 → ④⑤⑥⑦ 分流实例化（equip 走词条池旧管线；
 * 器胚走铭纹管线，稀有度掷点不传偏置 = 与旧签名逐点同分布，#5 接缝）。
 * 未掉落/池空/引用全失效返回 undefined（缺内容降级，绝不崩溃）。
 */
export function rollGear(
  content: GameContent,
  drop: GearDropView,
  uid: number,
  random: () => number,
  context: GearDropContext = {},
): GearInstance | undefined {
  if (!(random() < drop.chance)) return undefined; // ① 掉不掉
  const candidates = (drop.pool ?? []).filter((itemId) => {
    const item = findItem(content, itemId);
    if (!item) return false;
    if (item.type !== 'blank') return true;
    const range = findBlank(content, itemId)?.floorRange;
    return context.floor === undefined || range === undefined
      || (context.floor >= range.min && context.floor <= range.max);
  });
  if (candidates.length === 0) return undefined;
  const itemId = candidates[Math.floor(random() * candidates.length) % candidates.length]!; // ③ 选底材
  const item = findItem(content, itemId);
  if (!item) return undefined;
  if (item.type === 'blank') {
    return makeInscribedGear(content, item.id, uid, random, {
      tagWeightPerMatch: gearParamsOf(content).tagWeightPerMatch, // ④~⑦ 铭纹管线
    });
  }
  // ④~⑥ 词条池旧管线：标尺/波动与炼制路径同调 config.affix（同包双路径一把尺）。
  return makeGear(content, item.id, item.bonuses ?? {}, uid, random, {
    affix: affixParamsOf(content),
  });
}

/* ---------- 展示与价值（档名/卖价倍率全部查内容表） ---------- */

/** 「档名·物品名」；档名缺失（空表/降级）时省略前缀，不产出占位文案。 */
export function gearName(content: GameContent, itemName: string, rarity: Rarity): string {
  const tier = findRarity(content, rarity);
  return tier?.name ? `${tier.name}·${itemName}` : itemName;
}

/** 卖价 = max(1, round(物品卖价 × 档位卖价倍率))。 */
export function gearSell(content: GameContent, itemSell: number, rarity: Rarity): number {
  return Math.max(1, Math.round(itemSell * (findRarity(content, rarity)?.sell ?? 1)));
}

/* ---------- 修饰符贡献投影（ADR-011 唯一出口） ---------- */

/**
 * 装备模板基础加成的展示投影（#26 三处复算债之一，ADR-017 裁决 9）：
 * flat = round(基础 × 档位倍率)，与实例化/属性聚合同式同源（唯一公式点，
 * UI 展示一律调此函数，禁壳内复制 ×mult 公式）。只返回有效项（value > 0，
 * 键序随 bonuses 原序）；缺档 mult 中性回退 1（ADR-016 兜底路径）。
 */
export function projectGearBase(
  content: GameContent,
  bonuses: GearBonuses,
  rarity: Rarity,
): ReadonlyArray<{ readonly stat: string; readonly value: number }> {
  const mult = findRarity(content, rarity)?.mult ?? 1;
  const out: Array<{ stat: string; value: number }> = [];
  for (const [stat, base] of Object.entries(bonuses)) {
    // 开放键域投影（#021 批 4，N3 消费封死清退）：模板 bonuses 逐键投影，
    // 新增 stat 键 = 纯 JSON 改动（消费点清单见 content.md 注册表）。
    if (typeof base === 'number' && base > 0) out.push({ stat, value: Math.round(base * mult) });
  }
  return out;
}

/**
 * 装备实例的属性投影来源语境（事件流可回放）；倍率按内容档位表折算。
 * #14 起双路径：equip 走基础加成×倍率 + 随机词条；器胚走胚纹（固有词条，
 * 内容原值）+ 铭纹三阶表（tiers[tier]，含 zone/condition 的完整修饰符）。
 * 两路产出都是 Contribution，进 ADR-011 单管线，无第二条直算路径。
 */
export function gearContributions(
  content: GameContent,
  gear: GearInstance,
  bonuses: GearBonuses,
  itemName: string,
): import('./modifiers.js').Contribution[] {
  const out: import('./modifiers.js').Contribution[] = [];
  const displayName = gearName(content, itemName, gear.rarity);
  const gearSource = (id: string, kind: string, name: string): ModifierSource => ({
    id,
    kind,
    uid: gear.uid,
    name,
  });
  const pushFlat = (stat: string, value: number): void => {
    if (!(value > 0)) return;
    out.push({
      modifier: { stat, zone: 'flat', value },
      source: gearSource(gear.itemId, 'equip', displayName),
    });
  };
  // equip 路径：模板基础加成（折算档位倍率）+ 随机词条。
  for (const { stat, value } of projectGearBase(content, bonuses, gear.rarity)) {
    pushFlat(stat, value);
  }
  for (const affix of gear.affixes) {
    if (typeof affix.val === 'number' && affix.val > 0) pushFlat(affix.stat, affix.val);
  }
  // 器胚路径：胚纹（固定非随机，内容原值直入管线）。
  const blank = findBlank(content, gear.itemId);
  for (const modifier of blank?.inherentModifiers ?? []) {
    out.push({ modifier, source: gearSource(gear.itemId, 'equip', displayName) });
  }
  // 器胚路径：铭纹三阶表（tiers[tier] 完整修饰符；来源 kind=inscription）。
  for (const inscription of gear.inscriptions ?? []) {
    const def = findInscription(content, inscription.id);
    const tierRow = def?.tiers[clampTier(inscription.tier) - 1];
    if (!def || !tierRow) continue; // 内容已移除/坏纹阶：贡献静默消失（存档不炸）
    for (const modifier of tierRow) {
      out.push({ modifier, source: gearSource(def.id, 'inscription', def.name) });
    }
  }
  return out;
}
