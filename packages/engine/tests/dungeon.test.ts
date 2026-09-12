import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  createGame,
  dungeonFloorEnemyOf,
  dungeonGateOf,
  dungeonLayerOf,
  findDungeon,
  pickDungeonEnemyOf,
  powerOf,
  type GameContent,
  type GameEvent,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #7 验收：秘境分层爬塔引擎面——
 * - AC1 假时钟推塔 10 层：逐层战斗事件序列正确、层奖励入袋、
 *   撤退/死亡保留到达到的最高层；
 * - AC2 层表换包生效（引擎零改动验证：floors/倍率/敌人池/奖励全随包）。
 * 附带：进入门控（道韵/钥匙，dungeonGateOf 单一来源）、互斥面、
 * 存档往返（中途存档续跑）、离线作废、纯函数视图。
 */

/** AC1 秘境包：10 层妖窟，1-5 层纯灵石层奖，6-10 层加道韵与物品。 */
function makeDungeonPack(): GameContent {
  return {
    ...makeCombatPack(),
    dungeons: [
      {
        id: 'crypt',
        name: '妖窟秘境',
        icon: '窟',
        floors: 10,
        entry: { daoYun: 2 },
        layers: [
          {
            floor: { min: 1, max: 5 },
            enemies: [{ enemy: 'e1', weight: 1 }],
            rewards: { gold: 10 },
          },
          {
            floor: { min: 6, max: 10 },
            enemies: [{ enemy: 'e1', weight: 1 }],
            rewards: { gold: 20, daoYun: 1, items: [{ item: 'core1', count: 1 }] },
          },
        ],
      },
    ],
  } as GameContent;
}

/** AC2 换包样张：3 层深渊，层倍率 hp×2/atk×1.5/gold×2，顶层 e3 + 道韵奖；
 *  config.hpBase 抬血线（换包调参 = 纯 JSON：层倍率承伤需要血量余量）。 */
function makeAbyssPack(): GameContent {
  return {
    ...makeCombatPack(),
    config: { progression: { hpBase: 400 } },
    dungeons: [
      {
        id: 'abyss',
        name: '深渊回廊',
        icon: '渊',
        floors: 3,
        layers: [
          {
            floor: { min: 1, max: 2 },
            enemies: [{ enemy: 'e1', weight: 1 }],
            mult: { hp: 2, atk: 1.5, gold: 2 },
            rewards: { gold: 7 },
          },
          {
            floor: { min: 3, max: 3 },
            enemies: [{ enemy: 'e3', weight: 1 }],
            rewards: { daoYun: 2, items: [{ item: 'core1', count: 2 }] },
          },
        ],
      },
    ],
  } as GameContent;
}

/** 钥匙门槛包：core1 为钥，2 层。 */
function makeKeyedPack(): GameContent {
  return {
    ...makeCombatPack(),
    dungeons: [
      {
        id: 'vault',
        name: '锁灵窟',
        icon: '锁',
        floors: 2,
        entry: { key: 'core1' },
        layers: [{ floor: { min: 1, max: 2 }, enemies: [{ enemy: 'e1', weight: 1 }] }],
      },
    ],
  } as GameContent;
}

/**
 * 高斗法修为存档（一击杀 e1，全程免伤——推塔事件序列免受战斗回合数干扰）。
 * xp 20000 → clv21；未写 hp 的存档恢复即满血（cap 随收编后的修为推算，#41），
 * 30% low-hp 入境门槛自然满足，层数不再受血线配平约束。
 */
function strongSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: { skills: { fight: { xp: 20000 } }, items: {}, daoYun: 0, daoYunEarned: 2 },
  } as unknown as SaveData;
}

interface Buckets {
  enter: GameEvent[];
  floor: GameEvent[];
  clear: GameEvent[];
  leave: GameEvent[];
  victory: GameEvent[];
  defeat: GameEvent[];
  reject: GameEvent[];
}

const buckets = (): Buckets => ({
  enter: [], floor: [], clear: [], leave: [], victory: [], defeat: [], reject: [],
});

