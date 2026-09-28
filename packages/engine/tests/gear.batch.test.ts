import { describe, expect, it } from 'vitest';
import {
  ManualClock,
  createGame,
  gearStackKeyOf,
  planGearBatch,
  type GameContent,
  type GameEvent,
  type GameState,
  type GearInstance,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #37 · 乾坤袋存量清理：视图堆叠判据 + 一键出售/熔炼（阈值）+ 装备锁定。
 *
 * 验收对照（票面五条 + 票评 D1~D3）：
 * 1. 堆叠身份键（同模板+同稀有度+同词条+同铭纹含纹阶，任一差异即分开）；
 * 2. 批量单动作原子化（uid 白名单/稀有度阈值二选一）、佩戴豁免、锁定跳过、
 *    汇总事件 + 修行录一条汇总条目（同拍同源微批并条）；
 * 3. 锁定：单件卖出/熔炼拒收、批量跳过、存档透传恢复（旧档缺省未锁）。
 */

/** 批量测试包：makeCombatPack（common/fine/rare/epic 四档）+ 器屑经济。 */
function makeBatchPack(withEconomy = true): GameContent {
  const base = makeCombatPack();
  return {
    ...base,
    items: [...base.items, { id: 'gear_shard', name: '器屑', icon: '屑', type: 'mat', sell: 8 }],
    config: {
      slots: [{ id: 'weapon', name: '法器' }],
      ...(withEconomy
        ? { gear: { shardItem: 'gear_shard', reforgeCost: 3, tagWeightPerMatch: 1 } }
        : {}),
    },
  } as unknown as GameContent;
}

interface GearSpec {
  uid: number;
  itemId?: string;
  rarity?: string;
  affixes?: Array<{ name: string; stat: string; val: number }>;
  inscriptions?: Array<{ id: string; tier: number }>;
  locked?: boolean;
}

/** 带指定装备实例的存档（佩戴表可选）；sword1 = 青锋剑（卖价 30）。 */
function saveWithGear(specs: GearSpec[], equips: Record<string, number> = {}): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 100,
      items: {},
      skills: { fight: { xp: 0 } },
      activity: null,
      gear: specs.map((spec) => ({
        uid: spec.uid,
        itemId: spec.itemId ?? 'sword1',
        rarity: spec.rarity ?? 'common',
        affixes: spec.affixes ?? [],
        ...(spec.inscriptions ? { inscriptions: spec.inscriptions } : {}),
        ...(spec.locked ? { locked: true } : {}),
      })),
      equips,
      buffs: {},
      combat: null,
      autoFight: false,
      autoEat: false,
      lastEncounter: {},
    },
  };
}

function stOf(game: { snapshot(): SaveData }): GameState {
  return game.snapshot().state as unknown as GameState;
}

const rejectOf = (events: readonly GameEvent[]) =>
  events.find((e): e is Extract<GameEvent, { type: 'reject' }> => e.type === 'reject');

/* ---------- 堆叠身份键（视图分组判据单一来源） ---------- */

describe('#37 · gearStackKeyOf 堆叠身份键', () => {
  const gear = (over: Partial<GearInstance> = {}): GearInstance => ({
    uid: 1,
    itemId: 'sword1',
    rarity: 'common',
    affixes: [],
    ...over,
  });

  it('完全同质同键（uid 不进键）；任一差异即分键（稀有度/词条）', () => {
    const a = gear({ uid: 1 });
    expect(gearStackKeyOf(gear({ uid: 2 }))).toBe(gearStackKeyOf(a)); // uid 不进键
    expect(gearStackKeyOf(gear({ rarity: 'fine' }))).not.toBe(gearStackKeyOf(a));
    expect(
      gearStackKeyOf(gear({ affixes: [{ name: '锐锋', stat: 'atk', val: 5 }] })),
    ).not.toBe(gearStackKeyOf(a));
    // 词条值差异也要分开（完全相同才算同堆）。
    expect(
      gearStackKeyOf(gear({ affixes: [{ name: '锐锋', stat: 'atk', val: 5 }] })),
    ).not.toBe(gearStackKeyOf(gear({ affixes: [{ name: '锐锋', stat: 'atk', val: 6 }] })));
  });

  it('铭纹 id/纹阶任一差异即分键（纹阶显式进键，AC1）', () => {
    const t1 = gear({ inscriptions: [{ id: 'insc_a', tier: 1 }] });
    expect(gearStackKeyOf(gear({ inscriptions: [{ id: 'insc_a', tier: 1 }], uid: 9 }))).toBe(
      gearStackKeyOf(t1),
    );
    expect(gearStackKeyOf(gear({ inscriptions: [{ id: 'insc_a', tier: 2 }] }))).not.toBe(
      gearStackKeyOf(t1),
    );
    expect(gearStackKeyOf(gear({ inscriptions: [{ id: 'insc_b', tier: 1 }] }))).not.toBe(
      gearStackKeyOf(t1),
    );
  });

  it('锁定态进键（D2 联动：整堆可卖 ⇔ 整堆同锁态，混锁堆做不到整堆正确移除）', () => {
    expect(gearStackKeyOf(gear({ locked: true }))).not.toBe(gearStackKeyOf(gear()));
  });
});

