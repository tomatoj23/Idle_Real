import { describe, expect, it } from 'vitest';
import { createDungeonRun, findDungeon, type DungeonRunDeps } from '../src/dungeon.js';
import type { DungeonState } from '../src/state.js';
import type { GameContent, GameEvent } from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #52 D5：DungeonRun 直测——层奖励胜利入账单一门（finite 守卫三路 + 实入袋
 * 载荷口径）与攻略导航不变量（enterFloor low-hp 复查先于抽敌零 RNG 消耗、
 * 层倍率投影开战、顶层通关离境序、离境幂等）。不经 createGame：直接构造
 * deps 存取句柄，验证窄门后的秘境状态机本体（combatRun.test.ts 同款形态）。
 *
 * 注：e1 hp 60（fixtures 对齐修仙包青鬃狼）；层倍率 hp×2 → 投影 120。
 */

/** 确定性桩：抽敌权重池单行，random 恒 0.5 且计数（RNG 消耗断言用）。 */
function makeRandomSpy() {
  return { count: 0, next(): number {
    this.count += 1;
    return 0.5;
  } };
}

/** 直测包：3 层妖窟，1-2 层倍率 hp×2 + 全量奖励，第 3 层空奖励。 */
function makeRunPack(): GameContent {
  return {
    ...makeCombatPack(),
    dungeons: [
      {
        id: 'crypt',
        name: '妖窟秘境',
        icon: '窟',
        floors: 3,
        layers: [
          {
            floor: { min: 1, max: 2 },
            enemies: [{ enemy: 'e1', weight: 1 }],
            mult: { hp: 2 },
            rewards: { gold: 10.9, daoYun: 2.4, items: [{ item: 'core1', count: 3.9 }] },
          },
          { floor: { min: 3, max: 3 }, enemies: [{ enemy: 'e1', weight: 1 }], rewards: {} },
        ],
      },
    ],
  } as GameContent;
}

/** 直测 harness：攻略指针/最高层本地句柄 + 咽喉三路捕获面 + 各窄门记录。 */
function makeHarness(pack: GameContent, opts?: { lowHp?: boolean }) {
  const events: GameEvent[] = [];
  const goldCalls: number[] = [];
  const itemCalls: Array<{ itemId: string; count: number }> = [];
  const daoYunCalls: number[] = [];
  const stopNotes: Array<string | undefined> = [];
  const beginCombatCalls: Array<{ enemyId: string; hp: number; actionType?: string }> = [];
  const rejectCalls: Array<{ actionType: string; reason: string }> = [];
  const randomSpy = makeRandomSpy();
  const best = new Map<string, number>();
  let run: DungeonState | null = null;
  let now = 0;
  let itemAccepted = true; // credit.item 拒收面（折叠/坏引用路径）翻转开关
  const deps: DungeonRunDeps = {
    content: pack,
    random: () => randomSpy.next(),
    now: () => now,
    emit: (event) => events.push(event),
    note: (key) => key, // 池缺失回显键（#019 防御语义同款，断言钉键名）
    reject: (actionType, reason) => rejectCalls.push({ actionType, reason }),
    lowHp: () => opts?.lowHp ?? false,
    beginCombat: (enemy, actionType) => {
      beginCombatCalls.push({ enemyId: enemy.id, hp: enemy.hp, actionType });
      return 'ok';
    },
    stopCombat: (note) => stopNotes.push(note),
    run: {
      get: () => run,
      set: (next) => {
        run = next;
      },
    },
    best: {
      of: (id) => best.get(id) ?? 0,
      record: (id, floor) => {
        best.set(id, Math.max(best.get(id) ?? 0, floor));
      },
    },
    credit: {
      gold: (delta) => goldCalls.push(delta),
      item: (itemId, count) => {
        itemCalls.push({ itemId, count });
        return itemAccepted;
      },
      daoYun: (delta) => daoYunCalls.push(delta),
    },
  };
  const dungeonRun = createDungeonRun(deps);
  return {
    dungeonRun,
    deps,
    events,
    goldCalls,
    itemCalls,
    daoYunCalls,
    stopNotes,
    beginCombatCalls,
    rejectCalls,
    randomSpy,
    best,
    runRef: () => run,
    setRun: (value: DungeonState | null) => {
      run = value;
    },
    setItemAccepted: (value: boolean) => {
      itemAccepted = value;
    },
  };
}

