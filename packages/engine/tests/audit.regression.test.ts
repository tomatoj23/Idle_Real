import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  createGame,
  type Contribution,
  type GameContent,
  type GameState,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * 2026-09-14 全维度自查回归批：离线/在线修为口径（xpMult 每循环舍入）、
 * 离线入口防御（NaN/Infinity）、战斗中离线回满、秘境拒绝路径零副作用、
 * 消耗品/上限/时钟运行时兜底、#55 buff 时钟语义裁决钉（离线不消耗时长）。
 * 每例先钉修复前可观察的错误行为，再钉修复后
 * 的正确行为——回归时红 = 口径或防御被回退。
 */

function stateOf(save: SaveData): GameState {
  return save.state as unknown as GameState;
}

const xpMultContribs = (value: number): Contribution[] => [
  {
    modifier: { stat: 'xpMult', zone: 'mult', value },
    source: { id: 'audit', kind: 'test', name: '自查' },
  },
];

describe('自查 · buff 时钟语义（#55 ADR-013 裁决钉）', () => {
  it('离线不消耗 buff 时长、不推进 time（到期清理只随在线 tick）', () => {
    const clock = new ManualClock();
    const seedGame = createGame({ content: makeCombatPack(), clock, rng: () => 0.9 });
    seedGame.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    const base = seedGame.snapshot();
    const game = createGame({
      content: makeCombatPack(),
      clock,
      rng: () => 0.9,
      save: {
        ...base,
        state: {
          ...(base.state as Record<string, unknown>),
          buffs: { consumable_atk: 600000 } as Record<string, number>,
        },
      } as SaveData,
    });
    const before = game.snapshot();
    game.settleOffline(60000); // ≥60s（OFFLINE_MIN_MS 门槛）
    const after = game.snapshot();
    expect(stateOf(after).buffs).toEqual({ consumable_atk: 600000 }); // 剩余时长原样：离线不流逝
    expect(after.time).toBe(before.time); // time 只随 tick 推进
  });
});

