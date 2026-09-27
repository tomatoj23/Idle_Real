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
import { smithCraftCore } from './fixtures.js';

function stateOf(save: SaveData): GameState {
  return save.state as unknown as GameState;
}

function ledgerEntries(events: GameEvent[]): LedgerData[] {
  return events.filter((e) => e.type === 'ledger').map((e) => e.data as LedgerData);
}

/**
 * #35 配方自动化规则夹具：丹药配方（index 0，无稀有度产出）+ 器胚配方
 * （index 1，装备产出）；rarities 三档（寻常/精良/罕见，70/20/8）；器屑经济
 * 已配置；坊市可买丹药（挂点不可达反证用）。核心形状 = fixtures.smithCraftCore。
 */
function makeAutoPack(): GameContent {
  return {
    ...smithCraftCore(),
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1, smelt: 1 },
      { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2, smelt: 2 },
      { id: 'rare', name: '罕见', weight: 8, mult: 1.3, affix: 2, sell: 4, smelt: 4 },
    ],
    shop: [{ item: 'pill1', price: 30 }],
  } as unknown as GameContent;
}

/** 成就奖励变体：首炉触发成就发丹药（挂点不可达反证用；单放防污染他例）。 */
function makeAchPack(): GameContent {
  return {
    ...makeAutoPack(),
    achievements: [
      {
        id: 'cycle1',
        name: '初试炼',
        condition: { stat: 'cycles', target: 1 },
        reward: { items: [{ item: 'pill1', count: 2 }] },
      },
    ],
  } as unknown as GameContent;
}

/** 带活动的初始存档（活动名过稳定引用校验，与夹具配方同名）。 */
function saveWith(
  activity: { skillId: string; index: number; name: string },
  extra: Record<string, unknown> = {},
): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 50,
      items: { herb1: 40 },
      skills: { smith: { xp: 0 } },
      activity: { ...activity, progress: 0 },
      ...extra,
    },
  };
}

const PILL = { skillId: 'smith', index: 0, name: '炼制聚气丹' };
const SWORD = { skillId: 'smith', index: 1, name: '锻青锋剑' };

/** 常量掷点（rollRarity 映射：0.4→寻常、0.8→精良、0.95→罕见，权重 70/20/8）。 */
const roll = (v: number) => ({ rng: () => v });

/** 丹药炉：advance 3000 = 1 炉；返回事件与状态。 */
function craftOne(save: SaveData, ms = 3000) {
  const clock = new ManualClock();
  const game = createGame({ content: makeAutoPack(), clock, save });
  clock.advance(ms);
  game.tick(ms);
  return { st: stateOf(game.snapshot()), events: game.events.drain() };
}

