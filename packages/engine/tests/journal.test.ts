import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  JOURNAL_CAP,
  STAT_KEYS,
  createGame,
  journalAnchorNet,
  type GameContent,
  type GameState,
  type JournalRecord,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack, makePack } from './fixtures.js';

function stateOf(save: SaveData): GameState {
  return save.state as GameState;
}

function recordsOf(game: { snapshot(): SaveData }): JournalRecord[] {
  return stateOf(game.snapshot()).journal.records;
}

/** 击杀成就包（成就条目/计数器独立性用）。 */
function makeAchievementPack(): GameContent {
  return {
    ...makeCombatPack(),
    achievements: [
      {
        id: 'a_first_blood',
        name: '初胜',
        condition: { stat: 'kills', op: 'gte', target: 1 },
        reward: { gold: 10 },
      },
    ],
  } as GameContent;
}

/** 炼制折叠夹具（离线自动售卖聚合用；形状同 ledger.test.ts 的 makeLedgerPack）。 */
function makeCraftFoldPack(): GameContent {
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
    ],
  } as GameContent;
}

describe('#33 · 行为段落账（条目=行为段，不记逐件流水）', () => {
  it('采集段：开段→轮次→收功闭段成条（cycles/exp/明细/墙钟注入值）', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.9 });
    clock.advance(5); // 开段墙钟 = 注入值 5
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } }); // 幂等不发事件
    for (let i = 0; i < 3; i++) {
      clock.advance(1000);
      game.tick(3000);
    }
    clock.advance(7); // 闭段墙钟 = 5 + 3×1000 + 7
    game.dispatch({ type: 'activity:stop' });

    const records = recordsOf(game);
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec).toMatchObject({
      kind: 'gather',
      skillId: 'herb',
      activityName: '采青灵草',
      cycles: 3,
      exp: 18,
      t0: 5,
      t1: 3012,
      seq: 1,
    });
    if (rec.kind !== 'gather') return;
    // 明细行：产出 +3（value=冻结卖价 4）+ 修为聚合行（exp 同时入段 exp 字段）。
    expect(rec.lines).toEqual([
      { source: 'gather', kind: 'item', id: 'herb1', count: 3, gold: 12 },
      { source: 'gather', kind: 'exp', id: 'herb', count: 18, gold: 0 },
    ]);
  });

  it('战斗段：账本惰性开段、连续战斗并作一段（auto-fight 两胜）；切采集闭段', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCombatPack(),
      clock,
      rng: () => 0.4,
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: {}, skills: { fight: { xp: 0 } }, activity: null, autoFight: false },
      },
    });
    let victories = 0;
    game.events.subscribe((e) => {
      if (e.type === 'victory') victories += 1;
    });
    game.dispatch({ type: 'combat:auto' }); // 开自动再战：两场连续战斗并作一段
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 3000 && victories < 2; i++) {
      clock.advance(100);
      game.tick(100);
    }
    expect(victories).toBe(2);
    clock.advance(3);
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } }); // 切行为闭段

    const combat = recordsOf(game).find((r) => r.kind === 'combat');
    expect(combat).toMatchObject({ kind: 'combat', wins: 2, losses: 0, exp: 32 });
    if (combat?.kind !== 'combat') return;
    expect(combat.enemyIds).toEqual(['e1']);
    // rng 0.4：每场灵石 6 + 器胚 1 件（common，value 25）；两场聚合一行 + 修为行。
    expect(combat.lines).toEqual([
      { source: 'combat', kind: 'currency', id: 'gold', count: 12, gold: 12 },
      { source: 'combat', kind: 'gear', id: 'scorp_tail', count: 2, gold: 50, rarity: 'common' },
      { source: 'combat', kind: 'exp', id: 'fight', count: 32, gold: 0 },
    ]);

    // 切采集：战斗段已闭、采集段开而未成条（零轮次收功即丢弃）。
    game.dispatch({ type: 'activity:stop' });
    expect(recordsOf(game).some((r) => r.kind === 'gather')).toBe(false);
  });

  it('秘境段：进秘境闭既有段；段内多场战斗不另开段；离境闭段（通关数/最深层数/层奖励明细）', () => {
    const pack = {
      ...makeCombatPack(),
      dungeons: [
        {
          id: 'd1',
          name: '试炼窟',
          floors: 2,
          layers: [
            { floor: { min: 1, max: 1 }, enemies: [{ enemy: 'e1', weight: 1 }], rewards: { gold: 5 } },
            {
              floor: { min: 2, max: 2 },
              enemies: [{ enemy: 'e1', weight: 1 }],
              mult: { hp: 1.2, atk: 1, def: 1 },
              rewards: { gold: 8 },
            },
          ],
        },
      ],
    } as GameContent;
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      rng: () => 0.3,
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 112, items: {}, skills: { fight: { xp: 0 } }, activity: null, autoFight: false },
      },
    });
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'd1' } });
    for (let i = 0; i < 600 && stateOf(game.snapshot()).combat; i++) {
      clock.advance(100);
      game.tick(100);
    }
    game.dispatch({ type: 'dungeon:leave' });

    // rng 0.3 下两层全通：段内两场战斗 + 层奖 + 通关 + 升级（独立点条目）。
    const records = recordsOf(game);
    expect(records.map((r) => r.kind)).toEqual(['levelup', 'dungeon']);
    const rec = records[1]!;
    expect(rec).toMatchObject({ kind: 'dungeon', dungeonId: 'd1', cleared: 1, deepest: 2 });
    if (rec.kind !== 'dungeon') return;
    // 层奖励灵石（source=dungeon，5+8）与段内战斗账目（source=combat）同归秘境段。
    expect(rec.lines.some((l) => l.source === 'dungeon' && l.id === 'gold' && l.count === 13)).toBe(true);
    expect(rec.lines.some((l) => l.source === 'combat' && l.id === 'gold')).toBe(true);
    // 段内战斗不另开段：无 combat 条目。
    expect(records.some((r) => r.kind === 'combat')).toBe(false);
  });

  it('访问段（乾坤袋）：visit 信号开闭段，user 账目归段；零操作访问不留痕', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makePack(),
      clock,
      save: {
        version: 1,
        time: 0,
        state: { gold: 100, hp: 50, items: { herb1: 10 }, skills: {}, activity: null },
      },
    });
    clock.advance(11);
    game.dispatch({ type: 'visit:begin', payload: { page: 'bag' } });
    game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 4 } });
    game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 2 } });
    game.tick(250); // 点条目冻结拍（访问段账目不受影响）
    clock.advance(13);
    game.dispatch({ type: 'visit:end', payload: { page: 'bag' } });
    // 零操作访问：开坊市即切走，不留痕。
    game.dispatch({ type: 'visit:begin', payload: { page: 'shop' } });
    game.dispatch({ type: 'visit:end', payload: { page: 'shop' } });

    const records = recordsOf(game);
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec).toMatchObject({ kind: 'visit', page: 'bag', t0: 11, t1: 24 });
    if (rec.kind !== 'visit') return;
    // 段内分项聚合：两次卖出并作一行（count/gold 累计），灵石收益一行。
    expect(rec.lines).toEqual([
      { source: 'sell', kind: 'item', id: 'herb1', count: -6, gold: -24 },
      { source: 'sell', kind: 'currency', id: 'gold', count: 24, gold: 24 },
    ]);
  });

  it('点条目：无访问段的手动动作成条；同拍同源微批聚合（物品行+灵石行并作一条）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makePack(),
      clock,
      save: {
        version: 1,
        time: 0,
        state: { gold: 100, hp: 50, items: { herb1: 10 }, skills: {}, activity: null },
      },
    });
    game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 4 } });
    game.tick(250); // 冻结拍
    game.dispatch({ type: 'shop:buy', payload: { item: 'consumable_heal', count: 1 } });
    game.tick(250);

    const points = recordsOf(game).filter((r) => r.kind === 'point');
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ kind: 'point', source: 'sell' });
    if (points[0]?.kind !== 'point') return;
    // 卖出一次动作 = 一条点条目（物品 −4 + 灵石 +16 两行）。
    expect(points[0].lines).toEqual([
      { source: 'sell', kind: 'item', id: 'herb1', count: -4, gold: -16 },
      { source: 'sell', kind: 'currency', id: 'gold', count: 16, gold: 16 },
    ]);
    expect(points[1]).toMatchObject({ kind: 'point', source: 'buy' });
  });

  it('升级/成就/兵解条目：独立成条（achievement/rebirth 来源账本只进计数器防双条目）', () => {
    const pack = {
      ...makeAchievementPack(),
      rebirth: {
        reset: ['skills', 'items', 'gold', 'buffs', 'lastEncounter'],
        keep: ['gear'],
        formula: { base: 0, coef: 0.001, exp: 1, minProgress: 20 },
        talents: [],
        unlocks: [],
        realms: [{ level: 1, name: '练气' }],
      },
    } as GameContent;
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      rng: () => 0.4,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 112,
          items: {},
          skills: { fight: { xp: 10 } }, // +16 战斗修为 = 26 ≥ 25 → 升 2 层；总修为 26 ≥ 门槛 20
          activity: null,
          autoFight: false,
        },
      },
    });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 600 && stateOf(game.snapshot()).combat; i++) {
      clock.advance(100);
      game.tick(100);
    }
    // 战斗修为跨级 → levelup 条目；击杀成就 → achievement 条目。
    const kinds = recordsOf(game).map((r) => r.kind);
    expect(kinds).toContain('levelup');
    expect(kinds).toContain('achievement');

    // 兵解：篇章标记条目 + 兵解账本（daoYun）不另成点条目。
    const before = stateOf(game.snapshot()).journal.records.length;
    game.dispatch({ type: 'rebirth:perform' });
    const records = recordsOf(game);
    expect(records).toHaveLength(before + 1);
    const rebirth = records[records.length - 1]!;
    expect(rebirth).toMatchObject({ kind: 'rebirth' });
    expect(records.filter((r) => r.kind === 'point' && r.source === 'rebirth')).toHaveLength(0);
  });
});

