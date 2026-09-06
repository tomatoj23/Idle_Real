import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame, realmOf, type GameContent, type GameEvent, type SaveData } from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #6 验收：转生系统（兵解重修）引擎面——
 * - AC1 兵解事件后 snapshot：重置项归零、保留项不变、道韵入账；
 * - AC2 天赋点攻击节点 → playerAtk 基底永久提升；同内容推进速度可感知（模拟对比）；
 * - AC3 天赋树数据 100% 来自 content：换包可换整棵树（content 包侧样张见
 *   @wendao/content xiuxian/fantasy 两包测试，此处证引擎投影随包走）。
 * 附带：新 stat 消费点（gatherSpeed/xpMult/offlineCap，round3 E3 注册表收口）、
 * 解锁门控（累计道韵，只增不减）、存档规范化（旧档无转生键）。
 */

/** 转生测试包：公式 coef 0.001/门槛 100 + 五节点树 + e3 解锁门槛 2 + 两档境界。 */
function makeRebirthPack(): GameContent {
  return {
    ...makeCombatPack(),
    rebirth: {
      reset: ['skills', 'items', 'gold', 'buffs', 'lastEncounter'],
      keep: ['gear'],
      formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
      talents: [
        { id: 't_atk', name: '锐金诀', cost: 1, effects: [{ stat: 'atk', zone: 'flat', value: 3 }] },
        { id: 't_spd', name: '罡风步', cost: 1, requires: ['t_atk'], effects: [{ stat: 'gatherSpeed', zone: 'mult', value: 1.5 }] },
        { id: 't_xp', name: '聆音', cost: 1, effects: [{ stat: 'gatherXp', zone: 'mult', value: 2 }] },
        { id: 't_off', name: '龟息功', cost: 1, effects: [{ stat: 'offlineCap', zone: 'flat', value: 60000 }] },
      ],
      unlocks: [{ requires: { daoYun: 2 }, enemies: ['e3'] }],
      realms: [
        { level: 1, name: '练气' },
        { level: 5, name: '筑基' },
      ],
    },
  } as GameContent;
}

/** 满配存档：修为/材料/灵石/增益/装备/佩戴/对照齐备（AC1 的重置-保留双面）。 */
function makeRichSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 123,
      hp: 112,
      items: { herb1: 7, silk: 3 },
      skills: { herb: { xp: 5000 }, fight: { xp: 300 } },
      activity: { skillId: 'herb', index: 0, name: '采青灵草', progress: 500 },
      gear: [{ uid: 1, itemId: 'sword1', rarity: 'common', affixes: [] }],
      equips: { weapon: 1 },
      buffs: { consumable_atk: 999999 },
      combat: null,
      autoFight: false,
      autoEat: false,
      lastEncounter: { e1: { rounds: 3, won: true, at: 1000 } },
    },
  };
}

function drain(game: ReturnType<typeof createGame>): GameEvent[] {
  return game.events.drain();
}

describe('#6 · AC1 兵解结算：重置归零 / 保留不变 / 道韵入账', () => {
  it('兵解后 snapshot：清单内全归零，gear/佩戴保留，道韵 = floor(0.001 × 5300) = 5', () => {
    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save: makeRichSave(), seed: 7 });
    game.dispatch({ type: 'rebirth:perform' });
    const events = drain(game);
    const rebirth = events.find((event) => event.type === 'rebirth');
    expect(rebirth?.data).toMatchObject({ daoYun: 5, totalXp: 5300, rebirths: 1 });

    const st = game.snapshot().state;
    // 重置集（content.rebirth.reset 声明的五键）。
    expect(st.gold).toBe(0);
    expect(st.items).toEqual({});
    expect(st.skills.herb?.xp).toBe(0);
    expect(st.skills.fight?.xp).toBe(0);
    expect(st.buffs).toEqual({});
    expect(st.lastEncounter).toEqual({});
    // 瞬态一律清空：活动散置、气血回满（上限随佩戴武器重算）。
    expect(st.activity).toBeNull();
    expect(st.combat).toBeNull();
    expect(st.hp).toBe(game.snapshot().stats!.maxHp);
    // 保留集 + default-keep：装备实例/佩戴表/uid 序列器原样。
    expect(st.gear).toHaveLength(1);
    expect(st.gear[0]).toMatchObject({ uid: 1, itemId: 'sword1' });
    expect(st.equips).toEqual({ weapon: 1 });
    expect(st.gearSeq).toBe(1);
    // 道韵入账与兵解次数。
    expect(st.daoYun).toBe(5);
    expect(st.daoYunEarned).toBe(5);
    expect(st.rebirths).toBe(1);
  });

  it('reject：包无 rebirth 节 → not-available；修为不足门槛 → no-progress', () => {
    const plain = createGame({ content: makeCombatPack(), clock: new ManualClock(), seed: 7 });
    plain.dispatch({ type: 'rebirth:perform' });
    expect(drain(plain).find((event) => event.type === 'reject')?.data?.reason).toBe('not-available');

    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'rebirth:perform' }); // 总修为 0 < 门槛 100
    expect(drain(game).find((event) => event.type === 'reject')?.data?.reason).toBe('no-progress');
  });

  it('reject：战斗中不可兵解（in-combat）；战斗/活动瞬态不被结算吞没', () => {
    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    drain(game);
    game.dispatch({ type: 'rebirth:perform' });
    expect(drain(game).find((event) => event.type === 'reject')?.data?.reason).toBe('in-combat');
    expect(game.snapshot().state.combat).not.toBeNull();
  });
});

