import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  BASE_CRAFT_PARAMS,
  BASE_PROGRESSION,
  craftMissingOf,
  craftParamsOf,
  craftSuccessRateOf,
  createGame,
  expBase,
  findRecipe,
  rollRarity,
  type GameState,
  type SaveData,
} from '../src/index.js';
import type { GameContent } from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #5 垂直切片③验收：配方执行循环（成功率/失败损料/缺料停炉/炼器等级加权/
 * 配方 exp 入技能）。钉可观察行为，不钉实现。
 *
 * 注意：levelFromXp 最小层 = 1（非 0）；假时钟按整 interval 步进可精确计轮
 * （跨 tick 结转会携带进度多补轮，与 gather 同语义）。
 */

/** 炼制切片内容包：单 craft 技能（smith）双配方 + gather 对照 + 词表。 */
function makeCraftPack(config?: Record<string, unknown>): GameContent {
  return {
    skills: [
      { id: 'smith', name: '炼器', icon: '器', kind: 'craft' },
      {
        id: 'herb',
        name: '采药',
        icon: '药',
        kind: 'gather',
        activities: [
          { name: '采青灵草', unlockLevel: 1, interval: 3000, exp: 6, output: { item: 'herb1', count: 1 } },
        ],
      },
    ],
    items: [
      { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
      { id: 'ore1', name: '凡铁', icon: '铁', type: 'mat', sell: 5 },
      { id: 'qi1', name: '散灵', icon: '灵', type: 'mat', sell: 2 },
      {
        id: 'consumable_qi',
        name: '聚气丹',
        icon: '聚',
        type: 'consumable',
        sell: 50,
        effect: { duration: 300000, multipliers: { gatherXp: 1.25 } },
      },
      { id: 'sword1', name: '青锋剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, verbStyle: 'sword', bonuses: { atk: 6 } },
    ],
    recipes: [
      // 全局下标 0：消耗品产出（成功率 0.75，可失败）；下标 1：装备产出（必得）。
      {
        name: '炼制聚气丹',
        skill: 'smith',
        unlockLevel: 1,
        output: { item: 'consumable_qi', count: 1 },
        materials: { herb1: 2 },
        successRate: 0.75,
        interval: 3000,
        exp: 8,
      },
      {
        name: '锻青锋剑',
        skill: 'smith',
        unlockLevel: 1,
        output: { item: 'sword1', count: 1 },
        materials: { ore1: 4, qi1: 5 },
        successRate: 1,
        interval: 2000,
        exp: 10,
      },
    ],
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1 },
      { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2 },
      { id: 'rare', name: '罕见', weight: 8, mult: 1.3, affix: 2, sell: 4 },
      { id: 'epic', name: '绝世', weight: 2, mult: 1.5, affix: 3, sell: 10, showcase: true },
    ],
    affixPool: [{ name: '锐锋', stat: 'atk', scale: 0.3 }],
    ...(config ? { config } : {}),
  } as unknown as GameContent;
}

function stateOf(save: SaveData): GameState {
  return save.state as GameState;
}

/** 开炉 + 假时钟按整 interval 推进 N 轮（精确计轮，无跨 tick 结转）。 */
function runCycles(
  game: ReturnType<typeof createGame>,
  clock: ManualClock,
  recipeIndex: number,
  cycles: number,
): void {
  game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: recipeIndex } });
  game.events.drain();
  const interval = findRecipe(makeCraftPack(), recipeIndex)!.interval;
  for (let i = 0; i < cycles; i++) {
    clock.advance(interval);
    game.tick(interval);
  }
}

