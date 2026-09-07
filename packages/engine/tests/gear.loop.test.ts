import { describe, expect, it } from 'vitest';
import {
  ManualClock,
  buildTagIndex,
  createGame,
  createRng,
  gearContributions,
  makeInscribedGear,
  queryByTag,
  rollGear,
  type GameContent,
  type GearInstance,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #14 · 装备构筑循环：掉落管线（①~⑧）/ 标签加权 / 熔炼 / 重铸 / 存档形状。
 *
 * 验收对照（票面四条）：
 * 1. 同器胚在不同层数段的掉落分布正确（floorRange 生效）→ floorFilter 组；
 * 2. tierRange=T3 器胚纹阶上限 T3 + preferredTags 加权 1000 次可见偏移 →
 *    tierCeiling / tagWeighting 组；
 * 3. 熔炼 → 器屑入袋 → 重铸单条铭纹数值变化、其余词条不动、天花板不破 →
 *    smeltLoop / reforgeLoop 组；
 * 4. 新增一条带 tags 的铭纹 = 纯 content JSON，引擎零改动 → extendPool 组。
 */

/** 三阶表构造捷径：T1/T2/T3 = value×1/×2/×3 的 flat atk。 */
const atkTiers = (v1: number) =>
  [
    [{ stat: 'atk', zone: 'flat', value: v1 }],
    [{ stat: 'atk', zone: 'flat', value: v1 * 2 }],
    [{ stat: 'atk', zone: 'flat', value: v1 * 3 }],
  ] as const;

const inscription = (id: string, tags: string[]) => ({
  id,
  name: `铭${id.slice(-1)}`,
  icon: '铭',
  type: 'inscription' as const,
  sell: 0,
  tiers: atkTiers(1),
  tags,
});

const blank = (
  id: string,
  floorRange: { min: number; max: number },
  tierRange: { min: number; max: number },
  preferredTags: string[],
) => ({
  id,
  name: '凡铁剑胚',
  icon: '胚',
  type: 'blank' as const,
  sell: 0,
  slot: 'weapon',
  floorRange,
  tierRange,
  preferredTags,
  inherentModifiers: [{ stat: 'def', zone: 'flat', value: 2 }],
});

/**
 * 掉落管线测试包：单档位（weight 1，affix 可调）+ chance 1 的器胚池
 * （低层段 1-4 / 高层段 5-10），RNG 行为全确定。
 */
function makeLoopPack(affix = 2, extra: Array<Record<string, unknown>> = []): GameContent {
  return {
    ...makeCombatPack(),
    items: [
      ...makeCombatPack().items,
      { id: 'gear_shard', name: '器屑', icon: '屑', type: 'mat', sell: 8 },
      blank('blank_low', { min: 1, max: 4 }, { min: 1, max: 2 }, ['offense']),
      blank('blank_high', { min: 5, max: 10 }, { min: 3, max: 3 }, []),
      inscription('insc_o1', ['offense']),
      inscription('insc_o2', ['offense']),
      inscription('insc_o3', ['offense']),
      inscription('insc_n1', ['defense']),
      inscription('insc_n2', ['defense']),
      inscription('insc_n3', []),
      ...extra,
    ],
    gearDrops: [{ enemy: 'e1', chance: 1, pool: ['blank_low', 'blank_high'] }],
    rarities: [{ id: 'only', name: '唯一', weight: 1, mult: 1, affix, sell: 1, smelt: 5 }],
    affixPool: [{ name: '锐锋', stat: 'atk', scale: 0.3 }],
    config: {
      slots: [{ id: 'weapon', name: '法器' }],
      gear: { shardItem: 'gear_shard', reforgeCost: 3, tagWeightPerMatch: 1 },
    },
  } as GameContent;
}

const dropDef = (content: GameContent) => content.gearDrops[0]!;
const blankIds = (gear: GearInstance) => gear.inscriptions?.map((i) => i.id) ?? [];

/* ---------- tag 倒排索引（#14 基建） ---------- */

describe('#14 · tag 倒排索引', () => {
  it('buildTagIndex：tag → 条目集合的倒排映射，同 id 去重、无 tags 不入索引', () => {
    const entries = [
      { id: 'a', tags: ['x', 'y'] },
      { id: 'b', tags: ['y'] },
      { id: 'c' },
      { id: 'a', tags: ['z'] }, // 重复 id 不再入索引
    ];
    const index = buildTagIndex(entries);
    expect(queryByTag(index, 'x').map((e) => e.id)).toEqual(['a']);
    expect(queryByTag(index, 'y').map((e) => e.id)).toEqual(['a', 'b']);
    expect(queryByTag(index, 'z')).toEqual([]);
    expect(queryByTag(index, 'missing')).toEqual([]);
  });
});

/* ---------- 掉落管线（①~⑧） ---------- */

describe('#14 · rollGear 掉落管线', () => {
  it('① 掉不掉：chance 0 永不掉落，且只消耗一次掷点', () => {
    const pack = makeLoopPack();
    let calls = 0;
    const gear = rollGear(pack, { enemy: 'e1', chance: 0, pool: ['blank_low'] }, 1, () => {
      calls += 1;
      return 0.5;
    });
    expect(gear).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('② floorRange 生效：floor 2 只掉低层段器胚，floor 6 只掉高层段器胚（验收①）', () => {
    const pack = makeLoopPack();
    const rand = createRng(7).next;
    for (let i = 0; i < 30; i++) {
      const low = rollGear(pack, dropDef(pack), i + 1, rand, { floor: 2 });
      expect(low?.itemId).toBe('blank_low');
      const high = rollGear(pack, dropDef(pack), i + 100, rand, { floor: 6 });
      expect(high?.itemId).toBe('blank_high');
    }
  });

  it('② 无层语境（野战）不筛层：两种器胚都可能出现', () => {
    const pack = makeLoopPack();
    const rand = createRng(11).next;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const gear = rollGear(pack, dropDef(pack), i + 1, rand);
      if (gear) seen.add(gear.itemId);
    }
    expect([...seen].sort()).toEqual(['blank_high', 'blank_low']);
  });

  it('② 层段全不覆盖 → 池空不掉（缺内容降级，不崩）', () => {
    const pack = makeLoopPack();
    const gear = rollGear(pack, dropDef(pack), 1, createRng(3).next, { floor: 99 });
    expect(gear).toBeUndefined();
  });

  it('⑤⑦ 稀有度定条数、tierRange 锁天花板：T3 器胚全 T3，1-2 器胚不出 T2（验收②前半）', () => {
    const pack = makeLoopPack(2);
    const rand = createRng(5).next;
    for (let i = 0; i < 20; i++) {
      const high = rollGear(pack, dropDef(pack), i + 1, rand, { floor: 6 });
      expect(blankIds(high!)).toHaveLength(2);
      expect(high!.inscriptions!.every((i) => i.tier === 3)).toBe(true);
      const low = rollGear(pack, dropDef(pack), i + 100, rand, { floor: 2 });
      expect(low!.inscriptions!.every((i) => i.tier >= 1 && i.tier <= 2)).toBe(true);
    }
  });

  it('⑥ preferredTags 加权：1000 次统计 offense 占比 ≈ 2/3，无偏好 ≈ 均匀（验收②后半）', () => {
    const pack = makeLoopPack(1);
    const rand = createRng(1234).next;
    let offense = 0;
    for (let i = 0; i < 1000; i++) {
      const gear = rollGear(pack, dropDef(pack), i + 1, rand, { floor: 2 }); // blank_low 偏好 offense
      if (blankIds(gear!).some((id) => id.startsWith('insc_o'))) offense += 1;
    }
    // 权重 = 1+匹配×1：3 条 offense 各 2、3 条非 offense 各 1 → 单抽命中 offense ≈ 6/9。
    expect(offense / 1000).toBeGreaterThan(0.6);
    expect(offense / 1000).toBeLessThan(0.73);

    const neutral = makeLoopPack(1);
    (neutral.items.find((it) => it.id === 'blank_low') as { preferredTags: string[] }).preferredTags = [];
    const rand2 = createRng(1234).next;
    let neutralOffense = 0;
    for (let i = 0; i < 1000; i++) {
      const gear = rollGear(neutral, dropDef(neutral), i + 1, rand2, { floor: 2 });
      if (blankIds(gear!).some((id) => id.startsWith('insc_o'))) neutralOffense += 1;
    }
    expect(neutralOffense / 1000).toBeGreaterThan(0.42);
    expect(neutralOffense / 1000).toBeLessThan(0.58);
  });

  it('验收④：新增一条带 tags 的铭纹 = 纯 content JSON，引擎零改动即可被抽出', () => {
    const pack = makeLoopPack(1, [inscription('insc_new', ['offense'])]);
    const rand = createRng(99).next;
    let seen = false;
    for (let i = 0; i < 200; i++) {
      const gear = rollGear(pack, dropDef(pack), i + 1, rand, { floor: 2 });
      if (blankIds(gear!).includes('insc_new')) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('equip 兼容池：equip 条目不受层筛，走词条池旧管线（affixes 有值、无铭纹）', () => {
    const pack = makeLoopPack();
    const gear = rollGear(
      pack,
      { enemy: 'e1', chance: 1, pool: ['scorp_tail'] },
      1,
      () => 0.99, // ①掉落必中；②池无器胚不掷；④稀有度 affix=2；⑥抽词条
      { floor: 99 },
    );
    expect(gear?.itemId).toBe('scorp_tail');
    expect(gear!.affixes.length).toBeGreaterThan(0);
    expect(gear!.inscriptions).toBeUndefined();
  });
});

/* ---------- 器胚实例化与投影（胚纹/铭纹） ---------- */

describe('#14 · makeInscribedGear 与 gearContributions', () => {
  it('胚纹与铭纹三阶表直入聚合管线：胚纹（equip 来源）+ 铭纹（inscription 来源，含 zone/condition）', () => {
    const pack = makeLoopPack(1);
    const gear = makeInscribedGear(pack, 'blank_low', 7, () => 0.1, { rarity: 'only' });
    expect(gear.uid).toBe(7);
    expect(gear.affixes).toEqual([]);
    expect(blankIds(gear)).toHaveLength(1);
    const contributions = gearContributions(pack, gear, {}, '凡铁剑胚');
    const stats = contributions.map((c) => `${c.source.kind}:${c.modifier.stat}:${c.modifier.value}`);
    expect(stats).toContain('equip:def:2'); // 胚纹
    const insc = contributions.find((c) => c.source.kind === 'inscription')!;
    expect(insc.source.uid).toBe(7);
    expect(insc.modifier.stat).toBe('atk');
  });

  it('条件铭纹：condition 原样进贡献（聚合管线门控判定不变）', () => {
    const pack = makeLoopPack(1, [
      {
        ...inscription('insc_cond', []),
        tiers: [
          [{ stat: 'def', zone: 'flat', value: 6, condition: { element: 'fire' } }],
          [{ stat: 'def', zone: 'flat', value: 6, condition: { element: 'fire' } }],
          [{ stat: 'def', zone: 'flat', value: 6, condition: { element: 'fire' } }],
        ],
      },
    ]);
    // rng 0.9：权重抽中池末位的 insc_cond，纹阶落 T3（condition 各阶均在）。
    const gear = makeInscribedGear(pack, 'blank_low', 1, () => 0.9, { rarity: 'only' });
    expect(blankIds(gear)).toEqual(['insc_cond']);
    const contributions = gearContributions(pack, gear, {}, '凡铁剑胚');
    const cond = contributions.find((c) => c.modifier.condition !== undefined)!;
    expect(cond.modifier.condition).toEqual({ element: 'fire' });
  });

  it('内容铭纹被移除 → 投影静默消失（存档不炸，引擎不崩）', () => {
    const full = makeLoopPack(1);
    const gear = makeInscribedGear(full, 'blank_low', 1, () => 0.1, { rarity: 'only' });
    const slim = makeLoopPack(1).items.filter((it) => !String(it.id).startsWith('insc_o'));
    (slim as { gearDrops: unknown }).gearDrops = (full as { gearDrops: unknown }).gearDrops;
    const packWithout = { ...full, items: slim } as GameContent;
    expect(gearContributions(packWithout, gear, {}, '凡铁剑胚').some((c) => c.source.kind === 'inscription')).toBe(false);
  });

  it('非器胚/缺定义 → 安全降级为无词条裸实例', () => {
    const pack = makeLoopPack(1);
    const gear = makeInscribedGear(pack, 'sword1', 3, () => 0.1, { rarity: 'only' });
    expect(gear).toEqual({ uid: 3, itemId: 'sword1', rarity: 'only', affixes: [] });
  });
});

/* ---------- 熔炼与重铸（Game 动作面） ---------- */

function saveWithGear(gear: GearInstance[], items: Record<string, number> = {}): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 112,
      items,
      skills: { fight: { xp: 0 } },
      activity: null,
      gear,
      gearSeq: Math.max(0, ...gear.map((g) => g.uid)),
      equips: {},
      buffs: {},
      combat: null,
      autoFight: false,
      autoEat: false,
      lastEncounter: {},
      rebirths: 0,
      daoYun: 0,
      daoYunEarned: 0,
      talents: [],
      dungeon: null,
      dungeonBest: {},
      stats: {},
      achievements: [],
    } as unknown as Readonly<Record<string, unknown>>,
  };
}

describe('#14 · gear:smelt 熔炼', () => {
  it('囊中器胚实例 → 器屑入袋（按稀有度 smelt=5）、实例移除、事件载荷齐备（验收③前半）', () => {
    const pack = makeLoopPack();
    const gear = makeInscribedGear(pack, 'blank_low', 1, () => 0.1, { rarity: 'only' });
    const game = createGame({ content: pack, clock: new ManualClock(), save: saveWithGear([gear]) });
    const events: string[] = [];
    game.events.subscribe((e) => events.push(e.type));
    game.dispatch({ type: 'gear:smelt', payload: { uid: 1 } });
    const snap = game.snapshot();
    expect(snap.state.gear).toEqual([]);
    expect((snap.state.items as Record<string, number>)['gear_shard']).toBe(5);
    expect(events).toContain('gear:smelt');
  });

  it('佩戴中不可熔炼；uid 不存在 → not-found；无 shardItem 配置 → not-available', () => {
    const pack = makeLoopPack();
    const gear = makeInscribedGear(pack, 'blank_low', 1, () => 0.1, { rarity: 'only' });
    const save = saveWithGear([gear]);
    (save.state as { equips: Record<string, number> }).equips = { weapon: 1 };
    const wornGame = createGame({ content: pack, clock: new ManualClock(), save });
    wornGame.dispatch({ type: 'gear:smelt', payload: { uid: 1 } });
    const rejects = wornGame.events.drain().filter((e) => e.type === 'reject');
    expect(rejects.some((e) => e.data?.reason === 'worn')).toBe(true);

    const bare = createGame({ content: pack, clock: new ManualClock() });
    bare.dispatch({ type: 'gear:smelt', payload: { uid: 42 } });
    expect(bare.events.drain().some((e) => e.data?.reason === 'not-found')).toBe(true);

    const noEconomy = { ...pack, config: { slots: [{ id: 'weapon', name: '法器' }] } } as GameContent;
    const frugal = createGame({ content: noEconomy, clock: new ManualClock(), save: saveWithGear([gear]) });
    frugal.dispatch({ type: 'gear:smelt', payload: { uid: 1 } });
    expect(frugal.events.drain().some((e) => e.data?.reason === 'not-available')).toBe(true);
  });
});

describe('#14 · gear:reforge 重铸铭纹', () => {
  it('重随单条铭纹：数值随纹阶变化、其余铭纹不动、器屑按 reforgeCost 扣减（验收③）', () => {
    const pack = makeLoopPack(3); // affix 3 → 3 条铭纹
    const gear = makeInscribedGear(pack, 'blank_low', 1, () => 0.0, { rarity: 'only' });
    expect(gear.inscriptions!.every((i) => i.tier === 1)).toBe(true); // rng 0 → 全 T1
    const game = createGame({
      content: pack,
      clock: new ManualClock(),
      save: saveWithGear([gear], { gear_shard: 10 }),
      rng: () => 0.99, // 重随落点 = 区间上界 → T2（低层胚天花板）
    });
    game.dispatch({ type: 'gear:reforge', payload: { uid: 1, index: 1 } });
    const snap = game.snapshot();
    const st = snap.state as { gear: GearInstance[]; items: Record<string, number> };
    expect(st.items['gear_shard']).toBe(7); // 10 − reforgeCost 3
    expect(st.gear[0]!.inscriptions![1]!.tier).toBe(2); // 目标条变化
    expect(st.gear[0]!.inscriptions![0]!.tier).toBe(1); // 其余不动
    expect(st.gear[0]!.inscriptions![2]!.tier).toBe(1);
    // 数值变化实证：投影值 = tiers[tier] → 目标条 1 → 2。
    const values = gearContributions(pack, st.gear[0]!, {}, '凡铁剑胚')
      .filter((c) => c.source.kind === 'inscription')
      .map((c) => c.modifier.value);
    expect(values).toEqual([1, 2, 1]);
  });

  it('天花板不被突破：tierRange 3-3 器胚重随恒 T3；1-2 器胚不出 T2', () => {
    const pack = makeLoopPack(2);
    const high = makeInscribedGear(pack, 'blank_high', 1, () => 0.0, { rarity: 'only' });
    const game = createGame({
      content: pack,
      clock: new ManualClock(),
      save: saveWithGear([high], { gear_shard: 99 }),
      rng: () => 0.1,
    });
    for (let i = 0; i < 3; i++) {
      game.dispatch({ type: 'gear:reforge', payload: { uid: 1, index: 0 } });
      const st = game.snapshot().state as { gear: GearInstance[] };
      expect(st.gear[0]!.inscriptions![0]!.tier).toBe(3); // 3-3 天花板
    }
  });

  it('拒绝面：器屑不足 / index 越界 / equip 实例无铭纹 / 佩戴中', () => {
    const pack = makeLoopPack(1);
    const gear = makeInscribedGear(pack, 'blank_low', 1, () => 0.1, { rarity: 'only' });
    const equip = { uid: 9, itemId: 'scorp_tail', rarity: 'only', affixes: [] } as GearInstance;

    const poor = createGame({
      content: pack,
      clock: new ManualClock(),
      save: saveWithGear([gear], { gear_shard: 2 }), // < reforgeCost 3
    });
    poor.dispatch({ type: 'gear:reforge', payload: { uid: 1, index: 0 } });
    expect(poor.events.drain().some((e) => e.data?.reason === 'no-shard')).toBe(true);

    const rich = createGame({
      content: pack,
      clock: new ManualClock(),
      save: saveWithGear([gear, equip], { gear_shard: 99 }),
    });
    rich.dispatch({ type: 'gear:reforge', payload: { uid: 1, index: 5 } });
    rich.dispatch({ type: 'gear:reforge', payload: { uid: 9, index: 0 } }); // equip：无铭纹
    rich.dispatch({ type: 'gear:reforge', payload: { uid: 42, index: 0 } }); // 查无此器
    const reasons = rich.events
      .drain()
      .filter((e) => e.type === 'reject')
      .map((e) => e.data?.reason);
    expect(reasons).toContain('no-inscription');

    const save = saveWithGear([gear], { gear_shard: 99 });
    (save.state as { equips: Record<string, number> }).equips = { weapon: 1 };
    const wornGame = createGame({ content: pack, clock: new ManualClock(), save });
    wornGame.dispatch({ type: 'gear:reforge', payload: { uid: 1, index: 0 } });
    expect(wornGame.events.drain().some((e) => e.data?.reason === 'worn')).toBe(true);
  });
});

/* ---------- 存档形状（ADR-013：未显式写入不落盘） ---------- */

describe('#14 · 存档：铭纹实例的恢复规范化', () => {
  it('roundtrip：inscriptions 保留；坏 id/越界纹阶丢弃（空表不落盘）', () => {
    const pack = makeLoopPack(2);
    const game = createGame({
      content: pack,
      clock: new ManualClock(),
      save: saveWithGear([
        makeInscribedGear(pack, 'blank_low', 1, () => 0.3, { rarity: 'only' }),
        { uid: 2, itemId: 'blank_low', rarity: 'only', affixes: [] },
      ]),
    });
    const save = game.snapshot();
    const st = save.state as { gear: GearInstance[] };
    // 混入坏引用与越界纹阶：合法项保留、非法项丢弃（ADR-015 稳定引用同律）。
    st.gear[1] = {
      ...st.gear[1]!,
      inscriptions: [
        { id: 'insc_gone', tier: 2 }, // 内容已移除的铭纹
        { id: 'insc_o1', tier: 9 }, // 纹阶越界
        { id: 'insc_o2', tier: 2 }, // 合法
      ],
    };
    const restored = createGame({ content: pack, clock: new ManualClock(), save });
    const gear = (restored.snapshot().state as { gear: GearInstance[] }).gear;
    expect(blankIds(gear[0]!)).toHaveLength(2); // 器胚实例原样
    expect(gear[1]!.inscriptions).toEqual([{ id: 'insc_o2', tier: 2 }]);
  });

  it('全部铭纹非法 → 字段归一省略（未显式写入不落盘，实例不炸）', () => {
    const pack = makeLoopPack(2);
    const save = saveWithGear([{ uid: 5, itemId: 'blank_low', rarity: 'only', affixes: [] }]);
    (save.state as { gear: GearInstance[] }).gear[0] = {
      uid: 5,
      itemId: 'blank_low',
      rarity: 'only',
      affixes: [],
      inscriptions: [{ id: 'insc_gone', tier: 2 }],
    };
    const restored = createGame({ content: pack, clock: new ManualClock(), save });
    const gear = (restored.snapshot().state as { gear: GearInstance[] }).gear;
    expect(gear[0]!.itemId).toBe('blank_low');
    expect(gear[0]!.inscriptions).toBeUndefined();
  });
});
