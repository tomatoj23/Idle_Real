import { describe, expect, it } from 'vitest';
import {
  aggregateStat,
  aggregateStats,
  conditionMatches,
  type Contribution,
  type ModifierCondition,
  type ModifierSource,
  type ModifierZone,
} from '../src/index.js';

/** 产出方语境工厂：装备实例 / 丹药 buff 两种典型来源。 */
const equip = (uid: number, id = 'sword_iron'): ModifierSource => ({
  id,
  kind: 'equip',
  uid,
  name: '铁剑',
});
const pill: ModifierSource = { id: 'pill_fury', kind: 'pill', name: '狂暴丹' };

const mod = (
  stat: string,
  zone: ModifierZone,
  value: number,
  source: ModifierSource,
  condition?: ModifierCondition,
): Contribution => ({ modifier: { stat, zone, value, ...(condition ? { condition } : {}) }, source });

describe('修饰符聚合管线（ADR-011）', () => {
  it('三区按序结算：flat 先于加法% 先于乘法区', () => {
    const out = aggregateStat('atk', 100, [
      mod('atk', 'flat', 50, equip(1)),
      mod('atk', 'addPct', 20, equip(1)),
      mod('atk', 'mult', 1.5, pill),
    ]);
    // (100 + 50) × (1 + 20/100) × 1.5 = 270
    expect(out.value).toBeCloseTo(270, 10);
    expect(out).toMatchObject({ stat: 'atk', base: 100, flat: 50, addPct: 20, mult: 1.5 });
  });

  it('flat 与 addPct 的先后不可交换（(base+flat)×pct 而非 base×pct+flat）', () => {
    const out = aggregateStat('atk', 100, [
      mod('atk', 'flat', 100, equip(1)),
      mod('atk', 'addPct', 50, equip(1)),
    ]);
    expect(out.value).toBe(300);
  });

  it('乘法区是多乘区连乘，不与加法%合并', () => {
    const out = aggregateStat('atk', 100, [
      mod('atk', 'mult', 1.5, equip(1)),
      mod('atk', 'mult', 1.2, pill),
    ]);
    expect(out.value).toBeCloseTo(180, 10);
    expect(out.mult).toBeCloseTo(1.8, 10);
  });

  it('两产出方同属性叠加与单管线预期一致（无旁路）：装备 flat+加法% 与丹药乘区', () => {
    const contributions = [
      mod('atk', 'flat', 30, equip(1)),
      mod('atk', 'addPct', 10, equip(2)),
      mod('atk', 'mult', 2, pill),
    ];
    const merged = aggregateStat('atk', 100, contributions).value;
    const byHand = (100 + 30) * (1 + 10 / 100) * 2;
    expect(merged).toBeCloseTo(byHand, 10);
  });

  it('addPct 负值生效；聚合总和跌破 −100 时结果钳到 0（引擎兜底，不产出负属性）', () => {
    const weakened = aggregateStat('atk', 100, [mod('atk', 'addPct', -30, pill)]);
    expect(weakened.value).toBeCloseTo(70, 10);

    const shattered = aggregateStat('atk', 100, [
      mod('atk', 'addPct', -80, equip(1)),
      mod('atk', 'addPct', -80, equip(2)),
    ]);
    expect(shattered.value).toBe(0);
  });

  it('无命中贡献时 value=base，applied 为空', () => {
    const out = aggregateStat('atk', 42, []);
    expect(out).toMatchObject({ stat: 'atk', base: 42, flat: 0, addPct: 0, mult: 1, value: 42 });
    expect(out.applied).toEqual([]);
  });

  it('stat 过滤：其它属性的修饰符不进本属性', () => {
    const out = aggregateStat('atk', 100, [
      mod('def', 'flat', 999, equip(1)),
      mod('atk', 'flat', 5, equip(1)),
    ]);
    expect(out.value).toBe(105);
  });

  describe('条件门控（condition）', () => {
    it('element 条件：语境系别命中才生效', () => {
      const contributions = [
        mod('hp', 'flat', 50, equip(1), { element: 'fire' }),
      ];
      expect(aggregateStat('hp', 100, contributions, { element: 'fire' }).value).toBe(150);
      expect(aggregateStat('hp', 100, contributions, { element: 'water' }).value).toBe(100);
      expect(aggregateStat('hp', 100, contributions).value).toBe(100);
    });

    it('moveId 条件：语境招式命中才生效', () => {
      const contributions = [mod('atk', 'mult', 1.5, equip(1), { moveId: 'sword_qixue' })];
      expect(aggregateStat('atk', 100, contributions, { moveId: 'sword_qixue' }).value).toBe(150);
      expect(aggregateStat('atk', 100, contributions, { moveId: 'fist' }).value).toBe(100);
    });

    it('多维度条件为 AND', () => {
      const contributions = [
        mod('atk', 'flat', 30, equip(1), { element: 'thunder', moveId: 'sword_leiting' }),
      ];
      expect(
        aggregateStat('atk', 100, contributions, { element: 'thunder', moveId: 'sword_leiting' }).value,
      ).toBe(130);
      expect(
        aggregateStat('atk', 100, contributions, { element: 'thunder', moveId: 'fist' }).value,
      ).toBe(100);
    });

    it('conditionMatches：只检查声明维度，context 缺维度即不命中', () => {
      expect(conditionMatches({ element: 'fire' }, { element: 'fire' })).toBe(true);
      expect(conditionMatches({ element: 'fire' }, {})).toBe(false);
      expect(conditionMatches({ moveId: 'fist' }, {})).toBe(false);
      expect(conditionMatches({}, { element: 'fire' })).toBe(true);
    });
  });

  it('applied 保留命中贡献的完整语境（来源 id/kind/uid + 命中条件，事件流第一天携带）', () => {
    const out = aggregateStat(
      'atk',
      100,
      [
        mod('atk', 'flat', 20, equip(7, 'sword_qingyun')),
        mod('atk', 'mult', 1.5, pill, { moveId: 'fist' }),
      ],
      { moveId: 'fist' },
    );
    expect(out.applied).toEqual([
      { zone: 'flat', value: 20, source: { id: 'sword_qingyun', kind: 'equip', uid: 7, name: '铁剑' } },
      {
        zone: 'mult',
        value: 1.5,
        source: { id: 'pill_fury', kind: 'pill', name: '狂暴丹' },
        condition: { moveId: 'fist' },
      },
    ]);
  });

  it('非法修饰符运行时兜底：value 非有限数 / 未知 zone / mult ≤ 0 一律忽略', () => {
    const bad = [
      { modifier: { stat: 'atk', zone: 'flat', value: Number.NaN }, source: equip(1) },
      { modifier: { stat: 'atk', zone: 'bogus', value: 10 }, source: equip(1) },
      { modifier: { stat: 'atk', zone: 'mult', value: 0 }, source: equip(1) },
      { modifier: { stat: 'atk', zone: 'mult', value: -2 }, source: equip(1) },
    ] as unknown as Contribution[];
    expect(aggregateStat('atk', 100, bad).value).toBe(100);
  });

  describe('aggregateStats：多属性一次聚合', () => {
    it('按 stat 分桶，未出现在 base 的属性以 0 为基线（倍率类属性基线由调用方给 1）', () => {
      const out = aggregateStats(
        { atk: 100, gatherXp: 1 },
        [
          mod('atk', 'flat', 10, equip(1)),
          mod('crit', 'flat', 25, equip(1)),
          mod('gatherXp', 'mult', 1.5, pill),
        ],
      );
      expect(out.atk?.value).toBe(110);
      expect(out.crit?.value).toBe(25);
      expect(out.gatherXp?.value).toBeCloseTo(1.5, 10);
    });
  });
});