describe('#5 · 配方执行循环（成功率掷点/失败损料/exp 入技能）', () => {
  it('必得配方：按 interval 补轮，扣料、产出装备实例、exp/loot/complete 事件齐发', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      rng: () => 0.4,
      // 材料 11 轮量：10 轮正常推进，不断料不停炉。
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: { ore1: 44, qi1: 55 }, skills: { smith: { xp: 0 } }, activity: null },
      },
    });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 1 } });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 1 } }); // 幂等
    game.events.drain();
    for (let i = 0; i < 10; i++) {
      clock.advance(2000);
      game.tick(2000);
    }

    const st = stateOf(game.snapshot());
    expect(st.gear).toHaveLength(10);
    expect(st.items.ore1).toBe(4); // 44 − 10×4
    expect(st.items.qi1).toBe(5); // 55 − 10×5
    expect(st.skills.smith?.xp).toBe(100);
    expect(st.activity).toMatchObject({ skillId: 'smith', index: 1 });

    const events = game.events.drain();
    expect(events.filter((e) => e.type === 'activity-complete')).toHaveLength(10);
    expect(events.filter((e) => e.type === 'exp')).toHaveLength(10);
    const loots = events.filter((e) => e.type === 'loot');
    expect(loots).toHaveLength(10);
    for (const loot of loots) {
      expect(loot.data).toMatchObject({ source: 'craft', item: 'sword1', count: 1 });
      expect(['common', 'fine', 'rare', 'epic']).toContain(loot.data?.rarity);
      expect(typeof loot.data?.uid).toBe('number');
    }
  });

  it('恒败路径：失败发 craft-fail 事件 + 材料全损 + 只返还修为（round(exp×0.25)）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      rng: () => 0.99, // successRate 0.75 < 0.99 → 恒败
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: { herb1: 100 }, skills: { smith: { xp: 0 } }, activity: null },
      },
    });
    runCycles(game, clock, 0, 3);

    const st = stateOf(game.snapshot());
    expect(st.items.consumable_qi).toBeUndefined(); // 无产出
    expect(st.items.herb1).toBe(94); // 材料全损
    expect(st.skills.smith?.xp).toBe(6); // 3 × round(8 × 0.25)
    expect(st.activity).toMatchObject({ skillId: 'smith', index: 0 }); // 料未尽不停炉

    const fails = game.events.drain().filter((e) => e.type === 'craft-fail');
    expect(fails).toHaveLength(3);
    for (const fail of fails) {
      expect(fail.data).toMatchObject({ skillId: 'smith', recipeName: '炼制聚气丹', exp: 2 });
    }
  });

  it('缺料自动停炉：活动清空 + craft-halt 事件 + 无未捕获异常（旧版踩坑回归）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      // save 直接给 2 轮材料（herb1×4），开炉后必然断料。
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: { herb1: 4 }, skills: { smith: { xp: 0 } }, activity: null },
      },
    });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 0 } });
    game.events.drain();

    clock.advance(9000); // 3 轮时长，材料只够 2 轮
    game.tick(9000);

    const st = stateOf(game.snapshot());
    expect(st.activity).toBeNull();
    const halts = game.events.drain().filter((e) => e.type === 'craft-halt');
    expect(halts).toHaveLength(1);
    expect(halts[0]?.data).toMatchObject({ skillId: 'smith', recipeName: '炼制聚气丹' });
  });

  it('恒败烧干材料同样触发停炉（轮内耗尽 → 中止 + 停炉）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      rng: () => 0.99,
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: { herb1: 4 }, skills: { smith: { xp: 0 } }, activity: null },
      },
    });
    runCycles(game, clock, 0, 5);

    const st = stateOf(game.snapshot());
    expect(st.activity).toBeNull();
    expect(st.items.herb1).toBeUndefined(); // 全部烧干（0 值不落盘）
    expect(game.events.drain().some((e) => e.type === 'craft-halt')).toBe(true);
  });

  it('配方 exp 入 craft 技能：跨层触发 levelup 事件流（复用 grantExp）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      rng: () => 0.4,
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: { ore1: 400, qi1: 500 }, skills: { smith: { xp: 0 } }, activity: null },
      },
    });
    runCycles(game, clock, 1, 20); // 20 × 10 = 200 exp

    const st = stateOf(game.snapshot());
    expect(st.skills.smith?.xp).toBe(200);
    const levelups = game.events.drain().filter((e) => e.type === 'levelup');
    expect(levelups.map((e) => e.data?.level)).toEqual([2, 3]);
    expect(levelups[0]?.data).toMatchObject({ skillId: 'smith', skillName: '炼器' });
  });

  it('开炉门控：层数不足 / 坏下标 / 材料不齐分别拒绝，不产生活动', () => {
    const pack = makeCraftPack();
    (pack as { recipes: Array<{ unlockLevel: number }> }).recipes[1].unlockLevel = 5;
    const game = createGame({
      content: pack,
      clock: new ManualClock(),
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: {}, skills: { smith: { xp: 0 } }, activity: null },
      },
    });

    game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 1 } });
    expect(game.events.drain()[0]?.data).toMatchObject({ action: 'activity:start', reason: 'level' });

    game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 99 } });
    expect(game.events.drain()[0]?.data).toMatchObject({ reason: 'not-found' });

    game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 0 } });
    expect(game.events.drain()[0]?.data).toMatchObject({ reason: 'no-materials' });
    expect(stateOf(game.snapshot()).activity).toBeNull();
  });

  it('gather 路径不受 craft 分支影响：采集照常（全量套件回归，此处抽一例）', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeCraftPack(), clock, rng: () => 0.4 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(6000);
    game.tick(6000);
    const st = stateOf(game.snapshot());
    expect(st.items.herb1).toBe(2);
    expect(st.activity).toMatchObject({ skillId: 'herb', index: 0 });
  });
});