/* ---------- planGearBatch 批量处置计划（判定单一来源） ---------- */

describe('#37 · planGearBatch 批量处置计划', () => {
  const pack = makeBatchPack();
  const worn: GearInstance = { uid: 1, itemId: 'sword1', rarity: 'common', affixes: [] };
  const looseA: GearInstance = { uid: 2, itemId: 'sword1', rarity: 'common', affixes: [] };
  const looseB: GearInstance = { uid: 3, itemId: 'sword1', rarity: 'rare', affixes: [] };
  const locked: GearInstance = {
    uid: 4,
    itemId: 'sword1',
    rarity: 'common',
    affixes: [],
    locked: true,
  };

  it('佩戴豁免（零影响不计跳过）+ 锁定跳过（计入 skippedLocked）', () => {
    const plan = planGearBatch(pack, [worn, looseA, locked], [1], {});
    expect(plan.targets.map((g) => g.uid)).toEqual([2]);
    expect(plan.skippedLocked).toBe(1);
  });

  it('稀有度阈值门：≤cap 命中（rarities 数组序低→高），门外/未知档不处置；未知阈值 = 空集', () => {
    const gear = [looseA, looseB];
    expect(planGearBatch(pack, gear, [], { maxRarity: 'common' }).targets.map((g) => g.uid)).toEqual([2]);
    expect(planGearBatch(pack, gear, [], { maxRarity: 'rare' }).targets.map((g) => g.uid)).toEqual([2, 3]);
    // 不按 weight/mult 推断档序：rare weight 8 < fine 20，但数组序 rare > fine。
    expect(planGearBatch(pack, gear, [], { maxRarity: 'fine' }).targets.map((g) => g.uid)).toEqual([2]);
    expect(planGearBatch(pack, gear, [], { maxRarity: 'nope' }).targets).toEqual([]);
  });

  it('uid 白名单（整堆卖）：只命中白名单内散件，锁定件计跳过', () => {
    const plan = planGearBatch(pack, [looseA, looseB, locked], [], { uids: [2, 3, 4] });
    expect(plan.targets.map((g) => g.uid)).toEqual([2, 3]);
    expect(plan.skippedLocked).toBe(1);
    // 白名单外不命中（uid 3 未入选）。
    expect(planGearBatch(pack, [looseA, looseB], [], { uids: [2] }).targets.map((g) => g.uid)).toEqual([2]);
  });
});

/* ---------- gear:sell-all 批量卖器（一键出售 / 整堆卖） ---------- */