describe('#6 · AC2 天赋：攻击节点永久提升 + 推进速度模拟对比', () => {
  it('点亮 t_atk（flat +3）→ snapshot stats.atk 基底永久 +3（跨兵解存活）', () => {
    // 净基线存档（无装备/无 buff）：clv 4 → atk = 8 + 3×4 = 20，天赋 flat 直加。
    const save = {
      version: 1,
      time: 0,
      state: { skills: { fight: { xp: 300 } }, items: {}, daoYun: 1, daoYunEarned: 1, rebirths: 1 },
    } as unknown as SaveData;
    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save, seed: 7 });
    drain(game);
    expect(game.snapshot().stats!.atk).toBe(20);
    game.dispatch({ type: 'talent:buy', payload: { nodeId: 't_atk' } });
    const events = drain(game);
    expect(events.find((event) => event.type === 'talent:buy')?.data).toMatchObject({
      nodeId: 't_atk',
      cost: 1,
      daoYun: 0,
    });
    expect(game.snapshot().stats!.atk).toBe(23);
    expect(game.snapshot().state.talents).toEqual(['t_atk']);
  });

  it('模拟对比：同种子同内容，双天赋（gatherXp ×2）下一轮修为翻倍', () => {
    // A：无天赋对照组。
    const a = createGame({ content: makeRebirthPack(), clock: new ManualClock(), seed: 42 });
    a.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    a.tick(30000); // 10 轮 × exp 6 = 60
    // B：先行兵解（修为 2000 → 2 道韵）买 t_xp，再挂同一活动。
    const b = createGame({
      content: makeRebirthPack(),
      clock: new ManualClock(),
      save: {
        version: 1,
        time: 0,
        state: { skills: { herb: { xp: 2000 } }, items: {}, activity: null },
      },
      seed: 42,
    });
    drain(b);
    b.dispatch({ type: 'rebirth:perform' }); // gain = floor(0.001 × 2000) = 2
    b.dispatch({ type: 'talent:buy', payload: { nodeId: 't_xp' } }); // 花费 1，余 1
    b.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    b.tick(30000);

    const axp = a.snapshot().state.skills.herb?.xp ?? 0;
    const bxp = b.snapshot().state.skills.herb?.xp ?? 0;
    expect(axp).toBe(60);
    expect(bxp).toBe(120); // exp 6 × gatherXp 2 = 12/轮，推进速度可感知
  });

  it('模拟对比：同种子同内容，gatherSpeed 1.5 → 同期轮次 30 > 20', () => {
    const a = createGame({ content: makeRebirthPack(), clock: new ManualClock(), seed: 42 });
    a.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    a.tick(60000); // 间隔 3000 → 20 轮
    const b = createGame({
      content: makeRebirthPack(),
      clock: new ManualClock(),
      save: {
        version: 1,
        time: 0,
        state: { skills: { herb: { xp: 3000 } }, items: {}, activity: null },
      },
      seed: 42,
    });
    drain(b);
    b.dispatch({ type: 'rebirth:perform' }); // gain = 3
    b.dispatch({ type: 'talent:buy', payload: { nodeId: 't_atk' } }); // 前置
    b.dispatch({ type: 'talent:buy', payload: { nodeId: 't_spd' } }); // gatherSpeed ×1.5，余 1
    b.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    b.tick(60000); // 有效间隔 2000 → 30 轮

    expect(a.snapshot().state.items.herb1).toBe(20);
    expect(b.snapshot().state.items.herb1).toBe(30);
  });
});