describe('#5 · 成功率公式（三参数 config 化，单一来源）', () => {
  it('成功率 = min(cap, base + perLevel × 层)，且不低于 base（炼器必得不被 0.99 击穿）', () => {
    const pack = makeCraftPack();
    const skillsL1 = { smith: { xp: 0 } }; // levelFromXp 最小层 = 1
    const skillsL10 = { smith: { xp: expBase(10, BASE_PROGRESSION) } };
    const recipe0 = findRecipe(pack, 0)!;
    const recipe1 = findRecipe(pack, 1)!;

    expect(craftSuccessRateOf(pack, skillsL1, recipe0)).toBeCloseTo(0.754, 10); // 0.75 + 0.004×1
    expect(craftSuccessRateOf(pack, skillsL10, recipe0)).toBeCloseTo(0.79, 10); // 0.75 + 0.004×10
    // successRate 1 → 恒 1（上限只作用于抬升段）
    expect(craftSuccessRateOf(pack, skillsL10, recipe1)).toBe(1);
  });

  it('三参数 config 可覆盖；非法值逐字段回落引擎基线（ADR-016 裁决 ①）', () => {
    expect(BASE_CRAFT_PARAMS).toEqual({
      successPerLevel: 0.004,
      successCap: 0.99,
      failExpRefund: 0.25,
      rarityBiasPerLevel: 0.0004,
    });

    const override = makeCraftPack({
      crafting: { successPerLevel: 0.01, successCap: 0.9, failExpRefund: 0.5, rarityBiasPerLevel: 0.01 },
    });
    expect(craftParamsOf(override)).toEqual({
      successPerLevel: 0.01,
      successCap: 0.9,
      failExpRefund: 0.5,
      rarityBiasPerLevel: 0.01,
    });
    // 0.75 + 0.01 × 10 = 0.85
    expect(craftSuccessRateOf(override, { smith: { xp: expBase(10, BASE_PROGRESSION) } }, findRecipe(override, 0)!)).toBeCloseTo(0.85, 10);

    // 非法值（类型错）回落基线。
    const illegal = makeCraftPack({
      crafting: { successPerLevel: 'high', successCap: null, failExpRefund: NaN, rarityBiasPerLevel: true },
    });
    expect(craftParamsOf(illegal)).toEqual(BASE_CRAFT_PARAMS);
  });

  it('craftMissingOf：缺口 id 列表单一来源（停炉判定与 UI 着色同调）', () => {
    const pack = makeCraftPack();
    const recipe = findRecipe(pack, 1)!; // ore1×4 + qi1×5
    expect(craftMissingOf(recipe, { ore1: 4, qi1: 5 })).toEqual([]);
    expect(craftMissingOf(recipe, { ore1: 3, qi1: 6 })).toEqual(['ore1']);
    expect(craftMissingOf(recipe, {})).toEqual(['ore1', 'qi1']);
  });
});

