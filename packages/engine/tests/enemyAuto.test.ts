import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  createGame,
  type GameAction,
  type GameContent,
  type GameEvent,
  type GameState,
  type LedgerData,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

function stateOf(save: SaveData): GameState {
  return save.state as unknown as GameState;
}

function ledgerEntries(events: GameEvent[]): LedgerData[] {
  return events.filter((e) => e.type === 'ledger').map((e) => e.data as LedgerData);
}

/**
 * #36 敌人自动化夹具：makeCombatPack 之上的确定性变体——e1 调成木桩
 *（atk 1 / 十万毫秒出招，防玩家战损扰动断言）、材料/器胚双掉落掷定门槛
 * 拉满（chance 0.99：常量掷点 0.1/0.85 均命中）、rarities 补 smelt 产屑数、
 * 器屑经济入 config、坊市加 core1（挂点不可达反证用）。
 * 掷点映射（权重 70/20/8/2，总量 100）：0.1→寻常、0.85→精良；
 * e1 灵石 {4..10}：floor(4 + r×7)；寻常/精良卖价倍率 1/2、产屑 1/2。
 */
function makeEnemyAutoPack(): GameContent {
  const base = makeCombatPack();
  return {
    ...base,
    items: [...base.items, { id: 'shard', name: '器屑', icon: '屑', type: 'mat', sell: 3 }],
    enemies: base.enemies.map((enemy) =>
      enemy.id === 'e1'
        ? {
            ...enemy,
            hp: 30,
            atk: 1,
            def: 0,
            attackInterval: 100000,
            drops: [{ item: 'core1', chance: 0.99 }],
          }
        : enemy,
    ),
    shop: [...base.shop, { item: 'core1', price: 10 }],
    gearDrops: [{ enemy: 'e1', chance: 0.99, pool: ['scorp_tail'] }],
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1, smelt: 1 },
      { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2, smelt: 2 },
      { id: 'rare', name: '罕见', weight: 8, mult: 1.3, affix: 2, sell: 4, smelt: 4 },
      { id: 'epic', name: '绝世', weight: 2, mult: 1.5, affix: 3, sell: 10, smelt: 8, showcase: true },
    ],
    config: { gear: { shardItem: 'shard', reforgeCost: 5 } },
  } as unknown as GameContent;
}

/** 兵解可用包（否则 not-available 拒发、本测空转——#35 复核教训）。 */
function makeRebirthPack(): GameContent {
  return {
    ...makeEnemyAutoPack(),
    rebirth: {
      reset: ['skills', 'items', 'gold', 'buffs', 'lastEncounter'],
      keep: ['gear'],
      formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
      talents: [],
      unlocks: [],
      realms: [],
    },
  } as unknown as GameContent;
}

/** 成就奖励包（击杀触发发 core1，挂点不可达反证用）。 */
function makeAchPack(): GameContent {
  return {
    ...makeEnemyAutoPack(),
    achievements: [
      {
        id: 'first_kill',
        name: '初胜',
        condition: { stat: 'kills', op: 'gte', target: 1 },
        reward: { items: [{ item: 'core1', count: 2 }] },
      },
    ],
  } as unknown as GameContent;
}

function saveWith(extra: Record<string, unknown> = {}): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 112,
      items: {},
      skills: { fight: { xp: 0 } },
      activity: null,
      autoFight: false,
      ...extra,
    },
  };
}

/** 常量掷点（rollRarity 映射：0.1→寻常、0.85→精良）。 */
const roll = (v: number) => ({ rng: () => v });

/**
 * 开战打到累计 n 胜（假时钟 100ms 步进；e1 木桩 + 常量掷点 = 确定性战斗）。
 * 复战前须 combat:stop 清场（同敌幂等替换语义下 combat:start 不重开）。
 */
function fightWins(
  game: ReturnType<typeof createGame>,
  clock: ManualClock,
  victories: { n: number },
  wins: number,
): void {
  game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
  for (let i = 0; i < 3000 && victories.n < wins; i++) {
    clock.advance(100);
    game.tick(100);
  }
  expect(victories.n).toBe(wins); // 防测试空转：战斗确已终结
}