describe('#35 · 配方自动化规则：三态互斥 + 缺省不处理', () => {
  it('缺省不处理：无规则产出照常入袋；设自动售卖即折；mode=none 删条目回缺省', () => {
    const pack = makeAutoPack();
    const clock = new ManualClock();
    const game = createGame({ content: pack, clock, save: saveWith(PILL) });

    // 缺省 = 不处理
    clock.advance(3000);
    game.tick(3000);
    expect(stateOf(game.snapshot()).items.pill1).toBe(1);
    expect(stateOf(game.snapshot()).recipeAuto).toEqual({});

    // 设自动售卖 → 入账即折
    game.dispatch({ type: 'craft:auto', payload: { index: 0, mode: 'sell' } });
    expect(stateOf(game.snapshot()).recipeAuto).toEqual({
      '0': { mode: 'sell', name: '炼制聚气丹' },
    });
    clock.advance(3000);
    game.tick(3000);
    const st = stateOf(game.snapshot());
    expect(st.items.pill1).toBe(1); // 旧产出不追溯（存量不追溯），新产出不落袋
    expect(st.gold).toBe(50);

    // 三态互斥：单选覆盖（sell → smelt 同一条目换态）
    game.dispatch({ type: 'craft:auto', payload: { index: 0, mode: 'smelt' } });
    expect(stateOf(game.snapshot()).recipeAuto).toEqual({
      '0': { mode: 'smelt', name: '炼制聚气丹' },
    });

    // mode=none = 清除规则（回缺省不处理；垃圾阈值不阻断清除——清除契约，#36 复核收口）
    game.dispatch({ type: 'craft:auto', payload: { index: 0, mode: 'none', maxRarity: 'ghost' } });
    expect(stateOf(game.snapshot()).recipeAuto).toEqual({});
    clock.advance(3000);
    game.tick(3000);
    expect(stateOf(game.snapshot()).items.pill1).toBe(2);
  });

  it('载荷守卫：坏载荷（非整下标/未知模式/未知稀有度/装备缺阈值/未注册配方）reject bad-payload', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeAutoPack(), clock, save: saveWith(PILL) });
    const bad: GameAction[] = [
      { type: 'craft:auto', payload: { index: -1, mode: 'sell' } },
      { type: 'craft:auto', payload: { index: 0 } },
      // 畸形注入面（mode 非法）：绕过编译面直发，运行时守卫必须接住（#75 同律）。
      ({ type: 'craft:auto', payload: { index: 0, mode: 'nonsense' } } as unknown) as GameAction,
      { type: 'craft:auto', payload: { index: 0, mode: 'sell', maxRarity: 'ghost' } },
      { type: 'craft:auto', payload: { index: 9, mode: 'sell' } },
      // 域一致性（复核收口）：装备产出规则必带在册阈值（UI 恒补最低档）。
      { type: 'craft:auto', payload: { index: 1, mode: 'sell' } },
    ];
    for (const action of bad) game.dispatch(action);
    const rejects = game.events.drain().filter((e) => e.type === 'reject');
    expect(rejects).toHaveLength(6);
    expect(stateOf(game.snapshot()).recipeAuto).toEqual({});
  });

  it('域一致性：普通产出规则的阈值写入即剥离；装备规则缺阈值恢复即丢键', () => {
    // 普通产出 + 杂散阈值（仅坏档可达）→ 阈值剥离、mode 保留
    const clock = new ManualClock();
    const game = createGame({
      content: makeAutoPack(),
      clock,
      save: saveWith(PILL, { recipeAuto: { '0': { mode: 'sell', maxRarity: 'fine', name: '炼制聚气丹' } } }),
    });
    expect(stateOf(game.snapshot()).recipeAuto).toEqual({ '0': { mode: 'sell', name: '炼制聚气丹' } });

    // 装备规则缺阈值/阈值非串/阈值未知 → 丢键（「阈值缺失的装备规则」不入活态）
    for (const rule of [{ mode: 'sell', name: '锻青锋剑' }, { mode: 'sell', maxRarity: 5, name: '锻青锋剑' }, { mode: 'sell', maxRarity: 'ghost', name: '锻青锋剑' }]) {
      const g = createGame({
        content: makeAutoPack(),
        clock: new ManualClock(),
        save: saveWith(SWORD, { recipeAuto: { '1': rule } }),
      });
      expect(stateOf(g.snapshot()).recipeAuto).toEqual({});
    }

    // mode='none' 残键（三态的缺省态不该落档）与非对象条目 → 丢键
    const g2 = createGame({
      content: makeAutoPack(),
      clock: new ManualClock(),
      save: saveWith(PILL, {
        recipeAuto: { '0': { mode: 'none', name: '炼制聚气丹' }, '1': 'junk' },
      }),
    });
    expect(stateOf(g2.snapshot()).recipeAuto).toEqual({});
  });
});