describe('自查 · 修为口径：xpMult 每循环舍入（在线/离线恒等）', () => {
  const pack = {
    skills: [
      {
        id: 'herb',
        name: '采药',
        icon: '药',
        kind: 'gather',
        activities: [
          { name: '采灵砂', unlockLevel: 1, interval: 3000, exp: 10, output: { item: 'ore', count: 1 } },
        ],
      },
    ],
    items: [{ id: 'ore', name: '灵砂', icon: '砂', type: 'mat', sell: 2 }],
  } as unknown as GameContent;

  it('gather：xpMult=1.15 时在线 20 轮 = 240（round(11.5)×20），离线同值（旧整批口径 230 分叉）', () => {
    const run = (offline: boolean) => {
      const clock = new ManualClock();
      const game = createGame({ content: pack, clock, rng: () => 0.9, contributions: xpMultContribs(1.15) });
      game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
      game.events.drain();
      if (offline) game.settleOffline(60000);
      else
        for (let i = 0; i < 20; i++) {
          clock.advance(3000);
          game.tick(3000);
        }
      return stateOf(game.snapshot()).skills.herb?.xp ?? 0;
    };
    expect(run(false)).toBe(240); // round(11.5)×20
    expect(run(true)).toBe(run(false));
  });

  it('craft 全成：xpMult=1.15 时在线/离线 = 240（单轮实发 round(11.5)=12 聚合 ×20 轮）', () => {
    const pack = {
      skills: [{ id: 'smith', name: '炼器', icon: '器', kind: 'craft' }],
      items: [
        { id: 'mat1', name: '凡铁', icon: '铁', type: 'mat', sell: 5 },
        { id: 'pill1', name: '散灵丹', icon: '丹', type: 'consumable', sell: 9, heal: { percent: 0.1 } },
      ],
      recipes: [
        {
          name: '炼丹',
          skill: 'smith',
          unlockLevel: 1,
          output: { item: 'pill1', count: 1 },
          materials: { mat1: 1 },
          successRate: 1,
          interval: 3000,
          exp: 10,
        },
      ],
    } as unknown as GameContent;
    const materialSave = { version: 1, time: 0, state: { items: { mat1: 50 } } } as unknown as SaveData;
    const run = (offline: boolean) => {
      const clock = new ManualClock();
      const game = createGame({
        content: pack,
        clock,
        rng: () => 0,
        save: materialSave,
        contributions: xpMultContribs(1.15),
      });
      game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 0 } });
      game.events.drain();
      if (offline) game.settleOffline(60000);
      else
        for (let i = 0; i < 20; i++) {
          clock.advance(3000);
          game.tick(3000);
        }
      return stateOf(game.snapshot()).skills.smith?.xp ?? 0;
    };
    expect(run(false)).toBe(240); // round(11.5)×20
    expect(run(true)).toBe(run(false));
  });

  it('craft 全败：失败返还按单轮 round(exp×refund)=3 聚合 = 60（3×20；旧整批口径 round(50)=50 分叉）', () => {
    const pack = {
      skills: [{ id: 'smith', name: '炼器', icon: '器', kind: 'craft' }],
      items: [
        { id: 'mat1', name: '凡铁', icon: '铁', type: 'mat', sell: 5 },
        { id: 'pill1', name: '散灵丹', icon: '丹', type: 'consumable', sell: 9, heal: { percent: 0.1 } },
      ],
      recipes: [
        {
          name: '炼丹',
          skill: 'smith',
          unlockLevel: 1,
          output: { item: 'pill1', count: 1 },
          materials: { mat1: 1 },
          successRate: 0,
          interval: 3000,
          exp: 10,
        },
      ],
    } as unknown as GameContent;
    const materialSave = { version: 1, time: 0, state: { items: { mat1: 50 } } } as unknown as SaveData;
    const run = (offline: boolean) => {
      const clock = new ManualClock();
      const game = createGame({ content: pack, clock, rng: () => 0.9, save: materialSave });
      game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 0 } });
      game.events.drain();
      if (offline) game.settleOffline(60000);
      else
        for (let i = 0; i < 20; i++) {
          clock.advance(3000);
          game.tick(3000);
        }
      return stateOf(game.snapshot()).skills.smith?.xp ?? 0;
    };
    expect(run(false)).toBe(60); // 每轮失败返还 round(2.5)×xpMult=3 ×20
    expect(run(true)).toBe(run(false));
  });
});