/** 胜利计数订阅（victory 事件驱动）。 */
function victoryCounter(game: ReturnType<typeof createGame>): { n: number } {
  const counter = { n: 0 };
  game.events.subscribe((e) => {
    if (e.type === 'victory') counter.n += 1;
  });
  return counter;
}

describe('#36 · 敌人自动化规则：三态互斥 + 缺省不处理', () => {
  it('缺省不处理：无规则掉落照常入袋；设自动售卖即折；mode=none 删条目回缺省（AC7）', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeEnemyAutoPack(), clock, save: saveWith(), ...roll(0.1) });
    const victories = victoryCounter(game);

    // 缺省 = 不处理：掉落全入袋
    fightWins(game, clock, victories, 1);
    let st = stateOf(game.snapshot());
    expect(st.items.core1).toBe(1);
    expect(st.gear).toHaveLength(1);
    expect(st.enemyAuto).toEqual({});

    // 设自动售卖 → 入账即折（旧产出不追溯：core1 旧件仍在，新掉落不落袋）
    game.dispatch({ type: 'combat:stop' });
    game.dispatch({ type: 'enemy:auto', payload: { enemyId: 'e1', mode: 'sell', maxRarity: 'common' } });
    expect(stateOf(game.snapshot()).enemyAuto).toEqual({ e1: { mode: 'sell', maxRarity: 'common' } });
    fightWins(game, clock, victories, 2);
    st = stateOf(game.snapshot());
    expect(st.items.core1).toBe(1); // 存量不追溯，新掉落不落袋
    expect(st.gear).toHaveLength(1);
    expect(st.gold).toBe(4 + 4 + 25 + 25); // 两胜灵石 + 折 core1 + 折器胚

    // 三态互斥：单选覆盖（sell → smelt 同一条目换态）
    game.dispatch({ type: 'combat:stop' });
    game.dispatch({ type: 'enemy:auto', payload: { enemyId: 'e1', mode: 'smelt', maxRarity: 'fine' } });
    expect(stateOf(game.snapshot()).enemyAuto).toEqual({ e1: { mode: 'smelt', maxRarity: 'fine' } });

    // mode=none = 清除规则（回缺省不处理；垃圾阈值不阻断清除——清除契约，复核收口）
    game.dispatch({ type: 'enemy:auto', payload: { enemyId: 'e1', mode: 'none', maxRarity: 'ghost' } });
    expect(stateOf(game.snapshot()).enemyAuto).toEqual({});
    fightWins(game, clock, victories, 3);
    st = stateOf(game.snapshot());
    expect(st.items.core1).toBe(2); // 回缺省后掉落照常入袋
    expect(st.gear).toHaveLength(2);
  });

  it('载荷守卫：坏载荷（未知敌人/缺模式/未知模式/未知稀有度/缺阈值）reject bad-payload', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeEnemyAutoPack(), clock, save: saveWith() });
    const bad: GameAction[] = [
      { type: 'enemy:auto', payload: { enemyId: 'ghost', mode: 'sell', maxRarity: 'common' } },
      { type: 'enemy:auto', payload: { enemyId: 'e1' } },
      // 畸形注入面（mode 非法）：绕过编译面直发，运行时守卫必须接住（#35 同律）。
      ({ type: 'enemy:auto', payload: { enemyId: 'e1', mode: 'nonsense' } } as unknown) as GameAction,
      { type: 'enemy:auto', payload: { enemyId: 'e1', mode: 'sell', maxRarity: 'ghost' } },
      // 域一致性：非 none 态恒带在册阈值（UI 恒补最低档）。
      { type: 'enemy:auto', payload: { enemyId: 'e1', mode: 'sell' } },
    ];
    for (const action of bad) game.dispatch(action);
    const rejects = game.events.drain().filter((e) => e.type === 'reject');
    expect(rejects).toHaveLength(5);
    expect(stateOf(game.snapshot()).enemyAuto).toEqual({});
  });
});