describe('#37 · gear:sell-all 批量卖器', () => {
  it('阈值批：≤cap 全部散件一次处置（单动作原子化），佩戴件零影响、锁定件跳过，汇总事件一条', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear(
        [
          { uid: 1 }, // 佩戴（豁免）
          { uid: 2 },
          { uid: 3 },
          { uid: 4 }, // 与 2/3 同质（整堆）
          { uid: 5, rarity: 'fine' },
          { uid: 6, rarity: 'rare' }, // >cap 不处置
          { uid: 7, locked: true }, // 锁定跳过
        ],
        { weapon: 1 },
      ),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:sell-all', payload: { maxRarity: 'fine' } });

    const summary = game.events
      .drain()
      .find((e): e is Extract<GameEvent, { type: 'gear:sell-all' }> => e.type === 'gear:sell-all');
    // 3 件 common（30×3）+ 1 件 fine（30×2=60）= 150；跳过锁定 1 件。
    expect(summary?.data).toEqual({ count: 4, gained: 150, gold: 150, skipped: 1 });
    expect(stOf(game).gold).toBe(150);
    expect(stOf(game).gear.map((g) => g.uid).sort((a, b) => a - b)).toEqual([1, 6, 7]);
  });

  it('uid 白名单批（整堆卖）：只处置白名单；卖价按各自稀有度结算', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([
        { uid: 2 },
        { uid: 3 },
        { uid: 4, rarity: 'fine' },
        { uid: 5, rarity: 'rare' },
      ]),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:sell-all', payload: { uids: [2, 3, 5] } });
    const summary = game.events
      .drain()
      .find((e): e is Extract<GameEvent, { type: 'gear:sell-all' }> => e.type === 'gear:sell-all');
    // 2×common 30 + 1×rare 120（sword1 卖价 30 × 档位 sell 倍率）。
    expect(summary?.data).toEqual({ count: 3, gained: 180, gold: 180, skipped: 0 });
    expect(stOf(game).gear.map((g) => g.uid)).toEqual([4]);
  });

  it('修行录一条汇总条目：同拍同源微批并条（装备行按品级分列 + 灵石行）', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2 }, { uid: 3 }, { uid: 4, rarity: 'fine' }]),
    });
    game.dispatch({ type: 'gear:sell-all', payload: { maxRarity: 'fine' } });
    game.tick(250); // 点条目微批冻结拍
    const points = stOf(game).journal.records.filter((r) => r.kind === 'point');
    expect(points).toHaveLength(1); // 一条汇总条目（非逐件派发）
    expect(points[0]).toMatchObject({ kind: 'point', source: 'sell' });
    if (points[0]?.kind !== 'point') return;
    expect(points[0].lines).toEqual([
      { source: 'sell', kind: 'gear', id: 'sword1', count: -2, gold: -60, rarity: 'common' },
      { source: 'sell', kind: 'gear', id: 'sword1', count: -1, gold: -60, rarity: 'fine' },
      { source: 'sell', kind: 'currency', id: 'gold', count: 120, gold: 120 },
    ]);
  });

  it('空集（无可处置散件）= no-item 拒绝；坏载荷（双带/双缺/坏阈值/坏 uid）= bad-payload', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2, locked: true }]),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:sell-all', payload: { maxRarity: 'epic' } });
    expect(rejectOf(game.events.drain())?.data).toMatchObject({
      action: 'gear:sell-all',
      reason: 'no-item',
    });

    const bads: Array<{ uids?: number[]; maxRarity?: string }> = [
      { uids: [2], maxRarity: 'common' }, // 双带
      {}, // 双缺
      { maxRarity: 'nope' }, // 阈值不在册
      { uids: [] }, // 空白名单
      { uids: [0] }, // 非正 uid
    ];
    for (const payload of bads) {
      game.events.drain();
      game.dispatch({ type: 'gear:sell-all', payload });
      expect(rejectOf(game.events.drain())?.data, JSON.stringify(payload)).toMatchObject({
        reason: 'bad-payload',
      });
    }
  });
});

/* ---------- gear:smelt-all 批量熔器（一键熔炼 / 整堆熔） ---------- */

describe('#37 · gear:smelt-all 批量熔器', () => {
  it('器屑按稀有度档位合计入袋，实例全部移除', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([
        { uid: 2 },
        { uid: 3 },
        { uid: 4, rarity: 'fine' }, // rarities 无 smelt 字段 = 缺省 1
        { uid: 6, locked: true },
      ]),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:smelt-all', payload: { maxRarity: 'epic' } });
    const summary = game.events
      .drain()
      .find((e): e is Extract<GameEvent, { type: 'gear:smelt-all' }> => e.type === 'gear:smelt-all');
    expect(summary?.data).toEqual({ count: 3, item: 'gear_shard', shards: 3, skipped: 1 });
    expect(stOf(game).items['gear_shard']).toBe(3);
    expect(stOf(game).gear.map((g) => g.uid)).toEqual([6]);
  });

  it('判序对齐单件 gear:smelt：空集→no-item 先于经济门；有件无经济→not-available', () => {
    const bare = createGame({
      content: makeBatchPack(false),
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2 }]),
    });
    bare.events.drain();
    bare.dispatch({ type: 'gear:smelt-all', payload: { maxRarity: 'epic' } });
    expect(rejectOf(bare.events.drain())?.data).toMatchObject({ reason: 'not-available' });

    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([]),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:smelt-all', payload: { maxRarity: 'epic' } });
    expect(rejectOf(game.events.drain())?.data).toMatchObject({ reason: 'no-item' });

    // 判序钉：空集 + 无经济 = no-item（查件先于查经济，单件同律）。
    const both = createGame({
      content: makeBatchPack(false),
      clock: new ManualClock(),
      save: saveWithGear([]),
    });
    both.events.drain();
    both.dispatch({ type: 'gear:smelt-all', payload: { maxRarity: 'epic' } });
    expect(rejectOf(both.events.drain())?.data).toMatchObject({ reason: 'no-item' });
  });
});

/* ---------- 装备锁定（D1~D3） ---------- */