describe('#6 · AC3 换包换树：投影随 content.rebirth.talents 走', () => {
  it('同 id 节点在不同包定义不同效果 → 引擎投影逐包跟随（树 100% content）', () => {
    const packA = makeRebirthPack();
    const packB = {
      ...makeRebirthPack(),
      rebirth: {
        ...(packA as { rebirth: Record<string, unknown> }).rebirth,
        talents: [
          { id: 't_atk', name: 'Blade', cost: 2, effects: [{ stat: 'atk', zone: 'flat', value: 7 }] },
        ],
      },
    } as unknown as GameContent;
    const save = { version: 1, time: 0, state: { talents: ['t_atk'], daoYun: 0 } } as unknown as SaveData;
    const a = createGame({ content: packA, clock: new ManualClock(), save, seed: 7 });
    const b = createGame({ content: packB, clock: new ManualClock(), save, seed: 7 });
    // A 树 t_atk = +3；B 树同名节点 = +7（cost/name 全随包）——引擎零改动。
    expect(b.snapshot().stats!.atk - a.snapshot().stats!.atk).toBe(4);
  });

  it('孤儿天赋 id（内容包已移除节点）：存档不炸，效果自然消失', () => {
    const save = { version: 1, time: 0, state: { talents: ['t_ghost'] } } as unknown as SaveData;
    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save, seed: 7 });
    expect(game.snapshot().state.talents).toEqual(['t_ghost']);
    expect(game.snapshot().state.gold).toBe(0); // 无崩溃、无幽灵贡献（基线读数）
  });
});

describe('#6 · 天赋购买拒绝面', () => {
  function gameWithDaoYun(daoYun: number): ReturnType<typeof createGame> {
    const save = {
      version: 1,
      time: 0,
      state: { daoYun, daoYunEarned: daoYun },
    } as unknown as SaveData;
    return createGame({ content: makeRebirthPack(), clock: new ManualClock(), save, seed: 7 });
  }
  const reasonOf = (game: ReturnType<typeof createGame>): unknown =>
    game.events.drain().find((event) => event.type === 'reject')?.data?.reason;

  it('not-found / 道韵不足 no-daoyun / 前置未成 prereq / 无节 not-available', () => {
    const game = gameWithDaoYun(1);
    game.dispatch({ type: 'talent:buy', payload: { nodeId: 't_ghost' } });
    expect(reasonOf(game)).toBe('not-found');

    const poor = gameWithDaoYun(0);
    poor.dispatch({ type: 'talent:buy', payload: { nodeId: 't_atk' } });
    expect(reasonOf(poor)).toBe('no-daoyun');

    const gapped = gameWithDaoYun(5);
    gapped.dispatch({ type: 'talent:buy', payload: { nodeId: 't_spd' } }); // requires t_atk
    expect(reasonOf(gapped)).toBe('prereq');

    const plain = createGame({ content: makeCombatPack(), clock: new ManualClock(), seed: 7 });
    plain.dispatch({ type: 'talent:buy', payload: { nodeId: 't_atk' } });
    expect(reasonOf(plain)).toBe('not-available');
  });

  it('重复点亮幂等（无事件、不重复扣费）', () => {
    const game = gameWithDaoYun(3);
    game.dispatch({ type: 'talent:buy', payload: { nodeId: 't_atk' } });
    game.events.drain();
    game.dispatch({ type: 'talent:buy', payload: { nodeId: 't_atk' } });
    expect(game.events.drain()).toHaveLength(0);
    expect(game.snapshot().state.daoYun).toBe(2);
    expect(game.snapshot().state.talents).toEqual(['t_atk']);
  });
});

describe('#6 · 解锁表：累计道韵门槛（只增不减）', () => {
  it('e3 被 daoYun 2 门槛锁定：不足 reject rebirth-locked；达标放行', () => {
    const locked = createGame({ content: makeRebirthPack(), clock: new ManualClock(), seed: 7 });
    locked.dispatch({ type: 'combat:start', payload: { enemyId: 'e3' } });
    expect(
      locked.events.drain().find((event) => event.type === 'reject')?.data?.reason,
    ).toBe('rebirth-locked');

    const save = { version: 1, time: 0, state: { daoYun: 0, daoYunEarned: 2 } } as unknown as SaveData;
    const unlocked = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save, seed: 7 });
    unlocked.dispatch({ type: 'combat:start', payload: { enemyId: 'e3' } });
    expect(unlocked.events.drain().some((event) => event.type === 'combat-note')).toBe(true);
  });

  it('花掉的道韵不回锁：余额 0、累计 2 仍可挑战（解锁按累计判定）', () => {
    const save = { version: 1, time: 0, state: { daoYun: 0, daoYunEarned: 2, talents: ['t_atk'] } } as unknown as SaveData;
    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save, seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e3' } });
    expect(game.events.drain().some((event) => event.type === 'combat-note')).toBe(true);
  });
});