describe('自查 · 离线入口与恢复防御', () => {
  it('settleOffline(NaN/Infinity)：活动与物品零污染（旧口径 progress 变 NaN 活动卡死）', () => {
    const pack = {
      skills: [
        {
          id: 'herb',
          name: '采药',
          icon: '药',
          kind: 'gather',
          activities: [
            { name: '采灵砂', unlockLevel: 1, interval: 3000, exp: 10, output: { item: 'ore', count: 1 } },
          ],
        },
      ],
      items: [{ id: 'ore', name: '灵砂', icon: '砂', type: 'mat', sell: 2 }],
    } as unknown as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), rng: () => 0.9 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();
    game.settleOffline(Number.NaN);
    game.settleOffline(Number.POSITIVE_INFINITY);
    const st = stateOf(game.snapshot());
    expect(st.activity).not.toBeNull(); // 活动未被污染弃置
    expect(st.activity?.progress).toBe(0); // progress 未变 NaN（NaN 落盘即进度尽失）
    expect(Object.keys(st.items)).toEqual([]);
    expect(st.skills.herb?.xp ?? 0).toBe(0);
  });

  it('战斗中离线：脱战回满血（activity 必为 null 的早退路径不得跳过休整）', () => {
    const g1 = createGame({ content: makeCombatPack() as GameContent, clock: new ManualClock(), seed: 7 });
    g1.dispatch({ type: 'combat:start', payload: { enemyId: 'efatal' } });
    g1.events.drain();
    const save = g1.snapshot();
    (save.state as { hp: number }).hp = 5; // 濒血下线（战斗中退出是常态路径）
    const g2 = createGame({ content: makeCombatPack() as GameContent, clock: new ManualClock(), save, seed: 7 });
    g2.settleOffline(3600000);
    const st = stateOf(g2.snapshot());
    expect(st.combat).toBeNull(); // 离线不可战斗：就地脱战
    expect(st.hp).toBe(112); // clv1 满血（旧口径残血 5 横穿离线期，low-hp 门控卡开战）
  });

  it('秘境 low-hp 拒绝：先于抽敌，RNG 种子零消耗（拒绝路径无可观察副作用）', () => {
    const pack = {
      ...makeCombatPack(),
      dungeons: [
        {
          id: 'crypt',
          name: '妖窟',
          icon: '窟',
          floors: 2,
          layers: [{ floor: { min: 1, max: 2 }, enemies: [{ enemy: 'efatal', weight: 1 }] }],
        },
      ],
    } as unknown as GameContent;
    const save = { version: 1, time: 0, state: { hp: 1 } } as unknown as SaveData;
    const game = createGame({ content: pack, clock: new ManualClock(), save, seed: 7 });
    const seedBefore = stateOf(game.snapshot()).rngSeed;
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    const rejects = game.events.drain().filter((e) => e.type === 'reject');
    expect(rejects.map((e) => (e.data as { reason: string }).reason)).toContain('low-hp');
    expect(stateOf(game.snapshot()).rngSeed).toBe(seedBefore);
    expect(stateOf(game.snapshot()).dungeon).toBeNull();
  });

  it('秘境血量健康时照常进层（low-hp 提前查不误伤正常路径）', () => {
    const pack = {
      ...makeCombatPack(),
      dungeons: [
        {
          id: 'crypt',
          name: '妖窟',
          icon: '窟',
          floors: 2,
          layers: [{ floor: { min: 1, max: 2 }, enemies: [{ enemy: 'efatal', weight: 1 }] }],
        },
      ],
    } as unknown as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    game.events.drain();
    expect(stateOf(game.snapshot()).dungeon).not.toBeNull();
    expect(stateOf(game.snapshot()).combat).not.toBeNull();
  });

  it('存档顶层 time 非有限值拒收归零（字符串档防 time += dt 拼接污染时间语义）', () => {
    const save = { version: 1, time: '999' } as unknown as SaveData;
    const game = createGame({ content: makeCombatPack() as GameContent, clock: new ManualClock(), save, seed: 7 });
    game.tick(1000);
    expect(game.snapshot().time).toBe(1000);
  });
});

describe('自查 · 运行时兜底（坏包不致错误行为）', () => {
  it('eat 消耗品 heal.percent 负值：不掉血（旧口径负 percent 吃丹掉血）', () => {
    const pack = {
      skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
      items: [
        {
          id: 'bad_pill',
          name: '蚀心丹',
          icon: '蚀',
          type: 'consumable',
          sell: 1,
          heal: { percent: -0.5 },
        },
      ],
    } as unknown as GameContent;
    const save = {
      version: 1,
      time: 0,
      state: { hp: 50, items: { bad_pill: 2 } },
    } as unknown as SaveData;
    const game = createGame({ content: pack, clock: new ManualClock(), save, seed: 7 });
    game.dispatch({ type: 'consumable:eat', payload: { item: 'bad_pill' } });
    game.events.drain();
    const st = stateOf(game.snapshot());
    expect(st.hp).toBe(50);
    expect(st.items.bad_pill).toBe(1); // 道具照常消耗（包校验第一道关，此处只兜底）
  });

  it('maxHp 修饰 buff 到期上限收缩：下一个脱战 tick 压回（旧口径超顶滞留）', () => {
    const pack = {
      skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
      items: [
        {
          id: 'buff_hp',
          name: '铁骨丹',
          icon: '骨',
          type: 'consumable',
          sell: 1,
          effect: { duration: 1000, multipliers: { hp: 1.5 } },
        },
      ],
    } as unknown as GameContent;
    // clv1 基线 cap 112；buff 态 168。存档满血 168 + buff until 5000（time 0 收编）。
    const save = {
      version: 1,
      time: 0,
      state: { hp: 168, buffs: { buff_hp: 5000 } },
    } as unknown as SaveData;
    const clock = new ManualClock();
    const game = createGame({ content: pack, clock, save, seed: 7 });
    expect(stateOf(game.snapshot()).hp).toBe(168); // 恢复钳点按完整投影（含 buff）不误伤
    clock.advance(6000); // buff 到期（until 5000 < 6000）
    game.tick(6000);
    expect(stateOf(game.snapshot()).hp).toBe(112);
  });
});