describe('#36 · 入账即折：击杀掉落（AC1/AC2）', () => {
  it('自动售卖：物品+装备≤阈值折灵石不落袋、成对事件、完全静默（旧 loot 不发）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeEnemyAutoPack(),
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'sell', maxRarity: 'common' } } }),
      ...roll(0.1),
    });
    const victories = victoryCounter(game);
    fightWins(game, clock, victories, 1);

    const st = stateOf(game.snapshot());
    expect(st.items.core1).toBeUndefined(); // 物品直接卖、不落袋
    expect(st.gear).toEqual([]); // 装备≤阈值卖、不落袋
    expect(st.gold).toBe(4 + 25 + 25); // 胜利灵石 + 折 core1(25) + 折器胚(寻常 25)

    const events = game.events.drain();
    const entries = ledgerEntries(events);
    // 成对事件（D10）：被折标记（count=0 会计不计）+ 折得灵石；胜利灵石与修为照常。
    expect(entries).toEqual([
      { kind: 'currency', source: 'combat', origin: 'idle', id: 'gold', count: 4, value: 1 },
      { kind: 'item', source: 'combat', origin: 'idle', id: 'core1', count: 0, value: 0, auto: 'sell' },
      { kind: 'currency', source: 'combat', origin: 'idle', id: 'gold', count: 25, value: 1, auto: 'sell' },
      {
        kind: 'gear',
        source: 'combat',
        origin: 'idle',
        id: 'scorp_tail',
        uid: 1,
        rarity: 'common',
        count: 0,
        value: 0,
        auto: 'sell',
      },
      { kind: 'currency', source: 'combat', origin: 'idle', id: 'gold', count: 25, value: 1, auto: 'sell' },
      { kind: 'exp', source: 'combat', origin: 'idle', id: 'fight', count: 16, value: 0 },
    ]);
    // 完全静默：折叠路径不发旧 loot，显示面不虚报折叠品。
    expect(events.filter((e) => e.type === 'loot')).toEqual([]);
    const victory = events.find((e) => e.type === 'victory');
    if (victory?.type === 'victory') {
      expect(victory.data.drops).toEqual([]);
      expect(victory.data.gearDropName).toBeUndefined();
    }
  });

  it('自动熔炼：普通物品照常入袋、仅装备≤阈值折器屑（AC2）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeEnemyAutoPack(),
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'smelt', maxRarity: 'common' } } }),
      ...roll(0.1),
    });
    const victories = victoryCounter(game);
    fightWins(game, clock, victories, 1);

    const st = stateOf(game.snapshot());
    expect(st.items.core1).toBe(1); // 普通物品照常入袋（材料是炼丹经济上游，防误卖）
    expect(st.items.shard).toBe(1); // 寻常档产屑 1
    expect(st.gear).toEqual([]);
    const entries = ledgerEntries(game.events.drain());
    expect(entries).toEqual([
      { kind: 'currency', source: 'combat', origin: 'idle', id: 'gold', count: 4, value: 1 },
      { kind: 'item', source: 'combat', origin: 'idle', id: 'core1', count: 1, value: 25 },
      {
        kind: 'gear',
        source: 'combat',
        origin: 'idle',
        id: 'scorp_tail',
        uid: 1,
        rarity: 'common',
        count: 0,
        value: 0,
        auto: 'smelt',
      },
      { kind: 'item', source: 'combat', origin: 'idle', id: 'shard', count: 1, value: 3, auto: 'smelt' },
      { kind: 'exp', source: 'combat', origin: 'idle', id: 'fight', count: 16, value: 0 },
    ]);
  });

  it('稀有度阈值：≤阈值折 / >阈值入袋（rarities 数组序，AC1）', () => {
    // 精良器胚（0.85 掷点）> 阈值寻常 → 入袋不折；物品在售卖态照常全折
    const clock = new ManualClock();
    const game = createGame({
      content: makeEnemyAutoPack(),
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'sell', maxRarity: 'common' } } }),
      ...roll(0.85),
    });
    const victories = victoryCounter(game);
    fightWins(game, clock, victories, 1);
    let st = stateOf(game.snapshot());
    expect(st.gear).toHaveLength(1); // 精良 > 寻常：入袋
    expect(st.gear[0]).toMatchObject({ itemId: 'scorp_tail', rarity: 'fine' });
    expect(st.items.core1).toBeUndefined();
    expect(st.gold).toBe(9 + 25); // 灵石 floor(4+0.85×7)=9 + 折 core1

    // 阈值提到精良 → 同掷点整套折叠（卖价 = 器胚 25 × 档位倍率 2 = 50）
    const clock2 = new ManualClock();
    const game2 = createGame({
      content: makeEnemyAutoPack(),
      clock: clock2,
      save: saveWith({ enemyAuto: { e1: { mode: 'sell', maxRarity: 'fine' } } }),
      ...roll(0.85),
    });
    const victories2 = victoryCounter(game2);
    fightWins(game2, clock2, victories2, 1);
    st = stateOf(game2.snapshot());
    expect(st.gear).toEqual([]);
    expect(st.gold).toBe(9 + 25 + 50);
  });

  it('熔炼阈值双侧：>阈值装备照常入袋、≤阈值按档折屑（精良产屑 2，AC2）', () => {
    // 精良器胚（0.85 掷点）> 阈值寻常 → 照常入袋；材料在熔炼态恒入袋
    const clock = new ManualClock();
    const game = createGame({
      content: makeEnemyAutoPack(),
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'smelt', maxRarity: 'common' } } }),
      ...roll(0.85),
    });
    const victories = victoryCounter(game);
    fightWins(game, clock, victories, 1);
    let st = stateOf(game.snapshot());
    expect(st.gear).toHaveLength(1);
    expect(st.gear[0]).toMatchObject({ itemId: 'scorp_tail', rarity: 'fine' });
    expect(st.items.core1).toBe(1); // 普通物品照常入袋
    expect(st.items.shard).toBeUndefined(); // >阈值不折

    // 阈值提到精良 → 同掷点折屑：精良档产屑 2（夹具 rarities smelt 映射）
    const clock2 = new ManualClock();
    const game2 = createGame({
      content: makeEnemyAutoPack(),
      clock: clock2,
      save: saveWith({ enemyAuto: { e1: { mode: 'smelt', maxRarity: 'fine' } } }),
      ...roll(0.85),
    });
    const victories2 = victoryCounter(game2);
    fightWins(game2, clock2, victories2, 1);
    st = stateOf(game2.snapshot());
    expect(st.gear).toEqual([]);
    expect(st.items.shard).toBe(2);
    expect(st.items.core1).toBe(1);
  });

  it('boss 专属掉落随主敌规则折叠（申报口径：「该怪全部掉落」含 bosses[].drops）', () => {
    // 归属隔离：e1 材料池掏空、器胚池摘除，core1 只出 boss 池。
    const base = makeEnemyAutoPack() as unknown as {
      enemies: Array<Record<string, unknown>>;
    };
    const pack = {
      ...base,
      enemies: base.enemies.map((e) => (e.id === 'e1' ? { ...e, drops: [] } : e)),
      gearDrops: [],
      bosses: [
        {
          enemy: 'e1',
          drops: [{ item: 'core1', chance: 0.99 }],
          phases: [{ threshold: 0, name: '凶性' }],
        },
      ],
    } as unknown as GameContent;
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'sell', maxRarity: 'common' } } }),
      ...roll(0.1),
    });
    const victories = victoryCounter(game);
    fightWins(game, clock, victories, 1);
    const st = stateOf(game.snapshot());
    expect(st.items.core1).toBeUndefined(); // boss 池掉落照折、不落袋
    expect(st.gold).toBe(4 + 25);
    const entries = ledgerEntries(game.events.drain());
    expect(entries.filter((e) => e.auto === 'sell')).toEqual([
      { kind: 'item', source: 'combat', origin: 'idle', id: 'core1', count: 0, value: 0, auto: 'sell' },
      { kind: 'currency', source: 'combat', origin: 'idle', id: 'gold', count: 25, value: 1, auto: 'sell' },
    ]);
  });
});