describe('#35 · 入账即折：在线炼制产出（AC1）', () => {
  it('自动售卖：产出折灵石、成对事件、不进袋、完全静默（旧 loot 不发）', () => {
    const { st, events } = craftOne(saveWith(PILL, { recipeAuto: { '0': { mode: 'sell', name: '炼制聚气丹' } } }));
    expect(ledgerEntries(events)).toEqual([
      { kind: 'item', source: 'craft', origin: 'idle', id: 'herb1', count: -2, value: 4 },
      { kind: 'item', source: 'craft', origin: 'idle', id: 'pill1', count: 0, value: 0, auto: 'sell' },
      { kind: 'currency', source: 'craft', origin: 'idle', id: 'gold', count: 50, value: 1, auto: 'sell' },
      { kind: 'exp', source: 'craft', origin: 'idle', id: 'smith', count: 8, value: 0 },
    ]);
    expect(events.some((e) => e.type === 'loot' || e.type === 'sell')).toBe(false); // 完全静默
    expect(st.items.pill1).toBeUndefined(); // 乾坤袋无残留
    expect(st.gold).toBe(50); // 物品基价 50 × 1
  });

  it('普通产出（丹药/材料）两态语义：熔炼态照常入袋（无装备语义），售卖态全折', () => {
    // smelt 态 + 无稀有度产出 → 不转化（AC「熔炼态=仅装备≤阈值熔，普通物品照常入袋」）。
    // 照常 = 正常入袋路径原样（含旧形状 loot 通知），零自动账。
    const smelt = craftOne(saveWith(PILL, { recipeAuto: { '0': { mode: 'smelt', name: '炼制聚气丹' } } }));
    expect(smelt.st.items.pill1).toBe(1);
    expect(smelt.st.gold).toBe(0);
    expect(smelt.events.some((e) => e.type === 'loot')).toBe(true); // 正常入袋路径原样
    expect(ledgerEntries(smelt.events).every((e) => e.auto === undefined)).toBe(true); // 不记自动账
  });
});

describe('#35 · 稀有度阈值（≤所选档，rarities 数组序）', () => {
  it('自动熔炼+阈值「精良」：寻常/精良折器屑、罕见照常入袋（AC3）', () => {
    const rule = { recipeAuto: { '1': { mode: 'smelt', maxRarity: 'fine', name: '锻青锋剑' } } };
    // 寻常（smelt 1）→ 器屑 1
    const common = (() => {
      const clock = new ManualClock();
      const game = createGame({ content: makeAutoPack(), clock, save: saveWith(SWORD, rule), ...roll(0.4) });
      clock.advance(2000);
      game.tick(2000);
      return { st: stateOf(game.snapshot()), events: game.events.drain() };
    })();
    expect(ledgerEntries(common.events)).toEqual([
      { kind: 'item', source: 'craft', origin: 'idle', id: 'herb1', count: -1, value: 4 },
      { kind: 'gear', source: 'craft', origin: 'idle', id: 'sword1', uid: 1, rarity: 'common', count: 0, value: 0, auto: 'smelt' },
      { kind: 'item', source: 'craft', origin: 'idle', id: 'shard', count: 1, value: 3, auto: 'smelt' },
      { kind: 'exp', source: 'craft', origin: 'idle', id: 'smith', count: 10, value: 0 },
    ]);
    expect(common.st.gear).toHaveLength(0); // 实例未进乾坤袋
    expect(common.st.items.shard).toBe(1);

    // 精良（smelt 2）→ 器屑 2（≤阈值含边界）
    const clock2 = new ManualClock();
    const game2 = createGame({ content: makeAutoPack(), clock: clock2, save: saveWith(SWORD, rule), ...roll(0.8) });
    clock2.advance(2000);
    game2.tick(2000);
    expect(stateOf(game2.snapshot()).items.shard).toBe(2);
    expect(stateOf(game2.snapshot()).gear).toHaveLength(0);

    // 罕见（> 阈值）→ 照常入袋
    const clock3 = new ManualClock();
    const game3 = createGame({ content: makeAutoPack(), clock: clock3, save: saveWith(SWORD, rule), ...roll(0.95) });
    clock3.advance(2000);
    game3.tick(2000);
    const st3 = stateOf(game3.snapshot());
    expect(st3.gear).toHaveLength(1);
    expect(st3.gear[0]?.rarity).toBe('rare');
    expect(st3.items.shard).toBeUndefined();
  });

  it('自动售卖+阈值：≤阈值折灵石（物品基价×稀有度乘数）、>阈值入袋', () => {
    const rule = { recipeAuto: { '1': { mode: 'sell', maxRarity: 'fine', name: '锻青锋剑' } } };
    // 精良（sell 2）→ 30 × 2 = 60 灵石
    const fine = (() => {
      const clock = new ManualClock();
      const game = createGame({ content: makeAutoPack(), clock, save: saveWith(SWORD, rule), ...roll(0.8) });
      clock.advance(2000);
      game.tick(2000);
      return stateOf(game.snapshot());
    })();
    expect(fine.gold).toBe(60);
    expect(fine.gear).toHaveLength(0);

    // 罕见（> 阈值）→ 入袋
    const clock = new ManualClock();
    const game = createGame({ content: makeAutoPack(), clock, save: saveWith(SWORD, rule), ...roll(0.95) });
    clock.advance(2000);
    game.tick(2000);
    const st = stateOf(game.snapshot());
    expect(st.gold).toBe(0);
    expect(st.gear).toHaveLength(1);
  });

  it('装备产出阈值缺失/未知稀有度 = 不折（恢复期丢键 + 决策侧安全回退双防线）', () => {
    // 阈值缺失（仅 mode）→ 恢复期丢键 → 不折（决策侧另有安全回退防身）
    const clock = new ManualClock();
    const game = createGame({
      content: makeAutoPack(),
      clock,
      save: saveWith(SWORD, { recipeAuto: { '1': { mode: 'sell', name: '锻青锋剑' } } }),
      ...roll(0.4),
    });
    expect(stateOf(game.snapshot()).recipeAuto).toEqual({});
    clock.advance(2000);
    game.tick(2000);
    expect(stateOf(game.snapshot()).gear).toHaveLength(1);

    // 未知阈值键（坏档注入）→ 恢复期丢弃该键 → 不折
    const clock2 = new ManualClock();
    const game2 = createGame({
      content: makeAutoPack(),
      clock: clock2,
      save: saveWith(SWORD, { recipeAuto: { '1': { mode: 'sell', maxRarity: 'ghost', name: '锻青锋剑' } } }),
      ...roll(0.4),
    });
    expect(stateOf(game2.snapshot()).recipeAuto).toEqual({}); // 未知稀有度丢键
    clock2.advance(2000);
    game2.tick(2000);
    expect(stateOf(game2.snapshot()).gear).toHaveLength(1);
  });
});