function drainInto(game: ReturnType<typeof createGame>, b: Buckets): void {
  for (const event of game.events.drain()) {
    if (event.type === 'dungeon:enter') b.enter.push(event);
    else if (event.type === 'dungeon:floor') b.floor.push(event);
    else if (event.type === 'dungeon:clear') b.clear.push(event);
    else if (event.type === 'dungeon:leave') b.leave.push(event);
    else if (event.type === 'victory') b.victory.push(event);
    else if (event.type === 'defeat') b.defeat.push(event);
    else if (event.type === 'reject') b.reject.push(event);
  }
}

/** 小步 tick 直至条件满足（防挂死上限；事件随时归桶）。 */
function tickUntil(
  game: ReturnType<typeof createGame>,
  b: Buckets,
  done: () => boolean,
  maxTicks = 600,
): void {
  for (let i = 0; i < maxTicks && !done(); i++) {
    game.tick(2000);
    drainInto(game, b);
  }
  expect(done()).toBe(true);
}

describe('#7 · AC1 假时钟推塔 10 层（事件序列/层奖励/通关）', () => {
  it('逐层 victory → dungeon:floor；层奖励入袋；第 10 层通关离境', () => {
    const game = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: strongSave(), seed: 7 });
    const b = buckets();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    drainInto(game, b);
    expect(b.enter).toHaveLength(1);
    expect(b.enter[0]!.data).toMatchObject({ dungeonId: 'crypt', dungeonName: '妖窟秘境', floor: 1, floors: 10 });

    for (let floor = 1; floor <= 10; floor++) {
      tickUntil(game, b, () => b.floor.length >= floor);
      const event = b.floor[floor - 1]!;
      expect(event.data).toMatchObject({
        floor,
        floors: 10,
        gold: floor <= 5 ? 10 : 20,
        daoYun: floor <= 5 ? 0 : 1,
      });
      expect(event.data?.items).toEqual(floor <= 5 ? {} : { core1: 1 });
    }

    tickUntil(game, b, () => b.clear.length === 1);
    expect(b.clear[0]!.data).toMatchObject({ dungeonId: 'crypt', dungeonName: '妖窟秘境', floors: 10 });

    const st = game.snapshot().state;
    expect(st.dungeon).toBeNull();
    expect(st.combat).toBeNull();
    expect(st.dungeonBest).toEqual({ crypt: 10 });
    // 层奖励入袋：灵石 ≥ 层奖合计 150（另有敌人自带随机灵石）；
    // 道韵入账双键（余额 + 累计——深层秘境供养兵解）；物品层奖 5 个下限
    //（e1 自带 core1 掉落为概率性额外进账，不计入断言）。
    expect(st.gold).toBeGreaterThanOrEqual(150);
    expect(st.daoYun).toBe(5);
    expect(st.daoYunEarned).toBe(7);
    expect(st.items.core1).toBeGreaterThanOrEqual(5);
    // 逐层战斗事件序列：每层恰一场胜利。
    expect(b.victory).toHaveLength(10);
    expect(b.defeat).toHaveLength(0);
  });

  it('撤退离境：最高层保留（进层即登记），重进自第 1 层重来', () => {
    const game = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: strongSave(), seed: 7 });
    const b = buckets();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    drainInto(game, b);
    tickUntil(game, b, () => b.floor.length >= 2); // 1、2 层已通
    tickUntil(game, b, () => game.snapshot().state.dungeon?.floor === 3); // 进入第 3 层
    game.dispatch({ type: 'dungeon:leave' });
    drainInto(game, b);
    expect(b.leave).toHaveLength(1);
    expect(b.leave[0]!.data).toMatchObject({ dungeonId: 'crypt', dungeonName: '妖窟秘境', floor: 3, best: 3 });
    expect(game.snapshot().state.dungeon).toBeNull();
    expect(game.snapshot().state.dungeonBest).toEqual({ crypt: 3 });

    // 重进：自第 1 层重新攻略；立即撤退，最高层记录不回退。
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    drainInto(game, b);
    expect(game.snapshot().state.dungeon).toEqual({ dungeonId: 'crypt', floor: 1 });
    game.dispatch({ type: 'dungeon:leave' });
    drainInto(game, b);
    expect(b.leave).toHaveLength(2);
    expect(b.leave[1]!.data).toMatchObject({ floor: 1, best: 3 });
  });

  it('败退离境：defeat → dungeon:leave，最高层记录保留', () => {
    // 净基线削血（clv1 hp 112 − 105 = 7）：e1 首击即倒；道韵门槛随存档放行。
    const mortal = {
      version: 1,
      time: 0,
      state: { items: {}, daoYunEarned: 2 },
    } as unknown as SaveData;
    const game = createGame({
      content: makeDungeonPack(),
      clock: new ManualClock(),
      save: mortal,
      seed: 7,
      contributions: [
        { modifier: { stat: 'hp', zone: 'flat', value: -105 }, source: { id: 'test', kind: 'test' } },
      ],
    });
    const b = buckets();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    drainInto(game, b);
    tickUntil(game, b, () => b.defeat.length === 1);
    expect(b.leave).toHaveLength(1);
    expect(b.leave[0]!.data).toMatchObject({ dungeonId: 'crypt', floor: 1, best: 1 });
    const st = game.snapshot().state;
    expect(st.dungeon).toBeNull();
    expect(st.combat).toBeNull();
    expect(st.dungeonBest).toEqual({ crypt: 1 });
  });

  it('中途存档往返：战斗在身 + 层号 → 恢复后续跑同一层', () => {
    const game = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: strongSave(), seed: 7 });
    const b = buckets();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    drainInto(game, b);
    tickUntil(game, b, () => b.floor.length >= 1);
    tickUntil(game, b, () => game.snapshot().state.dungeon?.floor === 2);
    const resumed = createGame({
      content: makeDungeonPack(),
      clock: new ManualClock(),
      save: game.snapshot(),
      seed: 7,
    });
    const b2 = buckets();
    expect(resumed.snapshot().state.dungeon).toEqual({ dungeonId: 'crypt', floor: 2 });
    expect(resumed.snapshot().state.combat).not.toBeNull();
    expect(resumed.snapshot().state.dungeonBest).toEqual({ crypt: 2 });
    tickUntil(resumed, b2, () => b2.floor.length >= 1);
    expect(b2.floor[0]!.data).toMatchObject({ floor: 2 });
  });

  it('离线不可续跑：攻略就地作废，最高层记录保留', () => {
    const game = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: strongSave(), seed: 7 });
    const b = buckets();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    drainInto(game, b);
    game.settleOffline(60000);
    const st = game.snapshot().state;
    expect(st.dungeon).toBeNull();
    expect(st.combat).toBeNull();
    expect(st.dungeonBest).toEqual({ crypt: 1 });
    drainInto(game, b);
    expect(b.floor).toHaveLength(0);
  });

  it('兵解：战斗中拒绝（in-combat）；离境后兵解，最高层记录跨兵解长存', () => {
    const pack = {
      ...makeDungeonPack(),
      rebirth: {
        reset: ['skills', 'items', 'gold', 'buffs', 'lastEncounter'],
        keep: ['gear'],
        talents: [],
      },
    } as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), save: strongSave(), seed: 7 });
    const b = buckets();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    drainInto(game, b);
    tickUntil(game, b, () => b.floor.length >= 1);
    tickUntil(game, b, () => game.snapshot().state.dungeon?.floor === 2);
    // 攻略战斗在身：兵解拒绝（与斗法同律），攻略态不被波及。
    game.dispatch({ type: 'rebirth:perform' }); // 总修为 20000 ≥ 门槛 5000
    drainInto(game, b);
    expect(game.snapshot().state.dungeon).toEqual({ dungeonId: 'crypt', floor: 2 });
    // 离境后兵解：记录资产（dungeonBest）default-keep 长存。
    game.dispatch({ type: 'dungeon:leave' });
    drainInto(game, b);
    game.dispatch({ type: 'rebirth:perform' });
    drainInto(game, b);
    const st = game.snapshot().state;
    expect(st.dungeon).toBeNull();
    expect(st.combat).toBeNull();
    expect(st.rebirths).toBe(1);
    expect(st.dungeonBest).toEqual({ crypt: 2 });
  });
});

