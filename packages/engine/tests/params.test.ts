import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  BASE_AFFIX_PARAMS,
  BASE_COMBAT_PARAMS,
  BASE_PROGRESSION,
  affixParamsOf,
  combatParamsOf,
  createGame,
  enemyGateOf,
  expBase,
  expToNext,
  hitTierOf,
  isCriticalHp,
  calcDmg,
  levelFromXp,
  makeGear,
  maxHpForLevel,
  progressionParamsOf,
  type DamageMechanics,
  type GameContent,
  type GameState,
  type ProgressionParams,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #020 批 3 验收：战斗/成长/词条参数数据化（ADR-016 裁决 ① 分策：
 * 数值参数引擎内置基线 + config 覆盖）。
 *
 * 断言三件事：① 缺省 = 引擎基线（历史行为逐点不变）；② config 同名
 * 字段覆盖、非法值逐字段回落；③ 改参数 = 纯 JSON 改动（铁律检验法）。
 */

describe('#020 · 参数视图（config 覆盖引擎基线）', () => {
  it('无 config 子节 → 全部回落引擎基线', () => {
    const pack = {} as GameContent;
    expect(combatParamsOf(pack)).toEqual(BASE_COMBAT_PARAMS);
    expect(progressionParamsOf(pack)).toEqual(BASE_PROGRESSION);
    expect(affixParamsOf(pack)).toEqual(BASE_AFFIX_PARAMS);
  });

  it('config 子节同名字段覆盖；非法值逐字段回落基线', () => {
    const pack = {
      config: {
        combat: { statAtkBase: 20, critCap: 'bogus', playerAttackInterval: 900 },
        progression: { hpBase: 200, xpExponent: Number.NaN },
        affix: { variance: 0 },
      },
    } as unknown as GameContent;
    const cparams = combatParamsOf(pack);
    expect(cparams.statAtkBase).toBe(20);
    expect(cparams.playerAttackInterval).toBe(900);
    expect(cparams.critCap).toBe(BASE_COMBAT_PARAMS.critCap); // 非数值回落
    expect(cparams.defenseK).toBe(BASE_COMBAT_PARAMS.defenseK); // 未写字段保持基线
    const pparams = progressionParamsOf(pack);
    expect(pparams.hpBase).toBe(200);
    expect(pparams.xpExponent).toBe(BASE_PROGRESSION.xpExponent); // NaN 回落
    expect(affixParamsOf(pack).variance).toBe(0);
  });

  it('子节整体畸形（数组/原始值）= 全基线，不崩', () => {
    const pack = {
      config: { combat: [1, 2], progression: 'bogus', affix: 42 },
    } as unknown as GameContent;
    expect(combatParamsOf(pack)).toEqual(BASE_COMBAT_PARAMS);
    expect(progressionParamsOf(pack)).toEqual(BASE_PROGRESSION);
    expect(affixParamsOf(pack)).toEqual(BASE_AFFIX_PARAMS);
  });
});

describe('#020 · 伤害解算机制参数化', () => {
  const rng = (): number => 0.5;
  const flat: DamageMechanics = {
    defenseK: 120,
    damageVariance: 0,
    tierLightMax: 0.5,
    tierMidMax: 1,
    tierHeavyMax: 2,
    criticalHpFraction: 0.5,
  };

  it('calcDmg：variance 0 无波动；defenseK 自定义减伤', () => {
    expect(calcDmg(10, 0, rng, flat)).toBe(10);
    expect(calcDmg(10, 10, rng, { ...flat, defenseK: 30 })).toBe(8); // 1 − 10/40
  });

  it('hitTierOf：自定义阈值分档（def 0 → 期望 = atk）', () => {
    expect(hitTierOf(4, 10, 0, flat)).toBe('light');
    expect(hitTierOf(6, 10, 0, flat)).toBe('mid');
    expect(hitTierOf(12, 10, 0, flat)).toBe('heavy');
    expect(hitTierOf(30, 10, 0, flat)).toBe('deadly');
  });

  it('isCriticalHp：自定义危血线', () => {
    expect(isCriticalHp(40, 100, flat)).toBe(true);
    expect(isCriticalHp(60, 100, flat)).toBe(false);
  });

  it('缺省机制参数 = 引擎基线（历史行为不变）', () => {
    const expected = 11 * (1 - 2 / 122);
    expect(hitTierOf(expected * 1.4, 11, 2)).toBe('heavy');
    expect(isCriticalHp(14, 100)).toBe(true);
    expect(isCriticalHp(16, 100)).toBe(false);
  });
});