describe('#37 · 装备锁定（gear:lock / gear:unlock）', () => {
  it('置/清 locked 标记（幂等）；锁定件单件卖出/熔炼拒收 locked', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2 }]),
    });
    game.dispatch({ type: 'gear:lock', payload: { uid: 2 } });
    game.dispatch({ type: 'gear:lock', payload: { uid: 2 } }); // 幂等
    expect(stOf(game).gear[0]!.locked).toBe(true);

    game.events.drain();
    game.dispatch({ type: 'gear:sell', payload: { uid: 2 } });
    game.dispatch({ type: 'gear:smelt', payload: { uid: 2 } });
    const rejects = game.events.drain().filter((e) => e.type === 'reject');
    expect(rejects.map((e) => (e as Extract<GameEvent, { type: 'reject' }>).data.reason)).toEqual([
      'locked',
      'locked',
    ]);

    game.dispatch({ type: 'gear:unlock', payload: { uid: 2 } });
    game.dispatch({ type: 'gear:unlock', payload: { uid: 2 } }); // 幂等
    expect(stOf(game).gear[0]!.locked).toBeUndefined(); // 解锁 = 不落盘（ADR-013）
    game.events.drain();
    game.dispatch({ type: 'gear:sell', payload: { uid: 2 } });
    expect(game.events.drain().some((e) => e.type === 'reject')).toBe(false);
  });

  it('锁定随档透传（D3）：锁定→快照→恢复→仍锁定；旧档缺 locked = 未锁', () => {
    const pack = makeBatchPack();
    const game = createGame({
      content: pack,
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2 }]),
    });
    game.dispatch({ type: 'gear:lock', payload: { uid: 2 } });
    const first = game.snapshot();
    const resumed = createGame({ content: pack, clock: new ManualClock(), save: first, seed: 7 });
    expect(stOf(resumed).gear[0]!.locked).toBe(true);

    // 旧档（无 locked 字段）恢复为未锁（可选字段向后兼容，不 bump SAVE_KEY）。
    const restored = createGame({
      content: pack,
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2 }]),
    });
    expect(stOf(restored).gear[0]!.locked).toBeUndefined();
  });

  it('兵解装备保留则锁保留（D3）：keep 集原样保留实例，locked 随之留存', () => {
    const pack = {
      ...makeBatchPack(),
      rebirth: {
        reset: ['skills', 'items', 'gold', 'buffs', 'lastEncounter'],
        keep: ['gear'],
        formula: { base: 0, coef: 0.001, exp: 1, minProgress: 20 },
      },
    } as unknown as GameContent;
    const save = saveWithGear([{ uid: 2, locked: true }, { uid: 3 }]);
    (save.state as { skills: Record<string, { xp: number }> }).skills = { fight: { xp: 100 } };
    const game = createGame({ content: pack, clock: new ManualClock(), save });
    game.dispatch({ type: 'rebirth:perform' });
    const st = stOf(game);
    expect(st.rebirths).toBe(1); // 防测试空转：兵解确实发生
    expect(st.gear.map((g) => g.uid)).toEqual([2, 3]); // 实例原样保留
    expect(st.gear[0]!.locked).toBe(true); // 锁随实例留存
    expect(st.gear[1]!.locked).toBeUndefined();
  });
});

/* ---------- 复核收口补盲（/fh 2026-09-28 三路对抗审计） ---------- */