describe('#7 · 进入门控与互斥（dungeonGateOf 单一来源）', () => {
  const reasonOf = (game: ReturnType<typeof createGame>): unknown =>
    game.events.drain().find((event) => event.type === 'reject')?.data?.reason;

  it('道韵门槛：累计不足 locked；达标放行（余额花掉不回锁）', () => {
    const poor = createGame({ content: makeDungeonPack(), clock: new ManualClock(), seed: 7 });
    poor.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    const reject = poor.events.drain().find((event) => event.type === 'reject');
    expect(reject?.data?.reason).toBe('locked');
    expect(reject?.data?.message).toBe('dungeon:enter/locked'); // 文案缺省键名回显（防御可见）

    const earned = strongSave();
    const rich = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: earned, seed: 7 });
    rich.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    expect(rich.events.drain().some((event) => event.type === 'dungeon:enter')).toBe(true);
  });

  it('钥匙门槛：未持 no-key；持有放行', () => {
    const without = {
      version: 1,
      time: 0,
      state: { skills: { fight: { xp: 20000 } }, items: {} },
    } as unknown as SaveData;
    const locked = createGame({ content: makeKeyedPack(), clock: new ManualClock(), save: without, seed: 7 });
    locked.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'vault' } });
    expect(reasonOf(locked)).toBe('no-key');

    const withKey = {
      version: 1,
      time: 0,
      state: { skills: { fight: { xp: 20000 } }, items: { core1: 1 } },
    } as unknown as SaveData;
    const open = createGame({ content: makeKeyedPack(), clock: new ManualClock(), save: withKey, seed: 7 });
    open.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'vault' } });
    expect(open.events.drain().some((event) => event.type === 'dungeon:enter')).toBe(true);
  });

  it('互斥：秘境中再入 in-dungeon；野战在身 in-combat；秘境中接野战 in-dungeon', () => {
    const game = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: strongSave(), seed: 7 });
    const b = buckets();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    drainInto(game, b);
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    expect(reasonOf(game)).toBe('in-dungeon');
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    expect(reasonOf(game)).toBe('in-dungeon');

    const fighting = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: strongSave(), seed: 7 });
    fighting.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    fighting.events.drain();
    fighting.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    expect(reasonOf(fighting)).toBe('in-combat');
  });

  it('低气血 low-hp；未知秘境 not-found；坏载荷 bad-payload；活动互斥照常清槽', () => {
    const weak = {
      version: 1,
      time: 0,
      state: { skills: { fight: { xp: 20000 } }, items: {}, hp: 1, daoYunEarned: 2 },
    } as unknown as SaveData;
    const wounded = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: weak, seed: 7 });
    wounded.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    expect(reasonOf(wounded)).toBe('low-hp');

    const game = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: strongSave(), seed: 7 });
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'ghost' } });
    expect(reasonOf(game)).toBe('not-found');
    game.dispatch({ type: 'dungeon:enter' });
    expect(reasonOf(game)).toBe('bad-payload');

    // 采集进行中入门：活动清空（与 combat:start 同律）。
    const gatherer = createGame({ content: makeDungeonPack(), clock: new ManualClock(), save: strongSave(), seed: 7 });
    gatherer.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    gatherer.events.drain();
    gatherer.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    const events = gatherer.events.drain();
    expect(events.some((event) => event.type === 'activity-stop')).toBe(true);
    expect(events.some((event) => event.type === 'dungeon:enter')).toBe(true);
  });

  it('dungeonGateOf 与 dispatch 判定同式同源（UI 锁定态同调；锁因归一 daoYunLocked）', () => {
    const pack = makeDungeonPack();
    expect(dungeonGateOf(pack, 'crypt', { daoYunEarned: 1, items: {} })).toEqual({
      locked: true, daoYunLocked: true, requiredDaoYun: 2, keyOwned: true,
    });
    expect(dungeonGateOf(pack, 'crypt', { daoYunEarned: 2, items: {} })).toMatchObject({ locked: false });
    expect(dungeonGateOf(pack, 'ghost', { daoYunEarned: 9, items: {} })).toMatchObject({ locked: true });
    expect(dungeonGateOf(makeKeyedPack(), 'vault', { daoYunEarned: 0, items: { core1: 1 } })).toEqual({
      locked: false, daoYunLocked: false, requiredDaoYun: 0, keyItem: 'core1', keyOwned: true,
    });
    expect(dungeonGateOf(makeKeyedPack(), 'vault', { daoYunEarned: 0, items: {} })).toMatchObject({
      locked: true, daoYunLocked: false, keyItem: 'core1', keyOwned: false,
    });
  });
});