describe('#35 · 熔炼可用性门控（AC4）', () => {
  it('无 shardItem 的包：注入存量 smelt 规则不转化、不记自动账、零崩溃', () => {
    const pack = makeAutoPack();
    delete (pack as { config?: unknown }).config; // 无器屑经济
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      save: saveWith(SWORD, { recipeAuto: { '1': { mode: 'smelt', maxRarity: 'fine', name: '锻青锋剑' } } }),
      ...roll(0.4),
    });
    clock.advance(2000);
    game.tick(2000);
    const st = stateOf(game.snapshot());
    const entries = ledgerEntries(game.events.drain());
    expect(st.gear).toHaveLength(1); // 不转化：照常入袋
    expect(entries.every((e) => e.auto === undefined)).toBe(true); // 不记自动账
    expect(entries.find((e) => e.kind === 'gear')).toMatchObject({ count: 1, id: 'sword1' });
  });

  it('0 器屑档（rarities[].smelt=0 合法）：折得为 0 不发零额折得物——count=0 行⇔标记行不变量', () => {
    const pack = makeAutoPack();
    (pack as { rarities: Array<{ smelt: number }> }).rarities[0]!.smelt = 0; // 寻常档 0 产屑
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      save: saveWith(SWORD, { recipeAuto: { '1': { mode: 'smelt', maxRarity: 'fine', name: '锻青锋剑' } } }),
      ...roll(0.4), // 寻常
    });
    clock.advance(2000);
    game.tick(2000);
    const st = stateOf(game.snapshot());
    const entries = ledgerEntries(game.events.drain());
    expect(st.gear).toHaveLength(0); // 折叠照常发生（0 器屑档 = 内容定价为零）
    expect(st.items.shard).toBeUndefined();
    expect(entries).toEqual([
      { kind: 'item', source: 'craft', origin: 'idle', id: 'herb1', count: -1, value: 4 },
      // 仅标记行；零额器屑行不发（与 sell 路径「0 变化不入账」同律）。
      { kind: 'gear', source: 'craft', origin: 'idle', id: 'sword1', uid: 1, rarity: 'common', count: 0, value: 0, auto: 'smelt' },
      { kind: 'exp', source: 'craft', origin: 'idle', id: 'smith', count: 10, value: 0 },
    ]);
  });
});