describe('#33 · 离线段与自动折叠聚合', () => {
  it('离线结算并作一段：闭在线段、offline 标注账目聚合、时长/轮数/升级随条目', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.9 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(6000); // 在线 2 轮（成 gather 段）
    clock.advance(60000);
    game.settleOffline(60000); // 离线 20 轮

    const records = recordsOf(game);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ kind: 'gather', cycles: 2 });
    const offline = records[1]!;
    expect(offline).toMatchObject({
      kind: 'offline',
      skillId: 'herb',
      activityName: '采青灵草',
      seconds: 60,
      cycles: 20,
      capped: false,
    });
    if (offline.kind !== 'offline') return;
    // 主产出 +20；副产出按离线统计式 +10（期望 20×0.5 整除无掷）；修为聚合行。
    expect(offline.lines).toEqual([
      { source: 'gather', kind: 'item', id: 'herb1', count: 20, gold: 80 },
      { source: 'gather', kind: 'item', id: 'silk', count: 10, gold: 60 },
      { source: 'gather', kind: 'exp', id: 'herb', count: 120, gold: 0 },
    ]);
    expect(offline.levels).toEqual([{ skillId: 'herb', level: 3 }]); // 在线 12 + 离线 120 → 3 层
  });

  it('离线自动售卖并入离线段（配方挂点折叠成对事件聚合，不逐件成条）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makeCraftFoldPack(),
      clock,
      rng: () => 0.9,
      autoFold: (c) => (c.source === 'craft' && c.itemId === 'pill1' ? 'sell' : undefined),
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 50,
          items: { herb1: 50 }, // 25 轮量 > 离线 20 轮，材料不设限
          skills: { smith: { xp: 0 } },
          activity: { skillId: 'smith', index: 0, name: '炼制聚气丹', progress: 0 },
        },
      },
    });
    game.settleOffline(60000); // 20 轮，产出全部入账即折

    const records = recordsOf(game);
    expect(records).toHaveLength(1);
    const offline = records[0]!;
    expect(offline.kind).toBe('offline');
    if (offline.kind !== 'offline') return;
    // 聚合行：材料损耗 + 被折叠标记（count=0 会计不计）+ 折得灵石 + 修为；不逐件成条。
    expect(offline.lines).toEqual([
      { source: 'craft', kind: 'item', id: 'herb1', count: -40, gold: -160 },
      { source: 'craft', kind: 'item', id: 'pill1', count: 0, gold: 0, auto: 'sell' },
      { source: 'craft', kind: 'currency', id: 'gold', count: 1000, gold: 1000, auto: 'sell' },
      { source: 'craft', kind: 'exp', id: 'smith', count: 160, gold: 0 },
    ]);
    expect(stateOf(game.snapshot()).items.pill1).toBeUndefined();
  });
});