const eventsOf = (events: GameEvent[], type: string): GameEvent[] =>
  events.filter((event) => event.type === type);

describe('#52 D5 · 胜利入账单一门（creditFloorRewards）', () => {
  it('层奖励三路入账：finite 守卫取整（10.9→10 / 3.9→3 / 2.4→2）+ dungeon:floor 载荷', () => {
    const pack = makeRunPack();
    const h = makeHarness(pack);
    h.setRun({ dungeonId: 'crypt', floor: 1 });

    h.dungeonRun.creditFloorRewards();

    expect(h.goldCalls).toEqual([10]);
    expect(h.itemCalls).toEqual([{ itemId: 'core1', count: 3 }]);
    expect(h.daoYunCalls).toEqual([2]);
    const floors = eventsOf(h.events, 'dungeon:floor');
    expect(floors).toHaveLength(1);
    expect(floors[0]!.data).toEqual({
      dungeonId: 'crypt',
      dungeonName: '妖窟秘境',
      floor: 1,
      floors: 3,
      gold: 10,
      daoYun: 2,
      items: { core1: 3 },
    });
  });

  it('finite 防御路径：NaN/负数/非正计数逐项归零跳过，零值事件照发', () => {
    const pack = {
      ...makeCombatPack(),
      dungeons: [
        {
          id: 'broken',
          name: '残缺秘境',
          floors: 1,
          layers: [
            {
              floor: { min: 1, max: 1 },
              enemies: [{ enemy: 'e1', weight: 1 }],
              rewards: {
                gold: Number.NaN,
                daoYun: -5,
                items: [
                  { item: 'core1', count: 0 }, // 非正计数：跳过
                  { item: 'ghost', count: Number.NaN }, // 非有限：跳过
                  { count: 2 }, // 缺 item 键：跳过
                ],
              },
            },
          ],
        },
      ],
    } as GameContent;
    const h = makeHarness(pack);
    h.setRun({ dungeonId: 'broken', floor: 1 });

    h.dungeonRun.creditFloorRewards();

    expect(h.goldCalls).toEqual([0]);
    expect(h.itemCalls).toEqual([]);
    expect(h.daoYunCalls).toEqual([0]);
    const floor = eventsOf(h.events, 'dungeon:floor')[0]!;
    expect(floor.data).toMatchObject({ gold: 0, daoYun: 0, items: {} });
  });

  it('无攻略 no-op；credit.item 拒收（折叠/坏引用）不入 items 载荷（实入袋口径）', () => {
    const pack = makeRunPack();
    const h = makeHarness(pack);

    h.dungeonRun.creditFloorRewards(); // 无攻略：零入账零事件
    expect(h.events).toEqual([]);
    expect(h.goldCalls).toEqual([]);

    h.setItemAccepted(false); // 咽喉拒收：物品不进袋 → 载荷不记
    h.setRun({ dungeonId: 'crypt', floor: 1 });
    h.dungeonRun.creditFloorRewards();
    expect(h.itemCalls).toEqual([{ itemId: 'core1', count: 3 }]); // 入账照询
    const floor = eventsOf(h.events, 'dungeon:floor')[0]!;
    expect(floor.data?.items).toEqual({});
    expect(floor.data?.gold).toBe(10); // 灵石/道韵两路不受拒收影响
    expect(floor.data?.daoYun).toBe(2);
  });
});