describe('#5 · 炼器等级加权 rollRarity（#14 接缝：不传 = 现行为逐点不变）', () => {
  const pack = makeCraftPack();

  it('bias 上移掷点：高档位实际占比单调上升（确定性跨界用例）', () => {
    // 权重 70/20/8/2（总 100）→ 单位区间档界：common [0,0.70) fine [0.70,0.90) rare [0.90,0.98) epic [0.98,1)。
    expect(rollRarity(pack, () => 0.695)).toBe('common');
    expect(rollRarity(pack, () => 0.695, 0.01)).toBe('fine'); // 跨 0.70
    expect(rollRarity(pack, () => 0.895)).toBe('fine');
    expect(rollRarity(pack, () => 0.895, 0.01)).toBe('rare'); // 跨 0.90
    expect(rollRarity(pack, () => 0.975)).toBe('rare');
    expect(rollRarity(pack, () => 0.975, 0.01)).toBe('epic'); // 跨 0.98
    // bias ≥ 1 饱和到最高档；负偏置防御性钳 0：与无偏置同分布。
    expect(rollRarity(pack, () => 0, 1)).toBe('epic');
    expect(rollRarity(pack, () => 0.695, -0.5)).toBe('common');
  });

  it('不传 bias = 旧签名逐点同分布（掉落管线 #14 零改动前提）', () => {
    for (const r of [0, 0.1, 0.3, 0.5, 0.69, 0.7, 0.9, 0.97, 0.999]) {
      expect(rollRarity(pack, () => r)).toBe(rollRarity(pack, () => r, 0));
    }
  });

  it('同种子下高炼器等级 → 高档位实际占比单调上升（craft 循环端到端）', () => {
    const meanTier = (smithXp: number): number => {
      const clock = new ManualClock();
      const game = createGame({
        content: makeCraftPack(),
        clock,
        seed: 20260907,
        save: {
          version: 1,
          time: 0,
          state: {
            gold: 0,
            hp: 112,
            items: { ore1: 9999, qi1: 9999 },
            skills: { smith: { xp: smithXp } },
            activity: null,
          },
        },
      });
      game.dispatch({ type: 'activity:start', payload: { skillId: 'smith', index: 1 } });
      for (let i = 0; i < 150; i++) {
        clock.advance(2000);
        game.tick(2000);
      }
      const tiers = ['common', 'fine', 'rare', 'epic'];
      const gear = stateOf(game.snapshot()).gear;
      expect(gear).toHaveLength(150);
      return gear.reduce((sum, g) => sum + Math.max(0, tiers.indexOf(g.rarity)), 0) / gear.length;
    };

    const low = meanTier(0); // 层 1 → bias 0.0004
    const high = meanTier(expBase(99, BASE_PROGRESSION)); // 封顶 99 层 → bias 0.0396
    expect(high).toBeGreaterThan(low);
  });
});

describe('#5 · 炼制离线补偿（O(1) 统计式，欠账不丢）', () => {
  it('必得配方：cycles 全折算，产出/修为/进度一次算清，单条汇总事件', () => {
    const clock = new ManualClock();
    const save: SaveData = {
      version: 1,
      time: 1000,
      state: {
        gold: 0,
        hp: 50,
        items: { ore1: 400, qi1: 500 },
        skills: { smith: { xp: 0 } },
        activity: { skillId: 'smith', index: 1, name: '锻青锋剑', progress: 1000 },
      },
    };
    const game = createGame({ content: makeCraftPack(), clock, save, rng: () => 0.5 });
    expect(game.events.drain()).toEqual([]); // 构造期不自动结算

    game.settleOffline(57000); // total = 58000 / 2000 → 29 轮，进度归零

    const events = game.events.drain();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('offline-settled');
    expect(events[0]?.data).toMatchObject({
      cycles: 29,
      exp: 290, // successRate 1 → 全成：29 × 10
      items: { sword1: 29 },
    });

    const st = stateOf(game.snapshot());
    expect(st.items.ore1).toBe(284); // 400 − 29×4
    expect(st.items.qi1).toBe(355); // 500 − 29×5
    expect(st.gear).toHaveLength(29);
    expect(st.skills.smith?.xp).toBe(290);
    expect(st.activity).toMatchObject({ progress: 0 }); // 材料充足：炉未停
  });

  it('统计式成功数与修为返还：floor(期望) + 余数无偏掷定', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      rng: () => 0.5,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 112,
          items: { herb1: 9 }, // 够 4 轮（余 1）
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 0, name: '炼制聚气丹', progress: 0 },
        },
      },
    });
    game.settleOffline(600000); // 200 轮 >> 材料

    const events = game.events.drain();
    expect(events).toHaveLength(1);
    // attempts 4 × rate 0.75 = 3.0 → 整 3 成；余数 0 不掷 → 3 成 1 败
    expect(events[0]?.data).toMatchObject({ cycles: 4, items: { consumable_qi: 3 } });

    const st = stateOf(game.snapshot());
    expect(st.activity).toBeNull(); // 停炉
    expect(st.items.herb1).toBe(1);
    expect(st.items.consumable_qi).toBe(3);
    expect(st.skills.smith?.xp).toBe(26); // 3×8 + round(1×8×0.25) = 26
  });

  it('装备产出离线：逐件掷定实例（档位/uid 合法），无料停炉不结算', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      rng: () => 0.5,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 112,
          items: { ore1: 40, qi1: 50 }, // 恰好 10 轮
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 1, name: '锻青锋剑', progress: 0 },
        },
      },
    });
    game.settleOffline(100000); // 50 轮 >> 10

    const events = game.events.drain();
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ cycles: 10 });

    const st = stateOf(game.snapshot());
    expect(st.activity).toBeNull();
    expect(st.gear).toHaveLength(10);
    for (const gear of st.gear) {
      expect(['common', 'fine', 'rare', 'epic']).toContain(gear.rarity);
    }
  });

  it('装备产出 count>1：离线实例数 = 成功数 × 产出数（与在线逐件语义一致）', () => {
    const pack = makeCraftPack();
    (pack as { recipes: Array<{ output: { count: number } }> }).recipes[1].output.count = 2;
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      rng: () => 0.5,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 112,
          items: { ore1: 8, qi1: 10 }, // 恰好 2 轮
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 1, name: '锻青锋剑', progress: 0 },
        },
      },
    });
    game.settleOffline(100000); // 50 轮 >> 2

    const events = game.events.drain();
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ cycles: 2, items: { sword1: 4 } });

    const st = stateOf(game.snapshot());
    expect(st.gear).toHaveLength(4); // 2 成功 × count 2
    expect(st.activity).toBeNull();
  });
});