describe('#33 · 流量计数器与锚点', () => {
  it('计数器独立开放键：不进 STAT_KEYS、成就判定读数不受其影响', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeAchievementPack(), clock, rng: () => 0.4 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(6000);
    const st = stateOf(game.snapshot());
    expect(st.ledgerCounters['item:herb1:gather']).toBe(2);
    expect(STAT_KEYS as readonly string[]).not.toContain('item:herb1:gather');
    // stats 闭集只有既有累积键（cycles=#9 既有语义）——流量计数器不渗透成就判定。
    expect(Object.keys(st.stats)).toEqual(['cycles']);
    expect(st.stats.cycles).toBe(2);
  });

  it('锚点净收获 = 快照差值（来源维度合并）；重设换基准；得失相抵归零', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makePack(),
      clock,
      rng: () => 0.9, // 无副产出
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 50, items: { herb1: 10 }, skills: {}, activity: null },
      },
    });
    game.dispatch({ type: 'journal:anchor' });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(9000); // 3 轮
    game.dispatch({ type: 'activity:stop' });
    game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 2 } });
    game.tick(250);

    const st = stateOf(game.snapshot());
    let net = journalAnchorNet(st.ledgerCounters, st.journalAnchor);
    // herb1：采集 +3 与卖出 −2 按对象合并 = 净 +1（得失相抵口径）。
    expect(net).toEqual([
      { kind: 'currency', id: 'gold', count: 8 },
      { kind: 'item', id: 'herb1', count: 1 },
      { kind: 'exp', id: 'herb', count: 18 },
    ]);

    // 重设锚点：基准换成当下，净收获清零。
    game.dispatch({ type: 'journal:anchor' });
    const st2 = stateOf(game.snapshot());
    net = journalAnchorNet(st2.ledgerCounters, st2.journalAnchor);
    expect(net).toEqual([]);
  });

  it('环形超限淘汰最旧条目；淘汰后锚点净收获汇总仍正确（快照差值不依赖条目存活）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makePack(),
      clock,
      save: {
        version: 1,
        time: 0,
        state: { gold: 1_000_000, hp: 50, items: {}, skills: {}, activity: null },
      },
    });
    game.dispatch({ type: 'journal:anchor' });
    for (let i = 0; i < JOURNAL_CAP + 1; i++) {
      game.dispatch({ type: 'shop:buy', payload: { item: 'consumable_heal', count: 1 } });
      game.tick(250); // 分拍 → 每拍一条点条目
    }
    const st = stateOf(game.snapshot());
    expect(st.journal.records).toHaveLength(JOURNAL_CAP);
    // 最旧一条被淘汰：seq 连续不回退。
    expect(st.journal.records[0]!.seq).toBe(2);
    expect(st.journal.records[JOURNAL_CAP - 1]!.seq).toBe(JOURNAL_CAP + 1);
    // 淘汰后净收获仍精确：501 瓶丹 + 耗灵石 501×45。
    const net = journalAnchorNet(st.ledgerCounters, st.journalAnchor);
    expect(net).toEqual([
      { kind: 'currency', id: 'gold', count: -(JOURNAL_CAP + 1) * 45 },
      { kind: 'item', id: 'consumable_heal', count: JOURNAL_CAP + 1 },
    ]);
  });
});

