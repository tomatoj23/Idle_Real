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
import { affixPoolOf, findRarity, raritiesOf, type AffixPoolView } from './contentView.js';

/** 档位 id 开放键域：具体取值由内容包 rarities 节定义，引擎不理解任何具体档位。 */
export type Rarity = string;

/** 已实例化的随机词条。 */
export interface Affix {
  readonly name: string;
  readonly stat: string;
  readonly val: number;
}

/** 装备实例：uid 全局唯一，随档持久化。 */
export interface GearInstance {
  readonly uid: number;
  /** 内容包物品 id（type=equip）。 */
  readonly itemId: string;
  readonly rarity: Rarity;
  readonly affixes: readonly Affix[];
}

/** 装备模板加成形状（与 content 包 Item.bonuses 同形，接口无索引签名可直接传）。 */
export interface GearBonuses {
  readonly atk?: number;
  readonly def?: number;
  readonly hp?: number;
  readonly crit?: number;
}

/* ---------- 掷点（随机源一律注入，ADR-013） ---------- */

/**
 * 稀有度掷点（参数化机制，ADR-016 判例）：权重表由内容包 rarities 节提供，
 * 按权重占比归一化掷档（权重无需配成 1）；"炼器等级抬稀有度"的外部加权
 * 输入位（旧版 js/game.js:84-95）留待 #5/#14 扩展本函数签名接入。
 * 空表/无正权重返回空串：缺内容降级，一切档位解析方按中性值兜底。
 */
export function rollRarity(content: GameContent, random: () => number): Rarity {
  const table = raritiesOf(content).filter((def) => def.weight > 0);
  const total = table.reduce((sum, def) => sum + def.weight, 0);
  if (!(total > 0)) return '';
  let roll = random() * total;
  for (const def of table) {
    roll -= def.weight;
    if (roll < 0) return def.id;
  }
  const last = table[table.length - 1];
  return last ? last.id : '';
}

/** 基础加成的量级标尺（旧版：攻/防/血÷5/暴×0.8 的最大者，兜底 3）。 */
function baseScaleOf(bonuses: GearBonuses): number {
  return Math.max(bonuses.atk ?? 0, bonuses.def ?? 0, (bonuses.hp ?? 0) / 5, (bonuses.crit ?? 0) * 0.8, 3);
}

/**
 * 词条数值：max(1, round(基础标尺 × scale × 波动))。量级系数（scale）来自
 * 内容词条池；±20% 波动与基础标尺暂属引擎机制参数（批 3 参数数据化）。
 */
function rollAffixVal(baseScale: number, entry: AffixPoolView, random: () => number): number {
  return Math.max(1, Math.round(baseScale * entry.scale * (0.8 + random() * 0.4)));
}

/**
 * 生成装备实例：roll 稀有度（或调用方指定）→ 按稀有度词条数从内容词条池
 * 掷不重复 stat 词条。uid 由调用方（game 状态机）分配并写入 gearSeq。
 */
export function makeGear(
  content: GameContent,
  itemId: string,
  bonuses: GearBonuses,
  uid: number,
  random: () => number,
  rarity: Rarity = rollRarity(content, random),
): GearInstance {
  const affixCount = findRarity(content, rarity)?.affix ?? 0;
  const scale = baseScaleOf(bonuses);
  const affixes: Affix[] = [];
  if (affixCount > 0) {
    const pool = affixPoolOf(content);
    const used = new Set<string>();
    let guard = 0;
    while (affixes.length < affixCount && guard++ < 20) {
      const entry = pool[Math.floor(random() * pool.length) % pool.length];
      if (!entry || used.has(entry.stat)) continue;
      used.add(entry.stat);
      affixes.push({ name: entry.name, stat: entry.stat, val: rollAffixVal(scale, entry, random) });
    }
  }
  return { uid, itemId, rarity, affixes };
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

/** 装备实例的属性投影来源语境（事件流可回放）；倍率按内容档位表折算。 */
export function gearContributions(
  content: GameContent,
  gear: GearInstance,
  bonuses: GearBonuses,
  itemName: string,
): import('./modifiers.js').Contribution[] {
  const mult = findRarity(content, gear.rarity)?.mult ?? 1;
  const out: import('./modifiers.js').Contribution[] = [];
  const push = (stat: string, value: number): void => {
    if (!(value > 0)) return;
    out.push({
      modifier: { stat, zone: 'flat', value },
      source: { id: gear.itemId, kind: 'equip', uid: gear.uid, name: gearName(content, itemName, gear.rarity) },
    });
  };
  for (const stat of ['atk', 'def', 'hp', 'crit'] as const) {
    const base = bonuses[stat];
    if (typeof base === 'number' && base > 0) push(stat, Math.round(base * mult));
  }
  for (const affix of gear.affixes) {
    if (typeof affix.val === 'number' && affix.val > 0) push(affix.stat, affix.val);
  }
  return out;
}