describe('#7 · AC2 层表换包生效（引擎零改动验证）', () => {
  it('floors/层倍率/敌人池/层奖励全部随包：3 层深渊推塔通关', () => {
    // 纯函数面：倍率投影随包（e1 hp 60 → 120；未声明 exp 字段保持原值）。
    expect(dungeonFloorEnemyOf(makeAbyssPack(), 'abyss', 2, 'e1')?.hp).toBe(120);
    expect(dungeonFloorEnemyOf(makeAbyssPack(), 'abyss', 2, 'e1')?.atk).toBe(14); // round(9 × 1.5)
    expect(dungeonFloorEnemyOf(makeAbyssPack(), 'abyss', 2, 'e1')?.gold).toEqual({ min: 8, max: 20 });
    expect(dungeonFloorEnemyOf(makeAbyssPack(), 'abyss', 2, 'e1')?.exp).toBe(16);
    expect(dungeonFloorEnemyOf(makeAbyssPack(), 'abyss', 3, 'e3')?.hp).toBe(90); // 第 3 层行未配 mult
    expect(dungeonFloorEnemyOf(makeAbyssPack(), 'ghost', 1, 'e1')).toBeUndefined();

    const save = {
      version: 1,
      time: 0,
      state: { skills: { fight: { xp: 20000 } }, items: {} },
    } as unknown as SaveData;
    const game = createGame({ content: makeAbyssPack(), clock: new ManualClock(), save, seed: 7 });
    const b = buckets();
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'abyss' } });
    drainInto(game, b);
    for (let floor = 1; floor <= 3; floor++) {
      tickUntil(game, b, () => b.floor.length >= floor);
    }
    expect(b.clear).toHaveLength(1);
    expect(b.clear[0]!.data).toMatchObject({ dungeonId: 'abyss', floors: 3 });
    expect(b.floor[2]!.data).toMatchObject({ floor: 3, gold: 0, daoYun: 2 });
    expect(b.floor[2]!.data?.items).toEqual({ core1: 2 });
    const st = game.snapshot().state;
    expect(st.dungeonBest).toEqual({ abyss: 3 });
    expect(st.items.core1).toBeGreaterThanOrEqual(2); // e1 自带掉落为概率性额外进账
  });
});