describe('#35 · 判定只挂配方产出来源（AC5）', () => {
  it('坊市购买不入自动判定：同物品买入照常入袋、零自动账', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeAutoPack(),
      clock,
      save: saveWith(PILL, {
        gold: 100,
        recipeAuto: { '0': { mode: 'sell', name: '炼制聚气丹' } },
      }),
    });
    game.dispatch({ type: 'shop:buy', payload: { item: 'pill1', count: 1 } });
    const st = stateOf(game.snapshot());
    expect(st.items.pill1).toBe(1); // 买入入袋（未被折叠）
    expect(st.gold).toBe(70);
    const entries = ledgerEntries(game.events.drain());
    expect(entries.every((e) => e.auto === undefined)).toBe(true);
  });

  it('成就奖励不入自动判定：同物品奖励照常入袋（挂点只在配方产出）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeAchPack(),
      clock,
      save: saveWith(PILL, { recipeAuto: { '0': { mode: 'sell', name: '炼制聚气丹' } } }),
    });
    clock.advance(3000);
    game.tick(3000);
    const st = stateOf(game.snapshot());
    const events = game.events.drain();
    // 同一炉：产出折灵石（+50），成就奖励 pill1×2 入袋（未被折叠）。
    expect(st.gold).toBe(50);
    expect(st.items.pill1).toBe(2);
    const achievementRows = ledgerEntries(events).filter((e) => e.source === 'achievement');
    expect(achievementRows).toEqual([
      { kind: 'item', source: 'achievement', origin: 'idle', id: 'pill1', count: 2, value: 50 },
    ]);
  });

  it('兵解保留资产不入自动判定：袋内装备实例原样保留、零自动账', () => {
    const clock = new ManualClock();
    const game = createGame({
      // 兵解可用 = 包带 rebirth 节（否则 not-available 拒发，本测空转）。
      content: {
        ...makeAutoPack(),
        rebirth: {
          reset: ['skills', 'items', 'gold', 'buffs', 'lastEncounter'],
          keep: ['gear'],
          formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
          talents: [],
          unlocks: [],
          realms: [],
        },
      } as unknown as GameContent,
      clock,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 50,
          hp: 50,
          items: {},
          // 总修为 20000 → daoYunGain = floor(0.001 × 20000) = 20 → 兵解确有道韵入账行可验。
          skills: { smith: { xp: 20000 } },
          activity: null,
          gear: [{ uid: 1, itemId: 'sword1', rarity: 'common', affixes: [] }],
          recipeAuto: { '1': { mode: 'smelt', maxRarity: 'fine', name: '锻青锋剑' } },
        },
      },
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
    expect(st.recipeAuto).toEqual({ '1': { mode: 'smelt', maxRarity: 'fine', name: '锻青锋剑' } }); // 规则兵解保留（AC6）
  });
});

describe('#35 · 离线炼制同判（AC2）', () => {
  it('离线结算按规则折叠：成对事件带 offline 标注、产出不落袋', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeAutoPack(),
      clock,
      save: saveWith(PILL, { items: { herb1: 40 }, recipeAuto: { '0': { mode: 'sell', name: '炼制聚气丹' } } }),
      ...roll(0.4),
    });
    game.settleOffline(60000); // 20 炉（离线门槛 60s 起；材料 40 = 恰好 20 炉）
    const st = stateOf(game.snapshot());
    const entries = ledgerEntries(game.events.drain());
    // 聚合对：标记（count=0 会计不计）+ 折得灵石；20 炉 × 50 = 1000。
    const folded = entries.filter((e) => e.auto === 'sell');
    expect(folded).toEqual([
      { kind: 'item', source: 'craft', origin: 'idle', offline: true, id: 'pill1', count: 0, value: 0, auto: 'sell' },
      { kind: 'currency', source: 'craft', origin: 'idle', offline: true, id: 'gold', count: 1000, value: 1, auto: 'sell' },
    ]);
    expect(st.items.pill1).toBeUndefined();
    expect(st.gold).toBe(1000);
    expect(entries.every((e) => e.auto === undefined || e.offline === true)).toBe(true);
  });
});

