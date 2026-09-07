import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  achievementConditionMet,
  achievementProgressOf,
  achievementsOf,
  createGame,
  initialState,
  restoreState,
  type GameContent,
  type GameEvent,
  type GameState,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #9 验收：成就与统计引擎面——
 * - AC1 模拟达成条件（击杀 100）→ 解锁事件一次且仅一次；
 * - AC2 成就表换包即换成就（引擎零改动：content 注入什么就判什么）。
 * 附带：统计累积（击杀/兵解/轮数/秘境层/最大伤害/最快击杀）、奖励入账、
 * 隐藏成就透传、存档往返、兵解 default-keep、进度投影（壳零公式复算）。
 */

/** 一击杀的白羊敌（hp 5 / atk 0）：击杀节奏免受战斗数值干扰。 */
const EWEAK = {
  id: 'eweak',
  name: '白羊',
  icon: '羊',
  level: 1,
  kind: 'claw',
  hp: 5,
  atk: 0,
  def: 0,
  attackInterval: 100000,
  exp: 2,
  gold: { min: 1, max: 1 },
  drops: [],
};

/** 成就测试包：白羊敌 + 三条成就（阈值/反向/隐藏布尔）。 */
function makeAchPack(): GameContent {
  const base = makeCombatPack();
  return {
    ...base,
    enemies: [...base.enemies, EWEAK],
    achievements: [
      {
        id: 'kill_100',
        name: '百战',
        icon: '战',
        description: '累计击杀 100 只妖物',
        condition: { stat: 'kills', target: 100 },
        reward: { gold: 500, items: [{ item: 'core1', count: 2 }] },
      },
      {
        id: 'fast_3',
        name: '速胜',
        condition: { stat: 'fastestKill', op: 'lte', target: 3 },
      },
      {
        id: 'first_death',
        name: '败中求生',
        hidden: true,
        condition: { stat: 'deaths' },
      },
    ],
  } as GameContent;
}

/** 推进战斗直到谓词命中；每轮 tick 1s 并把积压事件汇入 sink（防队列上限截断）。 */
function fightUntil(
  game: ReturnType<typeof createGame>,
  done: () => boolean,
  maxTicks = 1200,
  sink: GameEvent[] = [],
): void {
  for (let i = 0; i < maxTicks && !done(); i++) {
    game.tick(1000);
    sink.push(...game.events.drain());
  }
}

const unlocksOf = (events: GameEvent[], id: string): GameEvent[] =>
  events.filter((event) => event.type === 'achievement:unlock' && event.data?.['id'] === id);