describe('自查 · 离线上限钳制双报（awaySeconds/capped）', () => {
  const pack = {
    skills: [
      {
        id: 'herb',
        name: '采药',
        icon: '药',
        kind: 'gather',
        activities: [
          { name: '采灵砂', unlockLevel: 1, interval: 3000, exp: 10, output: { item: 'ore', count: 1 } },
        ],
      },
    ],
    items: [{ id: 'ore', name: '灵砂', icon: '砂', type: 'mat', sell: 2 }],
  } as unknown as GameContent;

  it('离开 24h+21s、基线上限 24h：capped=true、awaySeconds=86421、seconds=86400，收益只按基线结算', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const game = createGame({ content: pack, clock: new ManualClock(), rng: () => 0.9 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();
    game.settleOffline(DAY + 21000);
    const settled = game.events
      .drain()
      .find((e) => e.type === 'offline-settled')
      ?.data as Record<string, unknown>;
    expect(settled.capped).toBe(true);
    expect(settled.awaySeconds).toBe(DAY / 1000 + 21);
    expect(settled.seconds).toBe(DAY / 1000);
    expect(settled.cycles).toBe(DAY / 3000); // 收益按钳后结算时长计，超出部分不入账
    expect(stateOf(game.snapshot()).skills.herb?.xp ?? 0).toBe((DAY / 3000) * 10);
  });

  it('未触上限：capped=false，awaySeconds=seconds（无钳制信息时壳层回落单时长口径）', () => {
    const game = createGame({ content: pack, clock: new ManualClock(), rng: () => 0.9 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();
    game.settleOffline(90000);
    const settled = game.events
      .drain()
      .find((e) => e.type === 'offline-settled')
      ?.data as Record<string, unknown>;
    expect(settled.capped).toBe(false);
    expect(settled.awaySeconds).toBe(90);
    expect(settled.seconds).toBe(90);
  });
});

describe('自查 · victory 事件载荷实发值', () => {
  it('xpMult=1.15 下 victory.exp = 实发 6（round(5×1.15)），与修为入账同源（旧载荷报名义值 5）', () => {
    const game = createGame({
      content: makeCombatPack() as GameContent,
      clock: new ManualClock(),
      rng: () => 0.3,
      contributions: xpMultContribs(1.15),
    });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'efatal' } });
    game.events.drain();
    let victory: { exp: number } | undefined;
    for (let i = 0; i < 600 && !victory; i++) {
      game.tick(100);
      victory = game.events.drain().find((e) => e.type === 'victory')?.data as { exp: number };
    }
    expect(victory).toBeDefined();
    const xpAfter = stateOf(game.snapshot()).skills.fight?.xp ?? 0;
    expect(victory!.exp).toBe(6);
    expect(xpAfter).toBe(6); // 同一咽喉：载荷 = 入账
  });
});