describe('#6 · 新 stat 消费点（round3 E3 注册表收口）', () => {
  it('offlineCap：离线结算钳在 Σflat 毫秒内；基线（无天赋）不设限', () => {
    const activity = { skillId: 'herb', index: 0, name: '采青灵草', progress: 0 };
    const capped = {
      version: 1,
      time: 0,
      state: { activity, items: {}, talents: ['t_off'] },
    } as unknown as SaveData;
    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save: capped, seed: 7 });
    game.settleOffline(120000); // 上限 60000 → 20 轮（而非 40）
    const event = game.events.drain().find((e) => e.type === 'offline-settled');
    expect(event?.data?.cycles).toBe(20);
    expect(event?.data?.seconds).toBe(60);

    const plain = {
      version: 1,
      time: 0,
      state: { activity: { ...activity }, items: {} },
    } as unknown as SaveData;
    const game2 = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save: plain, seed: 7 });
    game2.settleOffline(120000);
    expect(game2.events.drain().find((e) => e.type === 'offline-settled')?.data?.cycles).toBe(40);
  });

  it('xpMult：全经验倍率在 grantExp 单点消费（采集/斗法同路）', () => {
    const save = { version: 1, time: 0, state: { talents: ['t_xpm'] } } as unknown as SaveData;
    const pack = {
      ...makeRebirthPack(),
      rebirth: {
        ...(makeRebirthPack() as { rebirth: Record<string, unknown> }).rebirth,
        talents: [{ id: 't_xpm', name: '悟道', cost: 1, effects: [{ stat: 'xpMult', zone: 'mult', value: 2 }] }],
      },
    } as unknown as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), save, seed: 7 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.tick(3000); // 恰一轮：exp 6 × xpMult 2 = 12
    expect(game.snapshot().state.skills.herb?.xp).toBe(12);
  });

  it('gatherXp 与 xpMult 叠乘（采集特化 × 全局）', () => {
    const save = { version: 1, time: 0, state: { talents: ['t_xp'] } } as unknown as SaveData;
    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save, seed: 7 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.tick(3000); // exp 6 × gatherXp 2（t_xp）× xpMult 1 = 12
    expect(game.snapshot().state.skills.herb?.xp).toBe(12);
  });
});

describe('#6 · 境界词表（B2 收编）与存档规范化', () => {
  it('realmOf：取 level ≤ clv 的最后一档，无命中回退第一档；无词表 = undefined', () => {
    // clv 1 → 练气（第一档）；查表机制经主入口导出直接验证。
    expect(realmOf(makeRebirthPack(), 1)).toBe('练气');
    expect(realmOf(makeRebirthPack(), 5)).toBe('筑基');
    expect(realmOf(makeRebirthPack(), 99)).toBe('筑基');
    expect(realmOf(makeCombatPack(), 50)).toBeUndefined();
  });

  it('旧档升级：无转生键 → 全部缺省；daoYunEarned 未落盘时以余额兜底', () => {
    const legacy = {
      version: 1,
      time: 0,
      state: { gold: 0, hp: 100, items: {}, skills: {}, activity: null },
    } as unknown as SaveData;
    const game = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save: legacy, seed: 7 });
    const st = game.snapshot().state;
    expect(st.rebirths).toBe(0);
    expect(st.daoYun).toBe(0);
    expect(st.daoYunEarned).toBe(0);
    expect(st.talents).toEqual([]);

    const onlyBalance = {
      version: 1,
      time: 0,
      state: { daoYun: 3 },
    } as unknown as SaveData;
    const game2 = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save: onlyBalance, seed: 7 });
    expect(game2.snapshot().state.daoYunEarned).toBe(3);
  });

  it('兵解后存档往返：snapshot → restore 保留转生进度（rebirths/道韵/天赋）', () => {
    const save = { version: 1, time: 0, state: { daoYun: 4, daoYunEarned: 9, rebirths: 2, talents: ['t_atk'] } } as unknown as SaveData;
    const first = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save, seed: 7 });
    const roundTrip = createGame({ content: makeRebirthPack(), clock: new ManualClock(), save: first.snapshot(), seed: 7 });
    const st = roundTrip.snapshot().state;
    expect(st.rebirths).toBe(2);
    expect(st.daoYun).toBe(4);
    expect(st.daoYunEarned).toBe(9);
    expect(st.talents).toEqual(['t_atk']);
    // 天赋效果随档恢复：t_atk +3 在重载后依然生效（clv1 基线 11 → 14）。
    expect(roundTrip.snapshot().stats!.atk).toBe(14);
  });
});