describe('#33 · 兵解处置', () => {
  it('流水保留、锚点与快照清空、计数器终身累计、开放段闭段成条', () => {
    const pack = {
      ...makePack(),
      rebirth: {
        reset: ['skills', 'items', 'gold', 'buffs', 'lastEncounter'],
        keep: ['gear'],
        formula: { base: 0, coef: 0.001, exp: 1, minProgress: 100 },
        talents: [],
        unlocks: [],
        realms: [{ level: 1, name: '练气' }],
      },
    } as GameContent;
    const clock = new ManualClock();
    const game = createGame({
      content: pack,
      clock,
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 50,
          items: { herb1: 300 },
          skills: { herb: { xp: 5000 } },
          activity: null,
        },
      },
    });
    game.dispatch({ type: 'journal:anchor' });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(9000); // 3 轮（开放 gather 段）
    game.dispatch({ type: 'rebirth:perform' });

    const st = stateOf(game.snapshot());
    // 兵解闭段：gather 段成条 + 兵解篇章条目；流水保留。
    expect(st.journal.records.map((r) => r.kind)).toEqual(['gather', 'rebirth']);
    expect(st.journalAnchor).toBeNull();
    // 计数器终身累计（兵解不清）。
    expect(st.ledgerCounters['item:herb1:gather']).toBe(3);
  });
});