describe('#36 · 熔炼可用性门控（AC4）', () => {
  it('无 shardItem 的包：注入存量 smelt 规则不转化、不记自动账、零崩溃', () => {
    const pack = makeEnemyAutoPack();
    delete (pack as { config?: unknown }).config; // 无器屑经济
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'smelt', maxRarity: 'common' } } }),
      ...roll(0.1),
    });
    const victories = victoryCounter(game);
    fightWins(game, clock, victories, 1);
    const st = stateOf(game.snapshot());
    const entries = ledgerEntries(game.events.drain());
    expect(st.gear).toHaveLength(1); // 不转化：照常入袋
    expect(st.items.core1).toBe(1);
    expect(entries.every((e) => e.auto === undefined)).toBe(true); // 不记自动账
    expect(entries.find((e) => e.kind === 'gear')).toMatchObject({ count: 1, id: 'scorp_tail' });
  });
});

describe('#36 · 判定只挂战斗掉落来源（AC3/AC8）', () => {
  it('坊市购买/成就奖励不入敌人判定：照常入袋、零自动账', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeAchPack(),
      clock,
      save: saveWith({ gold: 50, enemyAuto: { e1: { mode: 'sell', maxRarity: 'common' } } }),
      ...roll(0.1),
    });
    const victories = victoryCounter(game);
    game.dispatch({ type: 'shop:buy', payload: { item: 'core1', count: 1 } }); // 买入入袋
    fightWins(game, clock, victories, 1); // 击杀掉落入账即折 + 成就奖励发 core1×2

    const st = stateOf(game.snapshot());
    expect(st.items.core1).toBe(3); // 买入 1 + 奖励 2（掉落已折、不落袋）
    expect(st.gold).toBe(50 - 10 + 4 + 25 + 25);
    const entries = ledgerEntries(game.events.drain());
    expect(entries.filter((e) => e.source === 'buy')).toEqual([
      { kind: 'currency', source: 'buy', origin: 'user', id: 'gold', count: -10, value: 1 },
      { kind: 'item', source: 'buy', origin: 'user', id: 'core1', count: 1, value: 25 },
    ]);
    expect(entries.filter((e) => e.source === 'achievement')).toEqual([
      { kind: 'item', source: 'achievement', origin: 'idle', id: 'core1', count: 2, value: 25 },
    ]);
    // 非掉落来源绝无自动账；自动账恰为掉折叠的两对。
    expect(entries.filter((e) => e.auto !== undefined)).toHaveLength(4);
  });

  it('兵解保留资产不入敌人判定：袋内装备原样保留、规则兵解保留（防测试空转断言在内）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeRebirthPack(),
      clock,
      save: saveWith({
        gold: 50,
        // 总修为 20000 → daoYunGain = floor(0.001 × 20000) = 20 → 兵解确有道韵入账行可验。
        skills: { fight: { xp: 20000 } },
        gear: [{ uid: 1, itemId: 'scorp_tail', rarity: 'common', affixes: [] }],
        enemyAuto: { e1: { mode: 'smelt', maxRarity: 'fine' } },
      }),
    });
    game.dispatch({ type: 'rebirth:perform' });
    const st = stateOf(game.snapshot());
    expect(st.rebirths).toBe(1); // 兵解确实发生（防本测空转）
    expect(st.gear).toHaveLength(1); // 保留资产原样（不折不熔）
    const entries = ledgerEntries(game.events.drain());
    expect(entries).toEqual([
      // 兵解入账只有道韵结算一笔（#39 口径），绝无自动折叠账。
      { kind: 'currency', source: 'rebirth', origin: 'user', id: 'daoYun', count: 20, value: 0 },
    ]);
    expect(st.enemyAuto).toEqual({ e1: { mode: 'smelt', maxRarity: 'fine' } }); // 规则兵解保留（AC5）
  });

  it('佩戴装备不受影响（AC8）：身上装备不被规则折叠，新掉落照折', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeEnemyAutoPack(),
      clock,
      save: saveWith({
        gear: [{ uid: 1, itemId: 'scorp_tail', rarity: 'common', affixes: [] }],
        enemyAuto: { e1: { mode: 'sell', maxRarity: 'epic' } },
      }),
      ...roll(0.1),
    });
    game.dispatch({ type: 'gear:equip', payload: { uid: 1 } });
    expect(stateOf(game.snapshot()).equips.weapon).toBe(1);
    const victories = victoryCounter(game);
    fightWins(game, clock, victories, 1);
    const st = stateOf(game.snapshot());
    expect(st.equips.weapon).toBe(1); // 佩戴装备永不参与
    // 佩戴实例常驻实例表（equips 是槽位→uid 引用）；新掉落（uid 2）照折不留。
    expect(st.gear).toHaveLength(1);
    expect(st.gear[0]).toMatchObject({ uid: 1, itemId: 'scorp_tail' });
  });
});