describe('#7 · 层表/抽敌/战力纯函数视图', () => {
  it('dungeonLayerOf：命中区间第一行；未命中 undefined（防御路径）', () => {
    const dungeon = findDungeon(makeDungeonPack(), 'crypt')!;
    expect(dungeonLayerOf(dungeon, 1)?.rewards?.gold).toBe(10);
    expect(dungeonLayerOf(dungeon, 6)?.rewards?.gold).toBe(20);
    expect(dungeonLayerOf(dungeon, 11)).toBeUndefined();
  });

  it('pickDungeonEnemyOf：权重占比掷点（stub rng 两端取样）；全非法 undefined', () => {
    const pack = makeCombatPack() as GameContent;
    const dungeon = {
      id: 'd', name: 'd', floors: 1,
      layers: [{
        floor: { min: 1, max: 1 },
        enemies: [{ enemy: 'e1', weight: 3 }, { enemy: 'e3', weight: 1 }],
      }],
    };
    expect(pickDungeonEnemyOf(pack, dungeon, 1, () => 0)?.id).toBe('e1');
    expect(pickDungeonEnemyOf(pack, dungeon, 1, () => 0.99)?.id).toBe('e3');
    expect(
      pickDungeonEnemyOf(pack, { ...dungeon, layers: [{ floor: { min: 1, max: 1 }, enemies: [{ enemy: 'ghost', weight: 1 }] }] }, 1, () => 0.5),
    ).toBeUndefined();
  });

  it('dungeonFloorEnemyOf：hp/atk 下限钳 1（超高倍率不产 0/负值）', () => {
    const pack = {
      ...makeCombatPack(),
      dungeons: [{
        id: 'd', name: 'd', floors: 1,
        layers: [{ floor: { min: 1, max: 1 }, enemies: [{ enemy: 'e1', weight: 1 }], mult: { hp: 0.001 } }],
      }],
    } as GameContent;
    expect(dungeonFloorEnemyOf(pack, 'd', 1, 'e1')?.hp).toBe(1);
  });

  it('powerOf：atk + def + maxHp/10 + crit（软提示对照读数，引擎单一来源）', () => {
    expect(powerOf({ atk: 10, def: 3, crit: 5, maxHp: 112 })).toBe(29);
  });
});