describe('#020 · 修为曲线参数化', () => {
  const fast: ProgressionParams = {
    ...BASE_PROGRESSION,
    xpPowCoef: 100,
    maxLevel: 5,
    hpBase: 50,
    hpPerLevel: 3,
    hpRegenPerSec: 0.1,
  };

  it('自定义曲线：升层需求、封顶、经验条起点随 config 变化', () => {
    expect(expToNext(1, fast)).toBe(115); // floor(100·1^1.8 + 15·1)
    expect(levelFromXp(114, fast)).toBe(1);
    expect(levelFromXp(115, fast)).toBe(2);
    expect(levelFromXp(Number.MAX_SAFE_INTEGER, fast)).toBe(5);
    expect(expToNext(5, fast)).toBe(Number.POSITIVE_INFINITY);
    expect(expBase(3, fast)).toBe(expToNext(1, fast) + expToNext(2, fast));
  });

  it('自定义气血曲线：hp = hpBase + hpPerLevel × 层', () => {
    expect(maxHpForLevel(2, fast)).toBe(56);
  });

  it('缺省基线与历史数值逐点一致', () => {
    expect(levelFromXp(24)).toBe(1);
    expect(levelFromXp(25)).toBe(2);
    expect(levelFromXp(88)).toBe(2);
    expect(levelFromXp(89)).toBe(3);
    expect(expToNext(1)).toBe(25);
    expect(expToNext(3)).toBe(117);
    expect(expBase(3)).toBe(89);
    expect(levelFromXp(Number.MAX_SAFE_INTEGER)).toBe(99);
  });
});

