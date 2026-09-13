import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame, type GameContent, type GameEvent, type SaveData } from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #40 验收：snapshot 战斗/活动视图投影（D1 三件套 / D2 字段恒在）——
 * - enemy/minions：resolveEnemy/minionViewOf 单点组合外显（秘境层倍率 ×
 *   Boss 阶段修正 / 召唤 mult），无战斗 = null；
 * - activityIntervals：全活动有效间隔映射（采集 gatherSpeed 缩放、
 *   炼制配方原值），取代旧单值 activityInterval（同一事实单一真相）。
 */

/** 投影测试包：gather 双活动 + craft 单配方 + Boss 两阶段（修正/召唤）+ 秘境层倍率 + gatherSpeed 天赋。 */
function makeProjectionPack(): GameContent {
  const base = makeCombatPack() as GameContent & {
    skills: Array<Record<string, unknown>>;
    enemies: Array<Record<string, unknown>>;
  };
  return {
    ...base,
    skills: [...base.skills, { id: 'alchemy', name: '炼器', icon: '器', kind: 'craft' }],
    recipes: [
      {
        name: '炼制聚气丹',
        skill: 'alchemy',
        unlockLevel: 1,
        successRate: 1,
        interval: 5000,
        exp: 10,
        materials: { herb1: 1 },
        output: { item: 'consumable_heal', count: 1 },
      },
    ],
    // e1 攻击间隔拉满：Boss 阶段推进窗口内玩家不掉血（确定性隔离）。
    enemies: base.enemies.map((enemy) =>
      enemy.id === 'e1' ? { ...enemy, attackInterval: 1000000 } : enemy,
    ),
    bosses: [
      {
        enemy: 'e1',
        phases: [
          { threshold: 0.6, name: '血目暴睁', mods: { atk: 2 }, narration: ['【{enemy}】血目暴睁！'] },
          {
            threshold: 0.3,
            name: '护法现世',
            summons: {
              count: 1,
              enemies: [{ enemy: 'e3', weight: 1, mult: { hp: 0.5, atk: 0.5 } }],
            },
          },
        ],
      },
    ],
    dungeons: [
      {
        id: 'rift',
        name: '裂隙',
        icon: '裂',
        floors: 1,
        layers: [
          {
            floor: { min: 1, max: 1 },
            enemies: [{ enemy: 'efatal', weight: 1 }],
            mult: { hp: 2, atk: 1.5 },
          },
        ],
      },
    ],
    rebirth: {
      reset: ['skills'],
      keep: [],
      formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
      talents: [
        {
          id: 't_speed',
          name: '疾风',
          cost: 1,
          effects: [{ stat: 'gatherSpeed', zone: 'flat', value: 1 }],
        },
      ],
    },
  } as unknown as GameContent;
}

/** 斗法修为存档（xp 100 → atk 17；talents 直写恢复侧，孤儿静默跳过）。 */
function makeSave(talents?: string[]): SaveData {
  return {
    version: 1,
    time: 0,
    state: { skills: { fight: { xp: 100 } }, items: {}, ...(talents ? { talents } : {}) },
  } as unknown as SaveData;
}

describe('#40 · snapshot 战斗/活动视图投影', () => {
  it('无战斗：enemy/minions = null，activityIntervals 为全活动映射，旧单值字段移除', () => {
    const game = createGame({ content: makeProjectionPack(), clock: new ManualClock(), save: makeSave() });
    const snap = game.snapshot();
    expect(snap.enemy).toBeNull();
    expect(snap.minions).toBeNull();
    expect(snap.activityIntervals).toEqual({ 'herb:0': 3000, 'herb:1': 4000, 'alchemy:0': 5000 });
    expect('activityInterval' in snap).toBe(false);
  });

  it('gatherSpeed 天赋点亮 → 采集活动 interval 缩放、炼制配方原值不变', () => {
    const game = createGame({
      content: makeProjectionPack(),
      clock: new ManualClock(),
      save: makeSave(['t_speed']),
    });
    const snap = game.snapshot();
    expect(snap.activityIntervals).toEqual({ 'herb:0': 1500, 'herb:1': 2000, 'alchemy:0': 5000 });
  });

  it('普通敌战斗：enemy = 定义原值投影，召唤物组为空数组', () => {
    const game = createGame({ content: makeProjectionPack(), clock: new ManualClock(), save: makeSave() });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'efatal' } });
    const snap = game.snapshot();
    expect(snap.enemy).toMatchObject({ id: 'efatal', name: '薄血妖', hp: 50, atk: 1 });
    expect(snap.minions).toEqual([]);
  });

  it('Boss 阶段：enemy 投影随阶段修正跟随；召唤入场后 minions 行 = 缩放投影满血', () => {
    const game = createGame({ content: makeProjectionPack(), clock: new ManualClock(), save: makeSave() });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    const seen: GameEvent[] = [];
    game.events.subscribe((event) => seen.push(event));
    let snap = game.snapshot();
    for (let i = 0; i < 60 && (snap.enemy?.atk ?? 0) < 18; i++) {
      game.tick(1000);
      snap = game.snapshot();
    }
    expect(seen.some((e) => e.type === 'boss:phase')).toBe(true);
    expect(snap.enemy).toMatchObject({ id: 'e1', hp: 60, atk: 18 }); // 阶段修正 atk×2
    for (let i = 0; i < 60 && (snap.minions?.length ?? 0) === 0; i++) {
      game.tick(1000);
      snap = game.snapshot();
    }
    expect(seen.some((e) => e.type === 'boss:summon')).toBe(true);
    expect(snap.minions).toHaveLength(1);
    const row = snap.minions![0]!;
    expect(row.view).toMatchObject({ id: 'e3', hp: 45, atk: 7 }); // mult 缩放投影（round）
    expect(row.minion.hp).toBe(45); // 入场满血 = 投影视图
  });

  it('秘境层倍率：enemy 投影 = 层表缩放（hp×2 / atk×1.5 取整），非定义原值', () => {
    const game = createGame({ content: makeProjectionPack(), clock: new ManualClock(), save: makeSave() });
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'rift' } });
    const snap = game.snapshot();
    expect(snap.enemy).toMatchObject({ id: 'efatal', hp: 100, atk: 2 });
    expect(snap.minions).toEqual([]);
  });

  it('投影为快照自持数据：两次取值互不共享引用（壳层持有半旧帧安全）', () => {
    const game = createGame({ content: makeProjectionPack(), clock: new ManualClock(), save: makeSave() });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'efatal' } });
    const a = game.snapshot();
    const b = game.snapshot();
    expect(a.enemy).not.toBe(b.enemy);
    expect(a.enemy).toEqual(b.enemy);
    expect(a.activityIntervals).not.toBe(b.activityIntervals);
  });
});