describe('#33 · 存档持久化（显式消毒恢复，禁透明收编）', () => {
  it('注入无新字段旧档：空流水/无锚点/零计数器，行为等同全新档（零迁移）', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makePack(),
      clock,
      save: { version: 1, time: 0, state: { gold: 5, hp: 50, items: {}, skills: {} } },
    });
    const st = stateOf(game.snapshot());
    expect(st.journal).toEqual({ records: [], seq: 0 });
    expect(st.journalOpen).toEqual({ behavior: null, visit: null });
    expect(st.ledgerCounters).toEqual({});
    expect(st.journalAnchor).toBeNull();
  });

  it('存盘→重载→流水/计数器/锚点/开放行为段全部存活', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.9 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(9000);
    game.dispatch({ type: 'journal:anchor' });
    const save = game.snapshot();
    const before = stateOf(save);

    const clock2 = new ManualClock();
    const reloaded = createGame({ content: makePack(), clock: clock2, save });
    const after = stateOf(reloaded.snapshot());
    expect(after.journal).toEqual(before.journal);
    expect(after.ledgerCounters).toEqual(before.ledgerCounters);
    expect(after.journalAnchor).toEqual(before.journalAnchor);
    expect(after.journalOpen).toEqual(before.journalOpen); // gather 段随档恢复继续累计
  });

  it('开放访问段跨存档：恢复时强制闭段成条（t1 = 存档墙钟），行为段随档恢复', () => {
    const save: SaveData = {
      version: 1,
      time: 100,
      savedAt: 999,
      state: {
        gold: 0,
        hp: 50,
        items: {},
        skills: {},
        activity: null,
        journal: { records: [], seq: 0 },
        journalOpen: {
          behavior: null,
          visit: {
            kind: 'visit',
            t0: 500,
            page: 'bag',
            lines: [{ source: 'sell', kind: 'item', id: 'herb1', count: -2, gold: -8 }],
          },
        },
      },
    };
    const game = createGame({ content: makePack(), save });
    const st = stateOf(game.snapshot());
    expect(st.journalOpen.visit).toBeNull();
    expect(st.journal.records).toHaveLength(1);
    expect(st.journal.records[0]).toEqual({
      kind: 'visit',
      seq: 1,
      t0: 500,
      t1: 999,
      page: 'bag',
      lines: [{ source: 'sell', kind: 'item', id: 'herb1', count: -2, gold: -8 }],
    });
  });

  it('坏档消毒：垃圾条目弃置、超长截断环形上限、计数器坏键拒收、锚点非法回退 null', () => {
    const junkRecords = Array.from({ length: 600 }, (_, i) => ({
      seq: i + 1,
      t0: 0,
      t1: 0,
      kind: 'point',
      source: 'sell',
      lines: [],
    }));
    const game = createGame({
      content: makePack(),
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 50,
          items: {},
          skills: {},
          activity: null,
          journal: {
            records: [{ kind: 'nonsense' }, 'junk', ...junkRecords],
            seq: 99999,
          },
          journalOpen: {
            behavior: null,
            visit: {
              kind: 'visit',
              t0: 'x',
              page: 'bag',
              lines: [{ source: 'nope', kind: 'item', id: 'Bad_ID', count: 1, gold: 1 }],
            },
          },
          ledgerCounters: {
            'item:herb1:gather': 7,
            garbage: 1,
            'item:Bad:__:gather': 5,
            'currency:gold:sell': -12.5,
          },
          journalAnchor: { at: 'x', snap: { 'item:herb1:gather': 3 } },
        },
      },
    });
    const st = stateOf(game.snapshot());
    expect(st.journal.records).toHaveLength(JOURNAL_CAP); // 600 合法条目 → 截断留最新 500
    expect(st.journal.records[JOURNAL_CAP - 1]!.seq).toBe(600);
    expect(st.journal.seq).toBe(99999); // 声明序号（防后续 seq 撞历史）
    expect(st.journalOpen).toEqual({ behavior: null, visit: null }); // 行非法的 visit 段 → 闭段判空弃置
    expect(st.ledgerCounters).toEqual({ 'item:herb1:gather': 7, 'currency:gold:sell': -12.5 });
    expect(st.journalAnchor).toBeNull(); // at 非法 → 整锚点回退
  });

  it('快照契约：条目深冻结 + 修改快照返回的 records/计数器/锚点嵌套结构不影响引擎状态', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.9 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(6000);
    game.dispatch({ type: 'journal:anchor' });
    game.dispatch({ type: 'activity:stop' }); // 闭段 → 1 条冻结条目

    const cloned = stateOf(game.snapshot());
    const record = cloned.journal.records[0]!;
    // 条目深冻结：写穿引擎的 mutate 路径当场抛错（严格模式），静默写穿不可能。
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.lines)).toBe(true);
    expect(Object.isFrozen(record.lines[0])).toBe(true);
    expect(() => {
      (record as { cycles: number }).cycles = 999;
    }).toThrow();
    // 数组浅拷仍隔离数组级 mutate（push 只进克隆副本，不触引擎）。
    (cloned.journal.records as JournalRecord[]).push(record);
    cloned.ledgerCounters['item:herb1:gather'] = -777;
    if (cloned.journalAnchor) {
      (cloned.journalAnchor.snap as Record<string, number>)['item:herb1:gather'] = -777;
    }

    // 引擎继续演进后取新快照：被污染的克隆不回流引擎状态。
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(3000); // 第 3 轮（引擎内 open 段 cycles 2→3，不受克隆污染）
    game.dispatch({ type: 'activity:stop' });
    const fresh = stateOf(game.snapshot());
    expect(fresh.journal.records).toHaveLength(2); // 克隆里 push 的条目未入引擎
    expect(fresh.journal.records[0]).toMatchObject({ kind: 'gather', cycles: 2 });
    expect(fresh.journal.records[1]).toMatchObject({ kind: 'gather', cycles: 1 });
    expect(fresh.journal.records[0]!.lines).toHaveLength(2); // 产出行 + 修为行
    expect(fresh.ledgerCounters['item:herb1:gather']).toBe(3);
    expect(fresh.journalAnchor?.snap['item:herb1:gather']).toBe(2); // 锚点基准 = 设锚时的 2 轮
  });

  it('缓存克隆复用：流水不变时连续快照 records 引用相同；追加后换引用', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.9 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(3000);
    game.dispatch({ type: 'activity:stop' }); // 闭段 → 1 条

    const a = stateOf(game.snapshot()).journal.records;
    const b = stateOf(game.snapshot()).journal.records;
    expect(a).toBe(b); // 零增量克隆：同一缓存数组

    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } }); // 重开同活动（已停可复开）
    clock.advance(1000);
    game.tick(4000); // 4000ms / 3000ms 间隔 = 1 轮（progress 结转）
    game.dispatch({ type: 'activity:stop' }); // 追加 → 换引用
    const c = stateOf(game.snapshot()).journal.records;
    const d = stateOf(game.snapshot()).journal.records;
    expect(c).not.toBe(a);
    expect(c).toBe(d);
    expect(c).toHaveLength(2);
  });

  it('并行段（AC）：战斗段进行中开乾坤袋卖出——访问段闭段成条，行为段持续不闭', () => {
    const clock = new ManualClock();
    const game = createGame({
      content: makePack(),
      clock,
      save: {
        version: 1,
        time: 0,
        state: { gold: 0, hp: 50, items: { herb1: 6 }, skills: { herb: { xp: 0 } }, activity: null },
      },
    });
    // 开一段采集（行为段开放）。
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(3000);
    // 采集进行中开袋（访问段与行为段并行）→ 卖出 → 闭袋。
    clock.advance(11);
    game.dispatch({ type: 'visit:begin', payload: { page: 'bag' } });
    game.dispatch({ type: 'bag:sell', payload: { item: 'herb1', count: 2 } });
    game.dispatch({ type: 'visit:end', payload: { page: 'bag' } });
    // 采集继续：行为段账目照常累计（未被访问段吞掉）。
    clock.advance(1000);
    game.tick(3000);
    game.dispatch({ type: 'activity:stop' });

    const records = recordsOf(game);
    expect(records.map((r) => r.kind)).toEqual(['visit', 'gather']);
    expect(records[0]).toMatchObject({ kind: 'visit', page: 'bag' });
    if (records[0]?.kind !== 'visit') return;
    expect(records[0].lines).toEqual([
      { source: 'sell', kind: 'item', id: 'herb1', count: -2, gold: -8 },
      { source: 'sell', kind: 'currency', id: 'gold', count: 8, gold: 8 },
    ]);
    // 采集段覆盖全程（2 轮，含访问段期间的挂机产出）。
    expect(records[1]).toMatchObject({ kind: 'gather', cycles: 2 });
  });

  it('内容包变更防御：删物品/删敌人后历史条目仍带原 id（渲染侧回显兜底的引擎前提）', () => {    const clock = new ManualClock();
    const game = createGame({ content: makePack(), clock, rng: () => 0.9 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    clock.advance(1000);
    game.tick(3000);
    game.dispatch({ type: 'activity:stop' });
    const rec = recordsOf(game)[0]!;
    expect(rec).toMatchObject({ kind: 'gather', skillId: 'herb' });
    if (rec.kind === 'gather') {
      expect(rec.lines[0]!.id).toBe('herb1'); // 引擎存 id 不存名——包删 herb1 后条目原样
    }
  });
});