describe('#52 D5 · 攻略导航（enterFloor / begin / leave / advance）', () => {
  it('enterFloor low-hp 复查先于抽敌：零 RNG 消耗；dispatch 面代发 reject，tick 面静默', () => {
    const pack = makeRunPack();
    const dungeon = findDungeon(pack, 'crypt')!;
    const h = makeHarness(pack, { lowHp: true });

    expect(h.dungeonRun.enterFloor(dungeon, 1, 'dungeon:enter')).toBe('low-hp');
    expect(h.randomSpy.count).toBe(0); // 拒绝路径不得烧 RNG（同种子回放确定性，ADR-013）
    expect(h.rejectCalls).toEqual([{ actionType: 'dungeon:enter', reason: 'low-hp' }]);
    expect(h.beginCombatCalls).toEqual([]);

    expect(h.dungeonRun.enterFloor(dungeon, 1)).toBe('low-hp'); // tick 面：无 actionType 静默
    expect(h.rejectCalls).toHaveLength(1);
  });

  it('enterFloor 抽敌按层倍率投影开战（e1 hp 60×2=120），恰一次抽敌掷点', () => {
    const pack = makeRunPack();
    const dungeon = findDungeon(pack, 'crypt')!;
    const h = makeHarness(pack);

    expect(h.dungeonRun.enterFloor(dungeon, 1)).toBe('ok');
    expect(h.beginCombatCalls).toEqual([{ enemyId: 'e1', hp: 120, actionType: undefined }]);
    expect(h.randomSpy.count).toBe(1);
  });

  it('begin 开攻略：登记 floor 1 + 最高层保底登记（深记录不破）+ dungeon:enter 载荷', () => {
    const pack = makeRunPack();
    const dungeon = findDungeon(pack, 'crypt')!;
    const h = makeHarness(pack);
    h.best.set('crypt', 2); // 历史最深 2 层（记录资产，重进不降）

    h.dungeonRun.begin(dungeon);

    expect(h.runRef()).toEqual({ dungeonId: 'crypt', floor: 1 });
    expect(h.best.get('crypt')).toBe(2);
    const enters = eventsOf(h.events, 'dungeon:enter');
    expect(enters).toHaveLength(1);
    expect(enters[0]!.data).toEqual({
      dungeonId: 'crypt',
      dungeonName: '妖窟秘境',
      floor: 1,
      floors: 3,
    });
  });

  it('advance 中层推进：层号 +1、最高层登记、下一层抽敌开战（零 clear/leave 事件）', () => {
    const pack = makeRunPack();
    const h = makeHarness(pack);
    h.setRun({ dungeonId: 'crypt', floor: 1 });

    h.dungeonRun.advance();

    expect(h.runRef()).toEqual({ dungeonId: 'crypt', floor: 2 });
    expect(h.best.get('crypt')).toBe(2);
    expect(h.beginCombatCalls).toEqual([{ enemyId: 'e1', hp: 120, actionType: undefined }]);
    expect(eventsOf(h.events, 'dungeon:clear')).toEqual([]);
    expect(eventsOf(h.events, 'dungeon:leave')).toEqual([]);
  });

  it('advance 顶层已清：dungeon:clear + 攻略弃置 + stopCombat(retreatVictory)；无攻略幂等', () => {
    const pack = makeRunPack();
    const h = makeHarness(pack);

    h.dungeonRun.advance(); // 无攻略：幂等 no-op
    expect(h.events).toEqual([]);
    expect(h.stopNotes).toEqual([]);

    h.setRun({ dungeonId: 'crypt', floor: 3 });
    h.dungeonRun.advance();
    expect(h.runRef()).toBeNull();
    const clears = eventsOf(h.events, 'dungeon:clear');
    expect(clears).toHaveLength(1);
    expect(clears[0]!.data).toEqual({ dungeonId: 'crypt', dungeonName: '妖窟秘境', floors: 3 });
    expect(h.stopNotes).toEqual(['retreatVictory']); // note 池缺失回显键（harness 桩）
  });

  it('leave 离境：dungeon:leave 载荷 best = max(记录, 本层)；无攻略幂等', () => {
    const pack = makeRunPack();
    const h = makeHarness(pack);

    h.dungeonRun.leave(); // 幂等
    expect(h.events).toEqual([]);

    h.best.set('crypt', 5); // 老记录更深：离境 best 取 max
    h.setRun({ dungeonId: 'crypt', floor: 2 });
    h.dungeonRun.leave();
    expect(h.runRef()).toBeNull();
    const leaves = eventsOf(h.events, 'dungeon:leave');
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.data).toEqual({
      dungeonId: 'crypt',
      dungeonName: '妖窟秘境',
      floor: 2,
      best: 5,
    });
  });
});