describe('#5 · 存档恢复：craft 活动稳定引用（ADR-015）', () => {
  const baseSave = (name: string, index: number): SaveData => ({
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 112,
      items: { ore1: 40, qi1: 50 },
      skills: { smith: { xp: 0 } },
      activity: { skillId: 'smith', index, name, progress: 700 },
    },
  });

  it('同名同下标 → 恢复并接续炼制', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeCraftPack(), clock, save: baseSave('锻青锋剑', 1), rng: () => 0.4 });
    expect(stateOf(game.snapshot()).activity).toMatchObject({ skillId: 'smith', index: 1, progress: 700 });

    clock.advance(2000);
    game.tick(2000);
    const st = stateOf(game.snapshot());
    expect(st.gear).toHaveLength(1);
    expect(st.activity?.progress).toBe(700);
  });

  it('内容重排/改名（名字对不上）→ 宁可弃置不静默换目标', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeCraftPack(), clock, save: baseSave('锻玄铁重剑', 1) });
    expect(stateOf(game.snapshot()).activity).toBeNull();
  });

  it('gather 活动恢复不受 craft 分支影响', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 112,
          items: {},
          skills: { herb: { xp: 0 } },
          activity: { skillId: 'herb', index: 0, name: '采青灵草', progress: 100 },
        },
      },
    });
    expect(stateOf(game.snapshot()).activity).toMatchObject({ skillId: 'herb', index: 0 });
  });
});

describe('#5 · 内容包变更安全弃置（防崩回归）', () => {
  it('配方被移除后 tick/settleOffline 静默弃置活动，不抛异常', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftPack(),
      clock,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 112,
          items: { ore1: 40, qi1: 50 },
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 7, name: '锻不存在的剑', progress: 0 },
        },
      },
    });
    expect(stateOf(game.snapshot()).activity).toBeNull(); // 恢复期即弃置
    expect(() => game.tick(3000)).not.toThrow();
    expect(() => game.settleOffline(60000)).not.toThrow();
  });

  it('makeCombatPack（无 recipes）路径不回归：craft 分支静默兜底', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeCombatPack(), clock, seed: 7 });
    expect(() => game.tick(3000)).not.toThrow();
    game.events.drain(); // 清掉 tick 事件
    expect(() => game.dispatch({ type: 'activity:start', payload: { skillId: 'fight', index: 0 } })).not.toThrow();
    expect(game.events.drain()[0]?.data).toMatchObject({ reason: 'not-found' });
  });
});

describe('#5 · 增益丹 buff 窗口回归（票面验收；#4 无显式断言用例，本票补齐）', () => {
  it('服破煞丹 → snapshot atk 窗口内提升、过期后恢复且 buff 键清理', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCombatPack(),
      clock,
      seed: 7,
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: { consumable_atk: 1 }, skills: { fight: { xp: 0 } }, activity: null },
      },
    });

    const before = game.snapshot().stats!.atk;
    game.dispatch({ type: 'consumable:eat', payload: { item: 'consumable_atk' } });
    game.events.drain();

    // 窗口内：atk ×1.2 经 ADR-011 管线生效，buff 随档记录
    const during = game.snapshot().stats!.atk;
    expect(during).toBeGreaterThan(before);
    expect(stateOf(game.snapshot()).buffs.consumable_atk).toBeDefined();

    // 推进过 300000ms 窗口：读时过期清理（playerContributions），属性恢复基线
    clock.advance(300000);
    game.tick(300000);
    expect(game.snapshot().stats!.atk).toBe(before);
    expect(stateOf(game.snapshot()).buffs.consumable_atk).toBeUndefined();
  });
});