describe('#36 · 秘境共用（AC6）', () => {
  it('同一敌人在秘境沿用规则：掉落照折；层奖励不过判定照常入账', () => {
    const pack = {
      ...makeEnemyAutoPack(),
      dungeons: [
        {
          id: 'd1',
          name: '试炼窟',
          floors: 1,
          layers: [
            {
              floor: { min: 1, max: 1 },
              enemies: [{ enemy: 'e1', weight: 1 }],
              rewards: { gold: 5, items: [{ item: 'core1', count: 1 }] },
            },
          ],
        },
      ],
    } as unknown as GameContent;
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'sell', maxRarity: 'common' } } }),
      ...roll(0.1),
    });
    const victories = victoryCounter(game);
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'd1' } });
    for (let i = 0; i < 3000 && victories.n < 1; i++) {
      clock.advance(100);
      game.tick(100);
    }
    expect(victories.n).toBe(1); // 防测试空转

    const st = stateOf(game.snapshot());
    expect(st.items.core1).toBe(1); // 层奖励 core1 入袋（非掉落来源不过判定）
    expect(st.gear).toEqual([]); // 秘境掉落照折（同敌同规则）
    const entries = ledgerEntries(game.events.drain());
    // 层奖励（source='dungeon'）绝无自动账；掉折叠两对 auto='sell'。
    expect(entries.filter((e) => e.source === 'dungeon')).toEqual([
      { kind: 'currency', source: 'dungeon', origin: 'idle', id: 'gold', count: 5, value: 1 },
      { kind: 'item', source: 'dungeon', origin: 'idle', id: 'core1', count: 1, value: 25 },
    ]);
    expect(entries.filter((e) => e.auto === 'sell')).toHaveLength(4);
  });
});