describe('#020 · 装备词条机制参数（config.affix）', () => {
  const gearPack = {
    items: [
      { id: 'sword', name: '青锋剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 10, bonuses: { hp: 10, crit: 10 } },
    ],
    rarities: [{ id: 'only', name: '唯一', weight: 1, mult: 1, affix: 1, sell: 1 }],
    affixPool: [{ name: '浑厚', stat: 'hp', scale: 1 }],
  } as unknown as GameContent;

  it('hpDivider/critScale/variance 全部生效：改 JSON → 词条值变', () => {
    const affix = { hpDivider: 1, critScale: 0, baseScaleFloor: 0, variance: 0 };
    // 标尺 = max(0, 0, hp 10/1, crit 10×0, 0) = 10 → val = round(10×1×1) = 10
    const gear = makeGear(gearPack, 'sword', { hp: 10, crit: 10 }, 1, () => 0.5, 'only', affix);
    expect(gear.affixes).toEqual([{ name: '浑厚', stat: 'hp', val: 10 }]);
  });

  it('缺省基线：标尺 max(hp÷5, crit×0.8, 兜底 3) = 8，±20% 波动', () => {
    // rng 0.5 → 乘数 0.8 + 0.5×0.4 = 1.0 → val = round(8×1) = 8
    const gear = makeGear(gearPack, 'sword', { hp: 10, crit: 10 }, 1, () => 0.5, 'only');
    expect(gear.affixes[0]?.val).toBe(8);
  });

  it('使用点防崩：divider ≤ 0（未过包校验的包）回落基线 divider，不产生 Infinity', () => {
    const broken = { hpDivider: 0, critScale: 0, baseScaleFloor: 3, variance: 0 };
    const gear = makeGear(gearPack, 'sword', { hp: 10, crit: 10 }, 1, () => 0.5, 'only', broken);
    // 标尺 = max(0, 0, 10/5（防崩回落）, 0, 3) = 3 → val = 3；无防崩则为 Infinity
    expect(gear.affixes[0]?.val).toBe(3);
  });
});

describe('#020 · createGame 读 config 参数（纯 JSON 改动）', () => {
  it('属性基线/暴击上限/气血曲线随 config 变化（snapshot.stats 单一来源）', () => {
    const pack = {
      ...makeCombatPack(),
      config: {
        combat: { statAtkBase: 20, statCritBase: 50, critCap: 55 },
        progression: { hpBase: 200 },
      },
    } as unknown as GameContent;
    const game = createGame({
      content: pack,
      clock: new ManualClock(),
      contributions: [{ modifier: { stat: 'crit', zone: 'flat', value: 10 }, source: { id: 't', kind: 'test' } }],
    });
    const stats = game.snapshot().stats;
    // 斗法 1 层：atk = 20 + 1×3（perLevel 未写回落基线）；maxHp = 200 + 12×1
    expect(stats?.atk).toBe(23);
    expect(stats?.maxHp).toBe(212);
    // crit 50 + 贡献 10 = 60 → 钳到 config 上限 55
    expect(stats?.crit).toBe(55);
  });

  it('开战门控偏移随 config：enemyGateOf 与引擎判定同源，{level} 槽联动', () => {
    const pack = {
      ...makeCombatPack(),
      config: { combat: { levelGateOffset: 0 } },
    } as unknown as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock() });
    const st = game.snapshot().state as unknown as GameState;
    // clv 1 + 偏移 0 = 1 < 敌 3 层 → 锁定；展示需层数 = 3 − 0
    expect(enemyGateOf(pack, st.skills, 'e3')).toEqual({ locked: true, requiredLevel: 3 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e3' } });
    const rejected = game.events.drain().find((event) => event.type === 'reject');
    expect(rejected?.data?.reason).toBe('level');
    expect(String(rejected?.data?.message)).toContain('需 3 层');
  });

  it('基线偏移（+2）行为不变：3 层敌在 clv1 可战', () => {
    const pack = makeCombatPack();
    const game = createGame({ content: pack, clock: new ManualClock() });
    const st = game.snapshot().state as unknown as GameState;
    expect(enemyGateOf(pack, st.skills, 'e3')).toEqual({ locked: false, requiredLevel: 1 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e3' } });
    expect(game.events.drain().some((event) => event.type === 'combat-note')).toBe(true);
  });

  it('autoFight/autoEat 缺省随 config（新档与存档未写字段两落点）', () => {
    const pack = {
      ...makeCombatPack(),
      config: { combat: { autoFight: false, autoEat: false } },
    } as unknown as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock() });
    expect((game.snapshot().state as unknown as GameState).autoFight).toBe(false);
    expect((game.snapshot().state as unknown as GameState).autoEat).toBe(false);
    // 存档未写 autoFight/autoEat → 恢复时回落 config 缺省（不再写死 true）
    const restored = createGame({
      content: pack,
      clock: new ManualClock(),
      save: { version: 1, time: 0, state: { gp: 1 } },
    });
    expect((restored.snapshot().state as unknown as GameState).autoFight).toBe(false);
    expect((restored.snapshot().state as unknown as GameState).autoEat).toBe(false);
  });

  it('铁律检验法：同一引擎，改 JSON 参数 → 行为随之变（引擎零改动）', () => {
    const base = makeCombatPack();
    const tuned = {
      ...makeCombatPack(),
      config: { combat: { playerAttackInterval: 500 } },
    } as unknown as GameContent;
    const a = createGame({ content: base, clock: new ManualClock(), seed: 42 });
    const b = createGame({ content: tuned, clock: new ManualClock(), seed: 42 });
    a.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    b.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    a.tick(3000);
    b.tick(3000);
    // 间隔 2200 → 3s 内 1 次出招；间隔 500 → 6 次
    const hitsOf = (g: ReturnType<typeof createGame>): number =>
      g.events.drain().filter((event) => event.type === 'attack' && event.data?.side === 'player').length;
    expect(hitsOf(b)).toBeGreaterThan(hitsOf(a));
  });
});