describe('#9 · 统计聚合器：事件流累积', () => {
  it('击杀累积 kills、最快击杀取 min、最大伤害取 max（玩家侧）', () => {
    const game = createGame({ content: makeAchPack(), clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'eweak' } });
    for (let i = 0; i < 12; i++) game.tick(1000);
    const stats = game.snapshot().state['stats'] as Record<string, number>;
    expect(stats['kills']).toBeGreaterThanOrEqual(2); // 12s ≈ 3 场（2200 攻击 + 1500 休整）
    expect(stats['fastestKill']).toBe(1); // 一击杀 → 最快 1 合
    expect(stats['maxHit']).toBeGreaterThan(0);
  });

  it('offline-settled 轮数并入 cycles（在线/离线对称）', () => {
    const game = createGame({ content: makeCombatPack() as GameContent, clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.settleOffline(9500); // interval 3000 → 3 轮余 500ms
    const stats = game.snapshot().state['stats'] as Record<string, number>;
    expect(stats['cycles']).toBe(3);
  });

  it('rebirth 事件累积 rebirths 统计', () => {
    const pack = {
      ...makeCombatPack(),
      rebirth: {
        reset: ['skills'],
        keep: [],
        formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
        talents: [],
      },
    } as GameContent;
    const save = {
      version: 1,
      time: 0,
      state: { skills: { fight: { xp: 20000 } }, items: {} },
    } as unknown as SaveData;
    const game = createGame({ content: pack, clock: new ManualClock(), save, seed: 7 });
    game.dispatch({ type: 'rebirth:perform' });
    const stats = game.snapshot().state['stats'] as Record<string, number>;
    expect(stats['rebirths']).toBe(1);
  });

  it('秘境进层/层奖励/离境 best 累积 dungeonFloorBest（max）', () => {
    const pack = {
      ...makeAchPack(),
      dungeons: [
        {
          id: 'crypt',
          name: '妖窟',
          icon: '窟',
          floors: 2,
          layers: [{ floor: { min: 1, max: 2 }, enemies: [{ enemy: 'eweak', weight: 1 }] }],
        },
      ],
    } as unknown as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    fightUntil(game, () => {
      const best = (game.snapshot().state['stats'] as Record<string, number>)['dungeonFloorBest'];
      return best !== undefined && best >= 2;
    });
    const stats = game.snapshot().state['stats'] as Record<string, number>;
    expect(stats['dungeonFloorBest']).toBe(2);
  });
});

describe('#9 · AC1：达成条件 → 解锁一次且仅一次', () => {
  it('击杀 100 → 恰好一次解锁事件 + 奖励入账；继续战斗不再解锁', () => {
    const game = createGame({ content: makeAchPack(), clock: new ManualClock(), seed: 7 });
    const sink: GameEvent[] = [];
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'eweak' } });

    const unlockedAt = (): boolean =>
      (game.snapshot().state['achievements'] as string[]).includes('kill_100');
    fightUntil(game, unlockedAt, 1200, sink);

    expect(unlocksOf(sink, 'kill_100')).toHaveLength(1); // 一次且仅一次
    const unlock = unlocksOf(sink, 'kill_100')[0]!;
    expect(unlock.data?.['name']).toBe('百战');
    expect(unlock.data?.['gold']).toBe(500);

    const state = game.snapshot().state;
    expect((state['items'] as Record<string, number>)['core1']).toBe(2); // 奖励物品静默入袋
    expect(state['gold']).toBeGreaterThanOrEqual(500); // 击杀灵石 + 奖励灵石
    // 一击杀白羊 → fastestKill=1 → 反向阈值成就随同解锁（一次）。
    expect(unlocksOf(sink, 'fast_3')).toHaveLength(1);

    // 继续挂机击杀：无第二次解锁（幂等）。
    const more: GameEvent[] = [];
    fightUntil(game, () => false, 60, more);
    expect(more.filter((event) => event.type === 'achievement:unlock')).toHaveLength(0);
  });

  it('存档往返：已解锁成就不再重触发', () => {
    const game = createGame({ content: makeAchPack(), clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'eweak' } });
    fightUntil(game, () =>
      (game.snapshot().state['achievements'] as string[]).includes('kill_100'),
    );
    const save = game.snapshot();
    const resumed = createGame({ content: makeAchPack(), clock: new ManualClock(), save, seed: 7 });
    const more: GameEvent[] = [];
    fightUntil(resumed, () => false, 30, more);
    expect(more.filter((event) => event.type === 'achievement:unlock')).toHaveLength(0);
    expect(
      (resumed.snapshot().state['achievements'] as string[]).filter((id) => id === 'kill_100'),
    ).toHaveLength(1);
  });

  it('条件未达不成解锁：低目标包外零误触', () => {
    const pack = {
      ...makeCombatPack(),
      achievements: [{ id: 'no_hit', name: '不可达', condition: { stat: 'kills', target: 999999 } }],
    } as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    const sink: GameEvent[] = [];
    fightUntil(game, () => false, 40, sink);
    expect(sink.filter((event) => event.type === 'achievement:unlock')).toHaveLength(0);
    expect(game.snapshot().state['achievements']).toEqual([]);
  });
});

describe('#9 · AC2：成就表换包即换（引擎零改动）', () => {
  it('同一引擎：不同包成就表不同 → 判定面随包；缺节 = 无成就玩法', () => {
    const packA = {
      ...makeCombatPack(),
      achievements: [{ id: 'a_pack', name: '甲包成就', condition: { stat: 'kills', target: 1 } }],
    } as GameContent;
    const packB = {
      ...makeCombatPack(),
      achievements: [{ id: 'b_pack', name: '乙包成就', condition: { stat: 'cycles', target: 1 } }],
    } as GameContent;
    expect(achievementsOf(packA).map((def) => def.id)).toEqual(['a_pack']);
    expect(achievementsOf(packB).map((def) => def.id)).toEqual(['b_pack']);
    expect(achievementsOf(makeCombatPack() as GameContent)).toEqual([]);

    // 换包装载同引擎：packA 的 kill_1 成就在白羊一击杀后解锁。
    const game = createGame({
      content: { ...packA, enemies: [...packA.enemies, EWEAK] } as GameContent,
      clock: new ManualClock(),
      seed: 7,
    });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'eweak' } });
    const sink: GameEvent[] = [];
    fightUntil(game, () => false, 6, sink);
    expect(unlocksOf(sink, 'a_pack')).toHaveLength(1);
  });
});