describe('#36 · 离线不触发（AC8：离线不可战斗语义不变）', () => {
  it('战斗态离线即散、规则不触发、零自动账', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeEnemyAutoPack(),
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'sell', maxRarity: 'common' } } }),
      ...roll(0.1),
    });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } }); // 战斗中下线
    game.settleOffline(60000);

    const st = stateOf(game.snapshot());
    expect(st.combat).toBeNull(); // 离线不可战斗：视作离场休整
    expect(st.items.core1).toBeUndefined();
    expect(st.gear).toEqual([]);
    expect(st.enemyAuto).toEqual({ e1: { mode: 'sell', maxRarity: 'common' } }); // 规则不动
    expect(ledgerEntries(game.events.drain())).toEqual([]); // 零掉落、零自动账
  });
});

describe('#36 · 存档持久化纪律（AC5/AC7：显式消毒恢复，禁透明收编）', () => {
  it('存盘→重载规则存活；坏档逐键丢弃、非对象回退缺省、零崩溃', () => {
    // 存盘→重载存活（阈值是规则的组成，随档存续）
    const clock = new ManualClock();
    const game = createGame({
      content: makeEnemyAutoPack(),
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'smelt', maxRarity: 'fine' } } }),
    });
    const reloaded = createGame({ content: makeEnemyAutoPack(), save: game.snapshot() });
    expect(stateOf(reloaded.snapshot()).enemyAuto).toEqual({
      e1: { mode: 'smelt', maxRarity: 'fine' },
    });

    // 坏档注入：规则表非对象 → 回退缺省空表
    const nonObj = createGame({
      content: makeEnemyAutoPack(),
      clock: new ManualClock(),
      save: saveWith({ enemyAuto: 'garbage' }),
    });
    expect(stateOf(nonObj.snapshot()).enemyAuto).toEqual({});

    // 坏档注入：mode 非法 / 未注册敌人键 / 缺阈值 / 污染键 → 逐键丢弃（合法条目
    // 幸存）。污染键经 JSON.parse 注入——对象字面量的 __proto__ 是原型设置非
    // 自有键，造不出真档形态。
    const dirtyRules: Record<string, unknown> = JSON.parse(
      '{"e1":{"mode":"sell","maxRarity":"fine"},"efatal":{"mode":"nonsense","maxRarity":"common"},"e3":{"mode":"sell"},"ghost":{"mode":"sell","maxRarity":"common"},"__proto__":{"mode":"sell","maxRarity":"common"}}',
    );
    expect(Object.hasOwn(dirtyRules, '__proto__')).toBe(true); // 真自有污染键确已注入（防空测试）
    const dirty = createGame({
      content: makeEnemyAutoPack(),
      clock: new ManualClock(),
      save: saveWith({ enemyAuto: dirtyRules }),
    });
    expect(stateOf(dirty.snapshot()).enemyAuto).toEqual({
      e1: { mode: 'sell', maxRarity: 'fine' },
    });

    // 阈值未知 / 阈值非串 / mode='none' 残键 / 非对象条目 → 丢键（域一致性同律）
    for (const rule of [
      { mode: 'sell', maxRarity: 'ghost' },
      { mode: 'sell', maxRarity: 5 },
      { mode: 'none', maxRarity: 'common' },
      'junk',
    ]) {
      const g = createGame({
        content: makeEnemyAutoPack(),
        clock: new ManualClock(),
        save: saveWith({ enemyAuto: { e1: rule } }),
      });
      expect(stateOf(g.snapshot()).enemyAuto).toEqual({});
    }
  });

  it('旧档零迁移（无 enemyAuto 字段）；内容包变更后未知 id 回退不处理', () => {
    // 旧档：缺字段 = 缺省不处理，零迁移
    const old = createGame({ content: makeEnemyAutoPack(), clock: new ManualClock(), save: saveWith() });
    expect(stateOf(old.snapshot()).enemyAuto).toEqual({});

    // 包变更：规则键指向的敌人消失 → 丢键回退不处理
    const full = makeEnemyAutoPack();
    const game = createGame({
      content: full,
      clock: new ManualClock(),
      save: saveWith({ enemyAuto: { e1: { mode: 'sell', maxRarity: 'fine' } } }),
    });
    const shrunk = makeEnemyAutoPack();
    (shrunk as { enemies: unknown[] }).enemies = (shrunk as { enemies: unknown[] }).enemies.filter(
      (e) => (e as { id: string }).id !== 'e1',
    );
    const migrated = createGame({ content: shrunk, save: game.snapshot() });
    expect(stateOf(migrated.snapshot()).enemyAuto).toEqual({});
  });

  it('快照克隆隔离：条目逐条复制不共享引用，改快照不写穿引擎态（clone 行有牙）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeEnemyAutoPack(),
      clock,
      save: saveWith({ enemyAuto: { e1: { mode: 'sell', maxRarity: 'common' } } }),
    });
    const snap1 = stateOf(game.snapshot());
    const snap2 = stateOf(game.snapshot());
    expect(snap1.enemyAuto.e1).not.toBe(snap2.enemyAuto.e1); // 逐条复制，非共享引用
    (snap1.enemyAuto.e1 as unknown as { mode: string }).mode = 'smelt'; // 写穿尝试
    expect(stateOf(game.snapshot()).enemyAuto.e1).toEqual({ mode: 'sell', maxRarity: 'common' });
  });
});