describe('#37 · 判序与边界补盲', () => {
  it('worn+locked 并存：单件拒 worn（佩戴先判），批量豁免不计锁定跳过', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2, locked: true }], { weapon: 2 }),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:sell', payload: { uid: 2 } });
    expect(rejectOf(game.events.drain())?.data).toMatchObject({ reason: 'worn' });
    const plan = planGearBatch(
      makeBatchPack(),
      [{ uid: 2, itemId: 'sword1', rarity: 'common', affixes: [], locked: true }],
      [2],
      {},
    );
    expect(plan.targets).toEqual([]);
    expect(plan.skippedLocked).toBe(0); // 佩戴豁免优先于锁定计数
  });

  it('0 器屑档批量熔炼：实例照常移除、0 补偿不发零额行（资产边界钉）', () => {
    const pack = makeBatchPack();
    (pack as unknown as { rarities: Array<{ id: string; smelt?: number }> }).rarities.forEach((r) => {
      if (r.id === 'common') r.smelt = 0;
    });
    const game = createGame({
      content: pack,
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2 }, { uid: 3 }, { uid: 4, rarity: 'fine' }]),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:smelt-all', payload: { maxRarity: 'epic' } });
    const summary = game.events
      .drain()
      .find((e): e is Extract<GameEvent, { type: 'gear:smelt-all' }> => e.type === 'gear:smelt-all');
    // 两件 common 折 0 + 一件 fine 折 1 = 1；销毁不补偿是内容定价语义（同单件）。
    expect(summary?.data).toEqual({ count: 3, item: 'gear_shard', shards: 1, skipped: 0 });
    expect(stOf(game).items['gear_shard']).toBe(1);
    expect(stOf(game).gear).toEqual([]);
  });

  it('gear:smelt-all 坏载荷四态同律 bad-payload（与 sell-all 各自派发面）', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2 }]),
    });
    const bads: Array<{ uids?: number[]; maxRarity?: string }> = [
      { uids: [2], maxRarity: 'common' },
      {},
      { maxRarity: 'nope' },
      { uids: [] },
    ];
    for (const payload of bads) {
      game.events.drain();
      game.dispatch({ type: 'gear:smelt-all', payload });
      expect(rejectOf(game.events.drain())?.data, JSON.stringify(payload)).toMatchObject({
        reason: 'bad-payload',
      });
    }
  });

  it('uids 白名单病态输入：重复 uid 折叠只处置一件；全不存在/全佩戴 → no-item', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 1 }, { uid: 2 }], { weapon: 1 }),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:sell-all', payload: { uids: [2, 2, 2] } }); // 重复折叠
    const summary = game.events
      .drain()
      .find((e): e is Extract<GameEvent, { type: 'gear:sell-all' }> => e.type === 'gear:sell-all');
    expect(summary?.data).toEqual({ count: 1, gained: 30, gold: 30, skipped: 0 });

    game.events.drain();
    game.dispatch({ type: 'gear:sell-all', payload: { uids: [99] } }); // 不存在
    expect(rejectOf(game.events.drain())?.data).toMatchObject({ reason: 'no-item' });
    game.events.drain();
    game.dispatch({ type: 'gear:sell-all', payload: { uids: [1] } }); // 佩戴豁免
    expect(rejectOf(game.events.drain())?.data).toMatchObject({ reason: 'no-item' });
  });

  it('恢复面坏档：uid 重复后见者弃置（防吞件）；locked 垃圾值弃 = 未锁', () => {
    const save = saveWithGear([{ uid: 2 }, { uid: 3 }]);
    (save.state as { gear: unknown[] }).gear = [
      { uid: 2, itemId: 'sword1', rarity: 'common', affixes: [] },
      { uid: 2, itemId: 'sword1', rarity: 'fine', affixes: [] }, // 重复 uid
      { uid: 3, itemId: 'sword1', rarity: 'common', affixes: [], locked: 'true' }, // 垃圾值
      { uid: 4, itemId: 'sword1', rarity: 'common', affixes: [], locked: 1 }, // 垃圾值
    ];
    const game = createGame({ content: makeBatchPack(), clock: new ManualClock(), save });
    const gear = stOf(game).gear;
    expect(gear.map((g) => g.uid)).toEqual([2, 3, 4]);
    expect(gear[0]!.rarity).toBe('common'); // 首见者留存（后见重复件弃置）
    expect(gear.every((g) => g.locked !== true)).toBe(true);
  });

  it('堆叠键顺序无关 + 缺省态等价（inscriptions 空/缺省、locked false/缺省同键）', () => {
    const base = { itemId: 'blank', rarity: 'common', affixes: [] } as const;
    const a: GearInstance = {
      uid: 1,
      ...base,
      inscriptions: [
        { id: 'i1', tier: 1 },
        { id: 'i2', tier: 2 },
      ],
    };
    const b: GearInstance = {
      uid: 2,
      ...base,
      inscriptions: [
        { id: 'i2', tier: 2 },
        { id: 'i1', tier: 1 },
      ],
    };
    expect(gearStackKeyOf(a)).toBe(gearStackKeyOf(b)); // 抽取序 ≠ 身份
    expect(gearStackKeyOf({ uid: 3, ...base, inscriptions: [] })).toBe(
      gearStackKeyOf({ uid: 4, ...base }),
    );
    expect(gearStackKeyOf({ uid: 5, ...base, locked: false })).toBe(
      gearStackKeyOf({ uid: 6, ...base }),
    );
  });

  it('锁定件重铸拒绝 locked（复核收口口径修正：重铸同罩防手滑）', () => {
    const game = createGame({
      content: makeBatchPack(),
      clock: new ManualClock(),
      save: saveWithGear([{ uid: 2, locked: true }]),
    });
    game.events.drain();
    game.dispatch({ type: 'gear:reforge', payload: { uid: 2, index: 0 } });
    expect(rejectOf(game.events.drain())?.data).toMatchObject({ reason: 'locked' });
  });
});
