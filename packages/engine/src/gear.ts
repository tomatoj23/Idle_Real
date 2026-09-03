/**
 * 装备实例机制（issue #4）。
 *
 * 稀有度掷点/词条实例化是运行时机制（引擎机制侧）；但档位表、词条池、
 * 概率与量级系数是玩法参数，按 ADR-016 归 content 包——本文件中的
 * RARITIES/AFFIX_POOL 等常量属待清偿违规（批 1 / 票 #018 数据化）。
 * 装备实例以 uid 常驻状态（GameState.gear），槽位只存 uid。
 *
 * ADR-011 纪律：装备对属性的贡献一律投影为 Modifier 贡献走统一聚合管线
 * （#13），本模块不直接算玩家属性。稀有度倍率在实例化投影时折算进 flat
 * 值（round(基础 × 倍率)，沿用旧版 gearStats 基线）——装备产出方只有
 * flat 一种区，不存在第二条直算路径。
 */

/** 装备稀有度：寻常 / 精良 / 罕见 / 绝世（旧版基线）。 */
export type Rarity = 'common' | 'fine' | 'rare' | 'epic';

export interface RarityDef {
  readonly name: string;
  /** 基础加成倍率。 */
  readonly mult: number;
  /** 随机词条数。 */
  readonly affix: number;
  /** 卖价倍率。 */
  readonly sell: number;
}

export const RARITIES: Readonly<Record<Rarity, RarityDef>> = {
  common: { name: '寻常', mult: 1.0, affix: 0, sell: 1 },
  fine: { name: '精良', mult: 1.15, affix: 1, sell: 2 },
  rare: { name: '罕见', mult: 1.3, affix: 2, sell: 4 },
  epic: { name: '绝世', mult: 1.5, affix: 3, sell: 10 },
};

export const RARITY_ORDER: readonly Rarity[] = ['common', 'fine', 'rare', 'epic'];

/** 随机词条池：name 词条名，stat 对应攻/防/血/暴（crit 为百分点）。 */
export interface AffixDef {
  readonly name: string;
  readonly stat: string;
}

export const AFFIX_POOL: readonly AffixDef[] = [
  { name: '锐锋', stat: 'atk' },
  { name: '罡气', stat: 'def' },
  { name: '浑厚', stat: 'hp' },
  { name: '通明', stat: 'crit' },
];

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

/** 稀有度 roll：寻常 70% / 精良 20% / 罕见 8% / 绝世 2%。 */
export function rollRarity(random: () => number): Rarity {
  const r = random();
  return r < 0.02 ? 'epic' : r < 0.1 ? 'rare' : r < 0.3 ? 'fine' : 'common';
}

/** 词条量级随装备档次缩放（旧版 affixVal 基线）。 */
function rollAffixVal(baseScale: number, stat: string, random: () => number): number {
  const k: Readonly<Record<string, number>> = { atk: 0.3, def: 0.3, hp: 1.5, crit: 0.25 };
  const factor = k[stat] ?? 0.3;
  return Math.max(1, Math.round(baseScale * factor * (0.8 + random() * 0.4)));
}

/** 基础加成的量级标尺（旧版：攻/防/血÷5/暴×0.8 的最大者，兜底 3）。 */
function baseScaleOf(bonuses: GearBonuses): number {
  return Math.max(bonuses.atk ?? 0, bonuses.def ?? 0, (bonuses.hp ?? 0) / 5, (bonuses.crit ?? 0) * 0.8, 3);
}

/**
 * 生成装备实例：roll 稀有度 → 按稀有度词条数掷不重复 stat 词条。
 * uid 由调用方（game 状态机）分配并写入 gearSeq。
 */
export function makeGear(
  itemId: string,
  bonuses: GearBonuses,
  uid: number,
  random: () => number,
  rarity: Rarity = rollRarity(random),
): GearInstance {
  const def = RARITIES[rarity] ?? RARITIES.common;
  const scale = baseScaleOf(bonuses);
  const affixes: Affix[] = [];
  if (def.affix > 0) {
    const used = new Set<string>();
    let guard = 0;
    while (affixes.length < def.affix && guard++ < 20) {
      const pool = AFFIX_POOL[Math.floor(random() * AFFIX_POOL.length) % AFFIX_POOL.length];
      if (!pool || used.has(pool.stat)) continue;
      used.add(pool.stat);
      affixes.push({ name: pool.name, stat: pool.stat, val: rollAffixVal(scale, pool.stat, random) });
    }
  }
  return { uid, itemId, rarity, affixes };
}

/* ---------- 展示与价值 ---------- */

export function gearName(itemName: string, rarity: Rarity): string {
  return `${(RARITIES[rarity] ?? RARITIES.common).name}·${itemName}`;
}

export function gearSell(itemSell: number, rarity: Rarity): number {
  return Math.max(1, Math.round(itemSell * (RARITIES[rarity] ?? RARITIES.common).sell));
}

/* ---------- 修饰符贡献投影（ADR-011 唯一出口） ---------- */

/** 装备实例的属性投影来源语境（事件流可回放）。 */
export function gearContributions(
  gear: GearInstance,
  bonuses: GearBonuses,
  itemName: string,
): import('./modifiers.js').Contribution[] {
  const mult = (RARITIES[gear.rarity] ?? RARITIES.common).mult;
  const out: import('./modifiers.js').Contribution[] = [];
  const push = (stat: string, value: number): void => {
    if (!(value > 0)) return;
    out.push({
      modifier: { stat, zone: 'flat', value },
      source: { id: gear.itemId, kind: 'equip', uid: gear.uid, name: gearName(itemName, gear.rarity) },
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
