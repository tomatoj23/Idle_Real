import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  createGame,
  type AutoFoldRule,
  type GameContent,
  type GameEvent,
  type GameState,
  type LedgerData,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack, makePack } from './fixtures.js';

function stateOf(save: SaveData): GameState {
  return save.state as GameState;
}

function ledgerEntries(events: GameEvent[]): LedgerData[] {
  return events.filter((e) => e.type === 'ledger').map((e) => e.data as LedgerData);
}

/** kind|source|id 聚合计数（在线/离线对称断言的口径：等量结算 → 聚合相等）。 */
function aggregate(entries: LedgerData[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.kind}|${e.source}|${e.id}`;
    out.set(key, (out.get(key) ?? 0) + e.count);
  }
  return out;
}

/** 炼制夹具（双必得配方：丹药产出 + 装备产出；器屑经济已配置）。 */
function makeLedgerPack(): GameContent {
  return {
    skills: [{ id: 'smith', name: '炼器', icon: '器', kind: 'craft' }],
    items: [
      { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
      {
        id: 'pill1',
        name: '聚气丹',
        icon: '聚',
        type: 'consumable',
        sell: 50,
        effect: { duration: 300000, multipliers: { atk: 1.1 } },
      },
      { id: 'shard', name: '器屑', icon: '屑', type: 'mat', sell: 3 },
      { id: 'sword1', name: '青锋剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, bonuses: { atk: 6 } },
    ],
    recipes: [
      {
        name: '炼制聚气丹',
        skill: 'smith',
        unlockLevel: 1,
        output: { item: 'pill1', count: 1 },
        materials: { herb1: 2 },
        successRate: 1,
        interval: 3000,
        exp: 8,
      },
      {
        name: '锻青锋剑',
        skill: 'smith',
        unlockLevel: 1,
        output: { item: 'sword1', count: 1 },
        materials: { herb1: 1 },
        successRate: 1,
        interval: 2000,
        exp: 10,
      },
    ],
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1, smelt: 1 },
      { id: 'fine', name: '精良', weight: 30, mult: 1.15, affix: 1, sell: 2, smelt: 2 },
    ],
    affixPool: [{ name: '锐锋', stat: 'atk', scale: 0.3 }],
    config: { gear: { shardItem: 'shard', reforgeCost: 5 } },
  } as unknown as GameContent;
}

describe('#39 · 入账咽喉：统一账本事件（与旧形状并行发射）', () => {
  it('采集入账：kind=item 冻结卖价、kind=exp value=0（修为不折灵石）；改价不追溯', () => {
    const pack = makePack();
    const clock = new ManualClock();
    const game = createGame({ content: pack, clock, rng: () => 0.9 }); // 无副产出
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(3000);
    game.tick(3000);

    const first = ledgerEntries(game.events.drain());
    expect(first).toEqual([
      { kind: 'item', source: 'gather', origin: 'idle', id: 'herb1', count: 1, value: 4 },
      { kind: 'exp', source: 'gather', origin: 'idle', id: 'herb', count: 6, value: 0 },
    ]);

    // value 冻结（验收 2）：入账后改 content 卖价 → 已发事件不变，新入账用新价。
    (pack as { items: Array<{ sell: number }> }).items[0]!.sell = 7;
    clock.advance(3000);
    game.tick(3000);
    expect(first[0]?.value).toBe(4);
    const second = ledgerEntries(game.events.drain());
    expect(second[0]).toMatchObject({ kind: 'item', id: 'herb1', count: 1, value: 7 });
  });

  it('手动收支：卖出/买入/服用带 origin=user、货币带符号（消耗为负）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makePack(),
      clock,
      save: {
        version: 1,
        time: 0,
        state: { gold: 100, hp: 50, items: { herb1: 10, consumable_heal: 2 }, skills: {}, activity: null },
      },
    });
    game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 4 } });
    game.dispatch({ type: 'shop:buy', payload: { item: 'consumable_heal', count: 1 } });
    game.dispatch({ type: 'consumable:eat', payload: { item: 'consumable_heal' } });

    const entries = ledgerEntries(game.events.drain());
    expect(entries).toContainEqual({ kind: 'item', source: 'sell', origin: 'user', id: 'herb1', count: -4, value: 4 });
    expect(entries).toContainEqual({ kind: 'currency', source: 'sell', origin: 'user', id: 'gold', count: 16, value: 1 });
    expect(entries).toContainEqual({ kind: 'currency', source: 'buy', origin: 'user', id: 'gold', count: -45, value: 1 });
    expect(entries).toContainEqual({ kind: 'item', source: 'buy', origin: 'user', id: 'consumable_heal', count: 1, value: 18 });
    expect(entries).toContainEqual({ kind: 'item', source: 'eat', origin: 'user', id: 'consumable_heal', count: -1, value: 18 });
    const st = stateOf(game.snapshot());
    expect(st.gold).toBe(71); // 100 + 16 − 45
  });

  it('战斗胜利：灵石/装备实例/修为入账（gear 带 uid/rarity，value=gearSell 折算）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCombatPack(),
      clock,
      rng: () => 0.4,
      // 关自动再战：恰好一场胜利，事件队列不被 256 上限裁剪，可精确断言。
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: {}, skills: { fight: { xp: 0 } }, activity: null, autoFight: false },
      },
    });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 600 && stateOf(game.snapshot()).combat; i++) {
      clock.advance(100);
      game.tick(100);
    }
    const events = game.events.drain();
    const entries = ledgerEntries(events);
    const victories = events.filter((e) => e.type === 'victory').length;
    expect(victories).toBe(1);
    // rng 恒 0.4：灵石 roll = floor(4 + 0.4×7) = 6；core1 不中（0.4 ≥ 0.25）；器胚必中（0.4 < 0.5）
    expect(entries).toEqual([
      { kind: 'currency', source: 'combat', origin: 'idle', id: 'gold', count: 6, value: 1 },
      { kind: 'gear', source: 'combat', origin: 'idle', id: 'scorp_tail', uid: 1, rarity: 'common', count: 1, value: 25 },
      { kind: 'exp', source: 'combat', origin: 'idle', id: 'fight', count: 16, value: 0 },
    ]);
    const st = stateOf(game.snapshot());
    expect(st.gold).toBe(6);
    expect(st.gear).toHaveLength(1);
  });

  it('同种子在线/离线对称：等量结算的账本事件聚合相等，离线全量 offline 标注', () => {
    // 无副产出的确定性活动：副产出的离线统计式（floor(期望)+余数掷定）与在线
    // 逐轮掷点是两个无偏估计量，同种子也不逐项相等——对称断言钉确定性路径。
    const pack = {
      skills: [
        {
          id: 'herb',
          name: '采药',
          icon: '药',
          kind: 'gather',
          activities: [{ name: '采灵砂', unlockLevel: 1, interval: 3000, exp: 6, output: { item: 'ore', count: 2 } }],
        },
      ],
      items: [{ id: 'ore', name: '灵砂', icon: '砂', type: 'mat', sell: 2 }],
    } as GameContent;
    const runOnline = () => {
      const clock = new ManualClock();
      const game = createGame({ content: pack, clock, rng: () => 0.4 });
      game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
      game.events.drain();
      for (let i = 0; i < 20; i++) {
        clock.advance(3000);
        game.tick(3000);
      }
      return { st: stateOf(game.snapshot()), entries: ledgerEntries(game.events.drain()) };
    };
    const runOffline = () => {
      const clock = new ManualClock();
      const game = createGame({ content: pack, clock, rng: () => 0.4 });
      game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
      game.events.drain();
      game.settleOffline(60000);
      return { st: stateOf(game.snapshot()), entries: ledgerEntries(game.events.drain()) };
    };
    const online = runOnline();
    const offline = runOffline();
    expect(aggregate(offline.entries)).toEqual(aggregate(online.entries));
    expect(online.entries.every((e) => e.offline !== true)).toBe(true);
    expect(offline.entries.every((e) => e.offline === true)).toBe(true);
    expect(offline.st.items).toEqual(online.st.items);
    expect(offline.st.skills).toEqual(online.st.skills);
  });

  it('卡5 对拍：非整乘数下在线逐循环累计 == 离线批量（每循环舍入口径）', () => {
    // exp=10 × gatherXp 1.05：每循环 round(10.5)=11 → 在线 3 轮 = 33；
    // 旧离线整批口径 round(31.5)=32 分叉，裁决后同式累加 = 33。
    const pack = {
      skills: [
        {
          id: 'herb',
          name: '采药',
          icon: '药',
          kind: 'gather',
          activities: [{ name: '采灵砂', unlockLevel: 1, interval: 3000, exp: 10, output: { item: 'ore', count: 1 } }],
        },
      ],
      items: [{ id: 'ore', name: '灵砂', icon: '砂', type: 'mat', sell: 2 }],
    } as GameContent;
    const contributions = [
      {
        modifier: { stat: 'gatherXp', zone: 'mult', value: 1.05 },
        source: { id: 'paragon', kind: 'test', name: '对拍' },
      },
    ];
    const run = (offline: boolean) => {
      const clock = new ManualClock();
      const game = createGame({ content: pack, clock, rng: () => 0.9, contributions });
      game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
      game.events.drain();
      if (offline) game.settleOffline(9000);
      else
        for (let i = 0; i < 3; i++) {
          clock.advance(3000);
          game.tick(3000);
        }
      return stateOf(game.snapshot()).skills.herb?.xp ?? 0;
    };
    expect(run(false)).toBe(33);
    expect(run(true)).toBe(run(false));
  });

  it('离线装备产出必发账本事件（在线/离线不对称硬伤补齐）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeLedgerPack(),
      clock,
      rng: () => 0.4,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 50,
          items: { herb1: 40 }, // 10 轮量（每轮 1）
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 1, name: '锻青锋剑', progress: 0 },
        },
      },
    });
    game.settleOffline(20000); // 10 轮
    const gear = ledgerEntries(game.events.drain()).filter((e) => e.kind === 'gear');
    expect(gear).toHaveLength(10);
    for (const e of gear) {
      expect(e).toMatchObject({ source: 'craft', id: 'sword1', count: 1, value: 30, rarity: 'common', offline: true });
      expect(typeof e.uid).toBe('number');
    }
    expect(stateOf(game.snapshot()).gear).toHaveLength(10);
  });
});

describe('#39 · 自动折叠挂点（D3/D10：缺省 no-op，规则形状归 #35/#36）', () => {
  it('缺省 no-op：恒 undefined 挂点与无挂点零行为差异（状态 + 全量事件逐条相等）', () => {
    const run = (autoFold?: AutoFoldRule) => {
      const clock = new ManualClock();
      const game = createGame({ content: makeCombatPack(), clock, rng: () => 0.4, autoFold });
      game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
      for (let i = 0; i < 600 && stateOf(game.snapshot()).combat; i++) {
        clock.advance(100);
        game.tick(100);
      }
      game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
      for (let i = 0; i < 5; i++) {
        clock.advance(3000);
        game.tick(3000);
      }
      game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 2 } });
      return { st: stateOf(game.snapshot()), events: game.events.drain() };
    };
    const plain = run();
    const noop = run(() => undefined);
    expect(noop.st).toEqual(plain.st);
    expect(noop.events).toEqual(plain.events);
  });

  it('挂点只挂配方/敌人两类（CONTEXT 词汇）：buy 等其余来源不咨询挂点', () => {
    const clock = new ManualClock();
    const consulted: string[] = [];
    const game = createGame({
      content: makePack(),
      clock,
      save: {
        version: 1,
        time: 0,
        state: { gold: 100, hp: 50, items: { herb1: 4 }, skills: {}, activity: null },
      },
      autoFold: (c) => {
        consulted.push(c.source);
        return 'sell';
      },
    });
    game.dispatch({ type: 'shop:buy', payload: { item: 'consumable_heal', count: 1 } });
    const st = stateOf(game.snapshot());
    expect(st.items.consumable_heal).toBe(1); // 未被折叠：买入入袋
    expect(st.gold).toBe(55); // 100 − 45
    expect(consulted).toEqual([]); // buy 挂点不可达
  });

  it('入账即折（sell）：物品不进袋、成对事件、旧 loot 静默', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeLedgerPack(),
      clock,
      rng: () => 0.1,
      autoFold: (c) => (c.source === 'craft' && c.itemId === 'pill1' ? 'sell' : undefined),
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 50,
          items: { herb1: 10 },
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 0, name: '炼制聚气丹', progress: 0 },
        },
      },
    });
    for (let i = 0; i < 2; i++) {
      clock.advance(3000);
      game.tick(3000);
    }
    const events = game.events.drain();
    expect(ledgerEntries(events)).toEqual([
      // 第 1 轮：扣料 → 被折叠丹药标记（count=0/value=0 会计不计）+ 折得灵石 + 修为
      { kind: 'item', source: 'craft', origin: 'idle', id: 'herb1', count: -2, value: 4 },
      { kind: 'item', source: 'craft', origin: 'idle', id: 'pill1', count: 0, value: 0, auto: 'sell' },
      { kind: 'currency', source: 'craft', origin: 'idle', id: 'gold', count: 50, value: 1, auto: 'sell' },
      { kind: 'exp', source: 'craft', origin: 'idle', id: 'smith', count: 8, value: 0 },
      // 第 2 轮同构
      { kind: 'item', source: 'craft', origin: 'idle', id: 'herb1', count: -2, value: 4 },
      { kind: 'item', source: 'craft', origin: 'idle', id: 'pill1', count: 0, value: 0, auto: 'sell' },
      { kind: 'currency', source: 'craft', origin: 'idle', id: 'gold', count: 50, value: 1, auto: 'sell' },
      { kind: 'exp', source: 'craft', origin: 'idle', id: 'smith', count: 8, value: 0 },
    ]);
    expect(events.some((e) => e.type === 'loot' || e.type === 'sell')).toBe(false); // 完全静默
    const st = stateOf(game.snapshot());
    expect(st.items.pill1).toBeUndefined(); // 乾坤袋无残留
    expect(st.gold).toBe(100); // 2 × 50
  });

  it('入账即折（smelt）：装备实例不进袋、折器屑（按稀有度 smelt 字段）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeLedgerPack(),
      clock,
      rng: () => 0.4, // rarity roll → common（smelt 1）
      autoFold: (c) => (c.source === 'craft' && c.itemId === 'sword1' ? 'smelt' : undefined),
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 50,
          items: { herb1: 10 },
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 1, name: '锻青锋剑', progress: 0 },
        },
      },
    });
    clock.advance(2000);
    game.tick(2000);
    const events = game.events.drain();
    expect(ledgerEntries(events)).toEqual([
      { kind: 'item', source: 'craft', origin: 'idle', id: 'herb1', count: -1, value: 4 },
      { kind: 'gear', source: 'craft', origin: 'idle', id: 'sword1', uid: 1, rarity: 'common', count: 0, value: 0, auto: 'smelt' },
      { kind: 'item', source: 'craft', origin: 'idle', id: 'shard', count: 1, value: 3, auto: 'smelt' },
      { kind: 'exp', source: 'craft', origin: 'idle', id: 'smith', count: 10, value: 0 },
    ]);
    expect(events.some((e) => e.type === 'loot' || e.type === 'gear:smelt')).toBe(false); // 完全静默
    const st = stateOf(game.snapshot());
    expect(st.gear).toHaveLength(0); // 实例未进乾坤袋
    expect(st.items.shard).toBe(1);
  });

  it('0 卖价物品折 sell：只发标记、不发零额折得物（与「0 变化不入账」同律）', () => {
    const pack = {
      skills: [{ id: 'smith', name: '炼器', icon: '器', kind: 'craft' }],
      items: [
        { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
        { id: 'ash', name: '尘灰', icon: '尘', type: 'mat', sell: 0 },
      ],
      recipes: [
        {
          name: '炼尘灰',
          skill: 'smith',
          unlockLevel: 1,
          output: { item: 'ash', count: 1 },
          materials: { herb1: 1 },
          successRate: 1,
          interval: 2000,
          exp: 1,
        },
      ],
    } as GameContent;
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      rng: () => 0.5,
      autoFold: (c) => (c.itemId === 'ash' ? 'sell' : undefined),
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 50,
          items: { herb1: 5 },
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 0, name: '炼尘灰', progress: 0 },
        },
      },
    });
    clock.advance(2000);
    game.tick(2000);
    expect(ledgerEntries(game.events.drain())).toEqual([
      { kind: 'item', source: 'craft', origin: 'idle', id: 'herb1', count: -1, value: 4 },
      { kind: 'item', source: 'craft', origin: 'idle', id: 'ash', count: 0, value: 0, auto: 'sell' },
      { kind: 'exp', source: 'craft', origin: 'idle', id: 'smith', count: 1, value: 0 },
    ]);
    expect(stateOf(game.snapshot()).gold).toBe(0);
  });
});

describe('#39 · 道韵账本与访问段信号', () => {
  it('兵解得道韵 / 点天赋耗道韵：currency daoYun 带符号入账（value=0 无灵石等价）', () => {
    const pack = {
      ...makeCombatPack(),
      rebirth: {
        reset: ['skills', 'items', 'gold', 'buffs', 'lastEncounter'],
        keep: ['gear'],
        formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
        talents: [
          { id: 't_atk', name: '锐金诀', cost: 1, effects: [{ stat: 'atk', zone: 'flat', value: 3 }] },
        ],
        unlocks: [],
        realms: [{ level: 1, name: '练气' }],
      },
    } as GameContent;
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      seed: 7,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 112,
          items: {},
          skills: { herb: { xp: 5000 } }, // totalXp 5000 → gain = 5
          activity: null,
        },
      },
    });
    game.dispatch({ type: 'rebirth:perform' });
    game.dispatch({ type: 'talent:buy', payload: { nodeId: 't_atk' } });
    const entries = ledgerEntries(game.events.drain());
    expect(entries).toContainEqual({ kind: 'currency', source: 'rebirth', origin: 'user', id: 'daoYun', count: 5, value: 0 });
    expect(entries).toContainEqual({ kind: 'currency', source: 'talent', origin: 'user', id: 'daoYun', count: -1, value: 0 });
    expect(stateOf(game.snapshot()).daoYun).toBe(4);
  });

  it('visit:begin/end 纯转发（引擎不持段状态），坏载荷拒绝', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock });
    game.dispatch({ type: 'visit:begin', payload: { page: 'shop' } });
    game.dispatch({ type: 'visit:begin', payload: { page: 'shop' } }); // 重复开段照发（配对归壳层）
    game.dispatch({ type: 'visit:end', payload: { page: 'shop' } });
    const seen = game.events.drain().map((e) => [e.type, e.data?.page]);
    expect(seen).toEqual([
      ['visit:begin', 'shop'],
      ['visit:begin', 'shop'],
      ['visit:end', 'shop'],
    ]);
    game.dispatch({ type: 'visit:begin', payload: { page: '' } });
    expect(game.events.drain()[0]).toMatchObject({ type: 'reject', data: { action: 'visit:begin', reason: 'bad-payload' } });
  });
});
