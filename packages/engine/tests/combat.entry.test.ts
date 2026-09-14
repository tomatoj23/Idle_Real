import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame, type GameContent, type SaveData } from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #44 · 开战单序列不变量：三扇入场门（combat:start / dungeon:enter /
 * 秘境层推进）共用同一序列——low-hp 退避 → 清活动（战斗/采集互斥，发
 * activity-stop）→ 建战斗态 → 系别临时态归零 → 开战 note。这里以 dispatch
 * 驱动钉住 dispatch 两门的不变量与顺序；层推进一门（tick 面，无 reject
 * 通道，血线由退避判定先行担保）由 dungeon/boss 套件覆盖。测试照旧走
 * dispatch/snapshot，不为序列扩接口。
 */

/** 残血存档：hp 1 远低于 low-hp 线（clv1 上限 112 × 30%）。 */
const woundedSave = (extra: Record<string, unknown> = {}): SaveData =>
  ({ version: 1, time: 0, state: { items: {}, hp: 1, ...extra } }) as unknown as SaveData;

/** 一层妖窟：daoYun 2 门槛，第 1 层仅 e1（秘境侧序列不变量用）。 */
const makeCryptPack = (): GameContent =>
  ({
    ...makeCombatPack(),
    dungeons: [
      {
        id: 'crypt', name: '妖窟秘境', icon: '窟', floors: 1,
        layers: [{ floor: { min: 1, max: 1 }, enemies: [{ enemy: 'e1', weight: 1 }] }],
      },
    ],
  }) as GameContent;

/** 初入战团的战斗态形状（#44 D2 构造单一来源的快照面钉子）。 */
const freshCombat = (): Record<string, unknown> => ({
  enemyId: 'e1',
  ehp: 60,
  pt: 0,
  et: 0,
  respT: 0,
  rounds: 0,
  crits: 0,
  tiers: { light: 0, mid: 0, heavy: 0, deadly: 0 },
  bossPhase: -1,
  summons: [],
});

const reasonsOf = (events: ReturnType<ReturnType<typeof createGame>['events']['drain']>): unknown[] =>
  events.filter((event) => event.type === 'reject').map((event) => event.data?.reason);

describe('#44 · combat:start 门（清活动 + low-hp 退避 + 战斗态构造）', () => {
  it('采集进行中开战：活动清空 + activity-stop，战斗态以空累计开张', () => {
    const game = createGame({ content: makeCombatPack(), clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    const events = game.events.drain();
    expect(events.some((event) => event.type === 'activity-stop')).toBe(true);
    expect(events.some((event) => event.type === 'combat-note' && event.data?.enemyId === 'e1')).toBe(true);
    const st = game.snapshot().state;
    expect(st.activity).toBeNull();
    // 构造单一来源（D2）：计时/伤档/阶段/召唤全空位起手。
    expect(st.combat).toEqual(freshCombat());
  });

  it('残血退避先于清活动：reject low-hp，活动保全、战斗未开', () => {
    const game = createGame({ content: makeCombatPack(), clock: new ManualClock(), save: woundedSave(), seed: 7 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    const events = game.events.drain();
    expect(reasonsOf(events)).toEqual(['low-hp']);
    expect(events.some((event) => event.type === 'activity-stop')).toBe(false);
    const st = game.snapshot().state;
    expect(st.activity).not.toBeNull();
    expect(st.combat).toBeNull();
  });

  it('同敌再派发幂等：零事件、战斗态原样（不重开团、不重置战况累计）', () => {
    const game = createGame({ content: makeCombatPack(), clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    game.events.drain();
    game.tick(4000); // 推进数合：ehp 已扣、rounds 已计——重开团即回满，钉子才有牙
    game.events.drain();
    const before = game.snapshot().state.combat;
    expect(before).toMatchObject({ enemyId: 'e1' });
    expect((before as { ehp: number }).ehp).toBeLessThan(60);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    expect(game.events.drain()).toEqual([]);
    expect(game.snapshot().state.combat).toEqual(before);
  });
});

describe('#44 · dungeon:enter 门（同一序列，秘境侧参数差异）', () => {
  it('残血退避先于清活动：reject low-hp，活动保全、攻略与战斗均未建', () => {
    const game = createGame({
      content: makeCryptPack(),
      clock: new ManualClock(),
      save: woundedSave({ daoYunEarned: 2 }),
      seed: 7,
    });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    const events = game.events.drain();
    expect(reasonsOf(events)).toEqual(['low-hp']);
    expect(events.some((event) => event.type === 'activity-stop')).toBe(false);
    const st = game.snapshot().state;
    expect(st.activity).not.toBeNull();
    expect(st.dungeon).toBeNull();
    expect(st.combat).toBeNull();
  });

  it('层敌全缺失（防御路径）：reject no-layer，活动保全、攻略/战斗/层记录均未建', () => {
    const pack = {
      ...makeCombatPack(),
      dungeons: [
        {
          id: 'ruin', name: '废墟', icon: '废', floors: 1,
          layers: [{ floor: { min: 1, max: 1 }, enemies: [{ enemy: 'ghost', weight: 1 }] }],
        },
      ],
    } as GameContent;
    const game = createGame({
      content: pack,
      clock: new ManualClock(),
      save: { version: 1, time: 0, state: { items: {} } } as unknown as SaveData,
      seed: 7,
    });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'ruin' } });
    const events = game.events.drain();
    expect(reasonsOf(events)).toEqual(['no-layer']);
    expect(events.some((event) => event.type === 'activity-stop')).toBe(false);
    const st = game.snapshot().state;
    expect(st.activity).not.toBeNull();
    expect(st.dungeon).toBeNull();
    expect(st.combat).toBeNull();
    expect(st.dungeonBest).toEqual({});
  });

  it('采集进行中入门：活动清空 + activity-stop，开战 note 先于 dungeon:enter 事件', () => {
    const game = createGame({
      content: makeCryptPack(),
      clock: new ManualClock(),
      save: {
        version: 1, time: 0,
        state: { skills: { fight: { xp: 20000 } }, items: {}, daoYunEarned: 2 },
      } as unknown as SaveData,
      seed: 7,
    });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.events.drain();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    const events = game.events.drain();
    expect(events.some((event) => event.type === 'activity-stop')).toBe(true);
    const noteAt = events.findIndex((event) => event.type === 'combat-note' && event.data?.enemyId === 'e1');
    const enterAt = events.findIndex((event) => event.type === 'dungeon:enter');
    expect(noteAt).toBeGreaterThanOrEqual(0);
    expect(noteAt).toBeLessThan(enterAt);
    const st = game.snapshot().state;
    expect(st.activity).toBeNull();
    expect(st.dungeon).toEqual({ dungeonId: 'crypt', floor: 1 });
    expect(st.combat).toEqual(freshCombat());
  });
});
