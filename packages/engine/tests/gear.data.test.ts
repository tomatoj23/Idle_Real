import { describe, expect, it } from 'vitest';
import {
  createRng,
  gearContributions,
  gearName,
  gearSell,
  makeGear,
  restoreState,
  rollRarity,
  type GameContent,
} from '../src/index.js';

/**
 * #018 批 1 验收：稀有度/词条池词表数据化（ADR-016 裁决 ①）。
 * 引擎零默认表——档名/概率/倍率/词条数/卖价/量级系数全部读内容表；
 * 缺档回退第一档（安全兜底路径）；换表 = 纯 JSON 改动（铁律检验法）。
 *
 * 夹具刻意使用与修仙包不同的 id 与词（粗坯/上品、锋锐/厚重），
 * 证明引擎不感知任何具体词表。
 */

interface PackOverrides {
  readonly rarities?: unknown;
  readonly affixPool?: unknown;
}

/** 词表夹具包：items 供 restoreState 校验 equip 物品。 */
function makePack(overrides: PackOverrides = {}): GameContent {
  return {
    items: [
      { id: 'sword', name: '青锋剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 10, bonuses: { atk: 5 } },
    ],
    rarities: [
      { id: 'rough', name: '粗坯', weight: 70, mult: 1, affix: 0, sell: 1 },
      { id: 'polished', name: '上品', weight: 20, mult: 1.3, affix: 1, sell: 2 },
      { id: 'refined', name: '精淬', weight: 10, mult: 2, affix: 2, sell: 4, showcase: true },
    ],
    affixPool: [
      { name: '锋锐', stat: 'atk', scale: 0.5 },
      { name: '厚重', stat: 'hp', scale: 2 },
    ],
    ...overrides,
  } as GameContent;
}

describe('#018 · rollRarity 按内容权重占比归一化掷档', () => {
  it('70/20/10 权重：random 0.69 → 粗坯，0.70~0.89 → 上品，≥0.90 → 精淬', () => {
    const pack = makePack();
    expect(rollRarity(pack, () => 0.69)).toBe('rough');
    expect(rollRarity(pack, () => 0.70)).toBe('polished');
    expect(rollRarity(pack, () => 0.89)).toBe('polished');
    expect(rollRarity(pack, () => 0.90)).toBe('refined');
    expect(rollRarity(pack, () => 0.999)).toBe('refined');
  });

  it('权重绝对值无关，只看占比（9:1 与 0.9:0.1 同分布）', () => {
    const big = makePack({ rarities: [{ id: 'a', weight: 9, mult: 1, affix: 0, sell: 1 }, { id: 'b', weight: 1, mult: 1, affix: 0, sell: 1 }] });
    const small = makePack({ rarities: [{ id: 'a', weight: 0.9, mult: 1, affix: 0, sell: 1 }, { id: 'b', weight: 0.1, mult: 1, affix: 0, sell: 1 }] });
    expect(rollRarity(big, () => 0.89)).toBe('a');
    expect(rollRarity(big, () => 0.90)).toBe('b');
    expect(rollRarity(small, () => 0.89)).toBe('a');
    expect(rollRarity(small, () => 0.90)).toBe('b');
  });

  it('种子化 RNG 两万次：分布贴合权重（±2%）', () => {
    const pack = makePack();
    const rng = createRng(42);
    const counts: Record<string, number> = { rough: 0, polished: 0, refined: 0 };
    const N = 20_000;
    for (let i = 0; i < N; i++) counts[rollRarity(pack, () => rng.next())] += 1;
    expect(counts.rough / N).toBeGreaterThan(0.68);
    expect(counts.rough / N).toBeLessThan(0.72);
    expect(counts.polished / N).toBeGreaterThan(0.18);
    expect(counts.polished / N).toBeLessThan(0.22);
    expect(counts.refined / N).toBeGreaterThan(0.08);
    expect(counts.refined / N).toBeLessThan(0.12);
  });

  it('空表 / 无正权重 → 空串（缺内容降级）', () => {
    expect(rollRarity(makePack({ rarities: [] }), () => 0.5)).toBe('');
    expect(rollRarity(makePack({ rarities: [{ id: 'x', weight: 0, mult: 1, affix: 0, sell: 1 }] }), () => 0.5)).toBe('');
  });
});

describe('#018 · makeGear/gearName/gearSell/gearContributions 读内容表', () => {
  it('词条量级系数（scale）来自内容池', () => {
    const pack = makePack();
    // random 恒 0.25：池内 index = floor(0.25*2)=0 → 锋锐(atk)；val = round(10*0.5*(0.8+0.25*0.4)) = 5
    const gear = makeGear(pack, 'sword', { atk: 10 }, 1, () => 0.25, 'refined');
    expect(gear.rarity).toBe('refined');
    expect(gear.affixes).toEqual([{ name: '锋锐', stat: 'atk', val: 5 }]);
  });

  it('未指定稀有度时由内容权重掷档（无默认表介入）', () => {
    const pack = makePack({ rarities: [{ id: 'only', name: '唯一', weight: 5, mult: 1, affix: 0, sell: 1 }] });
    const gear = makeGear(pack, 'sword', { atk: 5 }, 7, () => 0.5);
    expect(gear.rarity).toBe('only');
  });

  it('缺档回退第一档：makeGear/gearName/gearSell/gearContributions 同律', () => {
    const pack = makePack();
    // 'bogus' 未命中 → 回退 rough（第一档）：零词条、mult 1、卖价倍率 1
    const gear = makeGear(pack, 'sword', { atk: 10 }, 1, () => 0.5, 'bogus');
    expect(gear.affixes).toEqual([]);
    expect(gearName(pack, '青锋剑', 'bogus')).toBe('粗坯·青锋剑');
    expect(gearSell(pack, 10, 'bogus')).toBe(10);
    expect(gearContributions(pack, gear, { atk: 10 }, '青锋剑')).toEqual([
      { modifier: { stat: 'atk', zone: 'flat', value: 10 }, source: { id: 'sword', kind: 'equip', uid: 1, name: '粗坯·青锋剑' } },
    ]);
    // 命中 refined：mult 2 → round(10*2)=20；卖价 round(10*4)=40
    const rich = makeGear(pack, 'sword', { atk: 10 }, 2, () => 0.5, 'refined');
    expect(gearContributions(pack, rich, { atk: 10 }, '青锋剑')[0]?.modifier.value).toBe(20);
    expect(gearSell(pack, 10, 'refined')).toBe(40);
  });

  it('空表中性降级：mult/sell 取 1、零词条、展示名省略前缀', () => {
    const pack = makePack({ rarities: [], affixPool: [] });
    expect(gearName(pack, '青锋剑', 'anything')).toBe('青锋剑');
    expect(gearSell(pack, 10, 'anything')).toBe(10);
    const gear = makeGear(pack, 'sword', { atk: 10 }, 1, () => 0.5, 'anything');
    expect(gear.affixes).toEqual([]);
    expect(gearContributions(pack, gear, { atk: 10 }, '青锋剑')[0]?.modifier.value).toBe(10);
  });

  it('铁律检验法：改倍率 = 纯 JSON 改动（引擎零改动）', () => {
    const base = { atk: 10 };
    const packA = makePack({ rarities: [{ id: 'rare', weight: 1, mult: 1.3, affix: 0, sell: 1 }] });
    const packB = makePack({ rarities: [{ id: 'rare', weight: 1, mult: 2.5, affix: 0, sell: 1 }] });
    const gearA = makeGear(packA, 'sword', base, 1, () => 0.5, 'rare');
    const gearB = makeGear(packB, 'sword', base, 1, () => 0.5, 'rare');
    expect(gearContributions(packA, gearA, base, '剑')[0]?.modifier.value).toBe(13);
    expect(gearContributions(packB, gearB, base, '剑')[0]?.modifier.value).toBe(25);
  });
});

describe('#018 · 存档规范化解引用内容档位表', () => {
  it('坏键回退第一档；合法键原样保留', () => {
    const pack = makePack();
    const save = {
      version: 1 as const,
      time: 0,
      state: {
        gear: [
          { uid: 1, itemId: 'sword', rarity: 'ghost', affixes: [] },
          { uid: 2, itemId: 'sword', rarity: 'refined', affixes: [{ name: '锋锐', stat: 'atk', val: 3 }] },
        ],
      },
    };
    const state = restoreState(pack, save, 1);
    expect(state.gear[0]?.rarity).toBe('rough');
    expect(state.gear[1]?.rarity).toBe('refined');
    expect(state.gearSeq).toBe(2);
  });

  it('词表整体缺失时坏档降级为空串（不崩溃，中性数值）', () => {
    const pack = makePack({ rarities: [] });
    const save = {
      version: 1 as const,
      time: 0,
      state: { gear: [{ uid: 1, itemId: 'sword', rarity: 'ghost', affixes: [] }] },
    };
    const state = restoreState(pack, save, 1);
    expect(state.gear[0]?.rarity).toBe('');
  });
});