describe('#9 · 状态树：恢复规范化与兵解 default-keep', () => {
  it('restoreState：stats 键域收口 + 数值钳非负整数；achievements 去重保序', () => {
    const content = makeCombatPack() as GameContent;
    const base = initialState(content, 1);
    const save = {
      version: 1,
      time: 0,
      state: {
        ...base,
        stats: { kills: 5.9, fastestKill: 2, bogus: 9, maxHit: -3, cycles: Number.NaN },
        achievements: ['a', 'a', 'b', ''],
      },
    } as unknown as SaveData;
    const state = restoreState(content, save, 1);
    expect(state.stats).toEqual({ kills: 5, fastestKill: 2 }); // 未知/非法键不收编，floor 取整
    expect(state.achievements).toEqual(['a', 'b']); // 去重 + 丢弃空串
  });

  it('兵解不清统计与成就（记录资产 default-keep）', () => {
    const pack = {
      ...makeAchPack(),
      rebirth: {
        reset: ['skills', 'items', 'gold'],
        keep: [],
        formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
        talents: [],
      },
    } as unknown as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'eweak' } });
    fightUntil(game, () =>
      (game.snapshot().state['achievements'] as string[]).includes('kill_100'),
    );
    // 高修为入账以过兵解门槛（快照回灌——测试面允许）。
    const save = game.snapshot() as unknown as { state: Record<string, unknown> };
    (save.state['skills'] as Record<string, { xp: number }>)['fight'] = { xp: 20000 };
    const resumed = createGame({
      content: pack,
      clock: new ManualClock(),
      save: save as unknown as SaveData,
      seed: 7,
    });
    resumed.dispatch({ type: 'combat:stop' }); // 存档定格在胜后休整期，先收势再兵解
    resumed.dispatch({ type: 'rebirth:perform' });
    const state = resumed.snapshot().state as unknown as GameState;
    expect(state.rebirths).toBe(1);
    expect(state.stats['kills']).toBeGreaterThanOrEqual(100); // 统计长存
    expect(state.achievements).toContain('kill_100'); // 成就长存
  });
});

describe('#9 · 判定与进度投影（壳零公式复算）', () => {
  const defs = [
    { id: 'gte', name: '阈值', condition: { stat: 'kills', target: 100 } },
    { id: 'bool', name: '布尔', condition: { stat: 'deaths' } },
    { id: 'lte', name: '反向', condition: { stat: 'fastestKill', op: 'lte', target: 3 } },
  ];
  const content = { achievements: defs } as unknown as GameContent;

  it('achievementConditionMet：gte/bool/lte 三型边界', () => {
    expect(achievementConditionMet({ stat: 'kills', op: 'gte', target: 100 }, { kills: 100 })).toBe(true);
    expect(achievementConditionMet({ stat: 'kills', op: 'gte', target: 100 }, {})).toBe(false);
    expect(achievementConditionMet({ stat: 'deaths', op: 'gte' }, { deaths: 1 })).toBe(true);
    expect(achievementConditionMet({ stat: 'deaths', op: 'gte' }, { deaths: 0 })).toBe(false);
    expect(achievementConditionMet({ stat: 'deaths', op: 'gte' }, {})).toBe(false);
    expect(
      achievementConditionMet({ stat: 'fastestKill', op: 'lte', target: 3 }, { fastestKill: 2 }),
    ).toBe(true);
    expect(
      achievementConditionMet({ stat: 'fastestKill', op: 'lte', target: 3 }, { fastestKill: 4 }),
    ).toBe(false);
    expect(achievementConditionMet({ stat: 'fastestKill', op: 'lte', target: 3 }, {})).toBe(false); // 无记录不达成
  });

  it('achievementProgressOf：percent 投影（gte 比值 / lte 反比 / 无记录 0 / 已解锁恒 100）', () => {
    const views = achievementProgressOf(content, { kills: 50, fastestKill: 12 }, []);
    const byId = Object.fromEntries(views.map((view) => [view.def.id, view]));
    expect(byId['gte']!.percent).toBe(50);
    expect(byId['bool']!.percent).toBe(0);
    expect(byId['lte']!.percent).toBe(25); // 3/12
    expect(byId['lte']!.current).toBe(12);
    for (const view of achievementProgressOf(content, {}, ['gte', 'bool', 'lte'])) {
      expect(view.percent).toBe(100);
      expect(view.unlocked).toBe(true);
    }
  });
});