describe('#35 · 存档持久化纪律（AC7/AC8：显式消毒恢复，禁透明收编）', () => {
  it('存盘→重载规则存活；未知键/坏形条目逐键丢弃、非对象回退缺省、零崩溃', () => {
    // 存盘→重载存活（装备规则带阈值——阈值是装备规则的组成，随档存续）
    const clock = new ManualClock();
    const game = createGame({
      content: makeAutoPack(),
      clock,
      save: saveWith(PILL, { recipeAuto: { '1': { mode: 'smelt', maxRarity: 'fine', name: '锻青锋剑' } } }),
    });
    const reloaded = createGame({ content: makeAutoPack(), save: game.snapshot() });
    expect(stateOf(reloaded.snapshot()).recipeAuto).toEqual({
      '1': { mode: 'smelt', maxRarity: 'fine', name: '锻青锋剑' },
    });

    // 坏档注入：规则表非对象 → 回退缺省空表
    const nonObj = createGame({
      content: makeAutoPack(),
      clock: new ManualClock(),
      save: saveWith(PILL, { recipeAuto: 'garbage' }),
    });
    expect(stateOf(nonObj.snapshot()).recipeAuto).toEqual({});

    // 坏档注入：mode 非法 / 未注册配方键 / 非 canonical 键 / 污染键 / 对名不符 → 逐键丢弃。
    // 污染键经 JSON.parse 注入——对象字面量的 __proto__ 是原型设置非自有键，造不出真档形态。
    const dirtyRules: Record<string, unknown> = JSON.parse(
      '{"0":{"mode":"nonsense","name":"炼制聚气丹"},"9":{"mode":"sell","name":"鬼配方"},"03":{"mode":"sell","name":"锻青锋剑"},"3":{"mode":"sell","name":"ghost"},"__proto__":{"mode":"sell","name":"炼制聚气丹"},"1":{"mode":"sell","maxRarity":"fine","name":"锻青锋剑"}}',
    );
    expect(Object.hasOwn(dirtyRules, '__proto__')).toBe(true); // 真自有污染键确已注入（防空测试）
    const dirty = createGame({
      content: makeAutoPack(),
      clock: new ManualClock(),
      save: saveWith(PILL, { recipeAuto: dirtyRules }),
    });
    expect(stateOf(dirty.snapshot()).recipeAuto).toEqual({
      '1': { mode: 'sell', maxRarity: 'fine', name: '锻青锋剑' },
    });
  });

  it('旧档零迁移（无 recipeAuto 字段）；内容包变更后未知 id 回退不处理', () => {
    // 旧档：缺字段 = 缺省不处理，零迁移
    const old = createGame({ content: makeAutoPack(), clock: new ManualClock(), save: saveWith(PILL) });
    expect(stateOf(old.snapshot()).recipeAuto).toEqual({});

    // 包变更：规则键指向的配方下标消失（recipes 收缩）→ 丢键回退不处理
    const full = makeAutoPack();
    const game = createGame({
      content: full,
      clock: new ManualClock(),
      save: saveWith(PILL, { recipeAuto: { '1': { mode: 'sell', maxRarity: 'fine', name: '锻青锋剑' } } }),
    });
    const shrunk = makeAutoPack();
    (shrunk as { recipes: unknown[] }).recipes = (shrunk as { recipes: unknown[] }).recipes.slice(0, 1);
    const migrated = createGame({ content: shrunk, save: game.snapshot() });
    expect(stateOf(migrated.snapshot()).recipeAuto).toEqual({});

    // 包变更：下标仍在但配方改名（重排/改名）→ 对名不符丢键（ADR-015 稳定引用）
    const renamed = makeAutoPack();
    (renamed as { recipes: Array<{ name: string }> }).recipes[1]!.name = '锻新剑';
    const renamedGame = createGame({ content: renamed, save: game.snapshot() });
    expect(stateOf(renamedGame.snapshot()).recipeAuto).toEqual({});
  });

  it('快照克隆隔离：条目逐条复制不共享引用，改快照不写穿引擎态（clone 行有牙）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeAutoPack(),
      clock,
      save: saveWith(PILL, { recipeAuto: { '0': { mode: 'sell', name: '炼制聚气丹' } } }),
    });
    const snap1 = stateOf(game.snapshot());
    const snap2 = stateOf(game.snapshot());
    expect(snap1.recipeAuto['0']).not.toBe(snap2.recipeAuto['0']); // 逐条复制，非共享引用
    (snap1.recipeAuto['0'] as unknown as { mode: string }).mode = 'smelt'; // 写穿尝试
    expect(stateOf(game.snapshot()).recipeAuto['0']).toEqual({ mode: 'sell', name: '炼制聚气丹' });
  });
});
