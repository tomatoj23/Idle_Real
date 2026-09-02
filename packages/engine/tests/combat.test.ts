import { describe, expect, it } from 'vitest';
import {
  calcDmg,
  compareEncounterText,
  extractMoveName,
  hitTierOf,
  isCriticalHp,
  makeAttackText,
  pickText,
  rollCrit,
  summarizeRounds,
  type RoundTally,
} from '../src/index.js';

const rng = (): number => 0.5;

describe('伤害解算', () => {
  it('伤害 = atk×波动×减伤，四舍五入', () => {
    // rng 0.5 → 波动 1.0；def 2 → 减伤 1−2/122
    expect(calcDmg(11, 2, rng)).toBe(Math.round(11 * (1 - 2 / 122)));
  });

  it('防御不产生负伤害，下限 1', () => {
    expect(calcDmg(1, 99999, rng)).toBe(1);
  });

  it('暴击 roll：百分点语义', () => {
    expect(rollCrit(5, () => 0.049)).toBe(true);
    expect(rollCrit(5, () => 0.051)).toBe(false);
    expect(rollCrit(0, rng)).toBe(false);
  });
});

describe('伤害档与危血门控', () => {
  it('伤害档按相对期望伤害分池', () => {
    const expected = 11 * (1 - 2 / 122);
    expect(hitTierOf(expected * 0.9, 11, 2)).toBe('light');
    expect(hitTierOf(expected * 1.0, 11, 2)).toBe('mid');
    expect(hitTierOf(expected * 1.4, 11, 2)).toBe('heavy');
    expect(hitTierOf(expected * 2.0, 11, 2)).toBe('deadly');
  });

  it('危血：剩余 ≤15% 为「危」', () => {
    expect(isCriticalHp(14, 100)).toBe(true);
    expect(isCriticalHp(16, 100)).toBe(false);
    expect(isCriticalHp(0, 0)).toBe(false);
  });
});

describe('通用词库抽取器', () => {
  it('池内随机抽取', () => {
    expect(pickText(['a', 'b', 'c'], () => 0.99)).toBe('c');
    expect(pickText(['a', 'b', 'c'], () => 0.0)).toBe('a');
  });

  it('过滤非法元素，剔完为空返回 undefined', () => {
    expect(pickText(['ok', 42, null, ''], rng)).toBe('ok');
    expect(pickText([1, 2], rng)).toBeUndefined();
    expect(pickText(undefined, rng)).toBeUndefined();
    expect(pickText([], rng)).toBeUndefined();
  });
});

describe('战斗文案', () => {
  const pools = {
    verbs: { fist: [{ v: '击', limbs: ['面门'] }], claw: [{ v: '抓', limbs: ['肩头'] }] },
    moves: { fist: ['搏兔一击'], e1: ['饿虎扑食'] },
    openings: ['你气沉丹田'],
    critIntro: ['你气机鼓荡'],
    cons: {
      hit: {
        light: ['{defender}轻哼，受创{d}点。'],
        heavy: ['{defender}喷血，受创{d}点。'],
      },
      hurt: { light: ['你受创{d}点。'], heavy: ['你喷血，受创{d}点。'] },
    },
    fatal: {
      hit: '{defender}灵光溃散——致命一击受创{d}点！',
      hurt: '你眼前一黑，受创{d}点——要道消身殒！',
    },
  };

  const baseArgs = {
    side: 'player',
    enemyName: '青鬃狼',
    moveKey: 'e1',
    verbStyle: 'claw',
    weaponName: '青锋剑',
    dmg: 12,
    crit: false,
    atk: 11,
    defenderDef: 2,
    defenderHp: 30,
    defenderMaxHp: 60,
  } as const;

  it('出招句带「」招式名 + 受击者主语后果句，{d} 填伤害', () => {
    // dmg 10 / expected 10.82 ≈ 0.92 → light 档（普通句，无起势）
    const text = makeAttackText(pools, { ...baseArgs, dmg: 10 }, rng);
    expect(text).toContain('「饿虎扑食」');
    expect(text).toContain('抓向青鬃狼的肩头');
    expect(text).toContain('青鬃狼轻哼，受创10点。');
    expect(text).not.toContain('你气沉丹田');
  });

  it('未注册招式回退 fist（安全兜底约定）', () => {
    const text = makeAttackText(pools, { ...baseArgs, moveKey: 'nobody' }, rng);
    expect(text).toContain('「搏兔一击」');
  });

  it('重击（heavy）带起势句，濒死（deadly）走会心起势', () => {
    // dmg 14 / expected 10.82 ≈ 1.29 → heavy
    const heavy = makeAttackText(pools, { ...baseArgs, dmg: 14 }, rng);
    expect(heavy).toContain('你气沉丹田');
    // dmg 24 ≈ 2.2 → deadly（critIntro 起势 + ！收尾）
    const deadly = makeAttackText(pools, { ...baseArgs, dmg: 24 }, rng);
    expect(deadly).toContain('你气机鼓荡');
  });

  it('致命一击门控：残血 + 重击才启用 fatal 词库', () => {
    // 残血(≤15%) + 重击
    const fatal = makeAttackText(pools, { ...baseArgs, dmg: 24, defenderHp: 5 }, rng);
    expect(fatal).toContain('灵光溃散');
    // 残血但轻击：不走 fatal
    const light = makeAttackText(pools, { ...baseArgs, dmg: 3, defenderHp: 5 }, rng);
    expect(light).not.toContain('灵光溃散');
    // 重击但血量健康：不走 fatal
    const healthy = makeAttackText(pools, { ...baseArgs, dmg: 24 }, rng);
    expect(healthy).not.toContain('灵光溃散');
  });

  it('玩家挨打侧用 hurt 词库（你为主语）', () => {
    const text = makeAttackText(
      pools,
      { ...baseArgs, side: 'enemy', dmg: 3, defenderHp: 95, defenderMaxHp: 112, verbStyle: 'fist' },
      rng,
    );
    expect(text).toContain('青鬃狼一式');
    expect(text).toContain('你受创3点。');
  });

  it('词库全缺：抽出招式回退且不抛错', () => {
    expect(extractMoveName({}, 'e1', rng)).toBe('搏兔一击');
    expect(extractMoveName({ moves: { fist: ['兜底'] } }, 'e1', rng)).toBe('兜底');
  });
});

describe('战斗摘要与同对手对照', () => {
  it('签名画像由主导伤害档产生', () => {
    const tally: RoundTally = {
      rounds: 11,
      crits: 2,
      tiers: { light: 2, mid: 3, heavy: 4, deadly: 2 },
    };
    const summary = summarizeRounds(tally);
    expect(summary).toContain('11 合');
    expect(summary).toContain('大开大合'); // heavy 主导
    expect(summary).toContain('2 次会心');
  });

  it('对照语：回合数与胜负对照', () => {
    expect(compareEncounterText(undefined, 11)).toBeUndefined();
    expect(compareEncounterText({ rounds: 30, won: true, at: 0 }, 11)).toContain('前番苦战 30 合，今 11 合击倒');
    expect(compareEncounterText({ rounds: 5, won: true, at: 0 }, 11)).toContain('多费周章');
    expect(compareEncounterText({ rounds: 11, won: true, at: 0 }, 11)).toContain('如出一辙');
    expect(compareEncounterText({ rounds: 30, won: false, at: 0 }, 11)).toContain('前番不敌');
  });
});
