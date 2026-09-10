import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  createGame,
  findEnemy,
  pickSummonEntry,
  summonMinionOf,
  summonPoolOf,
  type BossView,
  type GameContent,
  type GameEvent,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #30 验收：Boss 召唤与多敌战斗状态机——
 * - AC1 假时钟打 Boss：跨召唤阈值召唤物入场、独立出招、可被击杀、
 *   清场后回到主目标（集火语义）；
 * - AC2 召唤脚本 100% content 定义（换包换召唤行为）；
 * - 中途存档往返：召唤物态随战斗态恢复（{enemyId, phase, hp, et}）。
 * 附带：再战清场重演、恢复侧防御过滤、普通敌人零扰动、投影单点。
 */

/** 召唤测试包：e1 两阶段——阶段 1 纯修正；阶段 2 召唤 2 只 e3 缩影（hp/atk ×0.5）。
 *  e1 攻击间隔拉满：召唤窗口内玩家掉血只能来自召唤物（隔离断言）。 */
function makeSummonPack(): GameContent {
  const base = makeCombatPack() as GameContent & { enemies: Array<{ id: string; attackInterval: number }> };
  base.enemies = base.enemies.map((enemy) =>
    enemy.id === 'e1' ? { ...enemy, attackInterval: 1000000 } : enemy,
  );
  return {
    ...base,
    bosses: [
      {
        enemy: 'e1',
        phases: [
          { threshold: 0.6, name: '血目暴睁', mods: { atk: 2 }, narration: ['【{enemy}】血目暴睁！'] },
          {
            threshold: 0.3,
            name: '护法现世',
            mods: { attackInterval: 0.5 },
            summons: {
              count: 2,
              enemies: [{ enemy: 'e3', weight: 1, mult: { hp: 0.5, atk: 0.5 } }],
              narration: ['【{enemy}】召来护法！'],
            },
          },
        ],
      },
    ],
  } as GameContent;
}

/** AC2 换包样张：count 3 + 双行池 + 无 mult（缩放缺省 = 敌人定义原值）。 */
function makeVariedPack(): GameContent {
  return {
    ...makeCombatPack(),
    bosses: [
      {
        enemy: 'e1',
        phases: [
          {
            threshold: 0.5,
            name: '群妖乱舞',
            summons: {
              count: 3,
              enemies: [
                { enemy: 'e3', weight: 1 },
                { enemy: 'efatal', weight: 3 },
                { enemy: 'ghost', weight: 9 }, // 不存在的敌：剔出有效池（防御路径）
              ],
            },
          },
        ],
      },
    ],
  } as GameContent;
}

/** 斗法修为 3 层存档（atk 17）：召唤物 hp 45 恰 3 击，击杀前窗口充裕。 */
function midSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: { skills: { fight: { xp: 100 } }, items: {} },
  } as unknown as SaveData;
}

interface Capture {
  summons: GameEvent[];
  phases: GameEvent[];
  notes: GameEvent[];
  attacks: GameEvent[];
  victories: GameEvent[];
}

const capture = (): Capture => ({ summons: [], phases: [], notes: [], attacks: [], victories: [] });

function wire(game: ReturnType<typeof createGame>, cap: Capture): void {
  game.events.subscribe((event) => {
    if (event.type === 'boss:summon') cap.summons.push(event);
    else if (event.type === 'boss:phase') cap.phases.push(event);
    else if (event.type === 'combat-note') cap.notes.push(event);
    else if (event.type === 'attack') cap.attacks.push(event);
    else if (event.type === 'victory') cap.victories.push(event);
  });
}

const combatOf = (game: ReturnType<typeof createGame>): CombatView => {
  const combat = (game.snapshot().state as { combat: CombatView | null }).combat;
  expect(combat, '战斗态应在身').not.toBeNull();
  return combat!;
};

interface CombatView {
  enemyId: string;
  ehp: number;
  summons: Array<{ enemyId: string; phase: number; hp: number; et: number }>;
  bossPhase: number;
}

describe('#30 · AC1 假时钟打 Boss（召唤入场/集火/清场回到主目标）', () => {
  it('跨召唤阈值：召唤物以缩放满血入场（权重抽签 + boss:summon 事件 + 转场叙事）', () => {
    const game = createGame({ content: makeSummonPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.summons.length === 0; i++) game.tick(1000);
    expect(cap.summons).toHaveLength(1);
    expect(cap.summons[0]!.data).toMatchObject({ enemyId: 'e1', enemyName: '青鬃狼', phase: 2, count: 2 });
    const combat = combatOf(game);
    // 投影单点：e3 hp 90/atk 13 × 0.5 → 45/7（summonMinionOf 同式）。
    expect(combat.summons).toHaveLength(2);
    for (const minion of combat.summons) {
      expect(minion.enemyId).toBe('e3');
      expect(minion.phase).toBe(1);
      expect(minion.hp).toBe(summonMinionOf(makeSummonPack(), bossDefOf(makeSummonPack()), 1, 'e3')!.hp);
      expect(minion.hp).toBe(45);
    }
    // 召唤转场叙事（content 池抽句）入战报。
    expect(cap.notes.some((e) => String(e.data?.text).includes('召来护法'))).toBe(true);
    // 阶段事件先于召唤事件（同一阶段推进内逐级补发）。
    expect(cap.phases.at(-1)!.time).toBeLessThanOrEqual(cap.summons[0]!.time);
  });

  it('集火语义：召唤物在场时玩家只打召唤物（主目标 ehp 冻结），各自独立出招', () => {
    const game = createGame({ content: makeSummonPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.summons.length === 0; i++) game.tick(1000);
    const ehpAtSummon = combatOf(game).ehp;
    const hpAtSummon = game.snapshot().state.hp as number;
    const summonTime = cap.summons[0]!.time;
    // 召唤物窗口：玩家攻击全落在召唤物（enemyId = e3），主目标 ehp 不动；
    // e1 间隔拉满 → 玩家掉血只能来自召唤物独立出招（atk 13×0.5）。
    for (let i = 0; i < 40 && combatOf(game).summons.length > 0; i++) game.tick(1000);
    const afterSummon = cap.attacks.filter((e) => e.time > summonTime);
    expect(afterSummon.filter((e) => e.data?.side === 'player' && e.data?.enemyId === 'e3').length).toBeGreaterThanOrEqual(2);
    expect(afterSummon.filter((e) => e.data?.side === 'player' && e.data?.enemyId === 'e1')).toHaveLength(0);
    expect(combatOf(game).ehp).toBe(ehpAtSummon);
    expect((game.snapshot().state.hp as number) < hpAtSummon).toBe(true);
    expect(cap.attacks.some((e) => e.data?.side === 'enemy' && e.data?.enemyId === 'e3')).toBe(true);
  });

  it('清场后回到主目标：末只召唤物倒下播 reengage，玩家攻击回主目标直至胜利', () => {
    const game = createGame({ content: makeSummonPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 200 && cap.victories.length === 0; i++) game.tick(1000);
    expect(cap.victories).toHaveLength(1);
    // 清场节点：reengage 叙事（复用词库池，零新键）在最后一只召唤物倒下后播报。
    const reengageAt = cap.notes.findIndex((e) => String(e.data?.text).includes('再度'));
    expect(reengageAt).toBeGreaterThanOrEqual(0);
    expect(combatOf(game).summons).toHaveLength(0); // 休整期残阵已清
    // 清场后玩家攻击回主目标：reengage 之后存在 enemyId = e1 的玩家攻击。
    const reengageTime = cap.notes[reengageAt]!.time;
    expect(
      cap.attacks.some((e) => e.data?.side === 'player' && e.data?.enemyId === 'e1' && e.time > reengageTime),
    ).toBe(true);
  });

  it('再战清场重演：自动再战召唤物重新入场（两场各两波召唤，阶段从头演）', () => {
    // 双召唤阶段且阈值均高于单会心击杀区间（>0.5）：任何 rng 流下第二场
    // 都必然重演两阶段（胜负判定先于阶段推进，压线会心跳阶段是合法语义）。
    const pack = {
      ...makeCombatPack(),
      bosses: [
        {
          enemy: 'e1',
          phases: [
            {
              threshold: 0.8,
              name: '阴风起',
              summons: { count: 1, enemies: [{ enemy: 'e3', weight: 1, mult: { hp: 0.05, atk: 0.5 } }] },
            },
            {
              threshold: 0.55,
              name: '阴风再起',
              summons: { count: 1, enemies: [{ enemy: 'efatal', weight: 1, mult: { hp: 0.1, atk: 0.5 } }] },
            },
          ],
        },
      ],
    } as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 400 && cap.victories.length < 2; i++) game.tick(1000);
    expect(cap.victories).toHaveLength(2);
    expect(cap.summons).toHaveLength(4); // 两场 × 两波，各记一条 boss:summon
    expect(cap.phases.map((e) => e.data?.phase)).toEqual([1, 2, 1, 2]); // 阶段从头演
  });
});

describe('#30 · AC2 召唤脚本 100% content（换包换召唤行为）', () => {
  it('count/池权重/缩放全随包走：无 mult = 原值投影，无效池行剔除', () => {
    const pack = makeVariedPack();
    const game = createGame({ content: pack, clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.summons.length === 0; i++) game.tick(1000);
    expect(cap.summons[0]!.data).toMatchObject({ phase: 1, count: 3 });
    const combat = combatOf(game);
    expect(combat.summons).toHaveLength(3);
    for (const minion of combat.summons) {
      const baseHp = findEnemy(pack, minion.enemyId)!.hp; // e3 90 / efatal 50
      expect(minion.hp).toBe(baseHp); // 无 mult = 原值（缩放缺省语义）
      expect(['e3', 'efatal']).toContain(minion.enemyId); // ghost 剔出有效池
    }
  });

  it('无 summons 脚本的阶段：零召唤（阶段照常推进）', () => {
    const pack = {
      ...makeCombatPack(),
      bosses: [{ enemy: 'e1', phases: [{ threshold: 0.5, name: '单阶段' }] }],
    } as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.phases.length === 0; i++) game.tick(1000);
    expect(cap.phases).toHaveLength(1);
    expect(cap.summons).toHaveLength(0);
    expect(combatOf(game).summons).toHaveLength(0);
  });

  it('秘境层内召唤：入场血量吃层倍率（先层倍率后召唤 mult，入场即实战视图）', () => {
    const pack = {
      ...makeSummonPack(),
      dungeons: [
        {
          id: 'crypt',
          name: '妖窟',
          icon: '窟',
          floors: 1,
          layers: [
            { floor: { min: 1, max: 1 }, enemies: [{ enemy: 'e1', weight: 1 }], mult: { hp: 1.2, atk: 1.1 } },
          ],
        },
      ],
    } as GameContent;
    const game = createGame({ content: pack, clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    for (let i = 0; i < 60 && cap.summons.length === 0; i++) game.tick(1000);
    expect(cap.summons).toHaveLength(1);
    // e3 hp 90 × 层倍率 1.2 = 108 × 召唤 mult 0.5 = 54（与 minionViewOf 同一组合面）。
    expect(combatOf(game).summons.map((m) => m.hp)).toEqual([54, 54]);
  });

  it('普通敌人零扰动：无 bosses 节 → 无召唤槽位活动', () => {
    const game = createGame({ content: makeCombatPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.victories.length === 0; i++) game.tick(1000);
    expect(cap.victories).toHaveLength(1);
    expect(cap.summons).toHaveLength(0);
  });
});

describe('#30 · 中途存档往返（召唤物态随战斗态恢复）', () => {
  it('存档 → 恢复：召唤槽位原样续战（hp 保留、不重触发召唤、击杀后续演至胜利）', () => {
    const game = createGame({ content: makeSummonPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.summons.length === 0; i++) game.tick(1000);
    // 打残首只召唤物（不击杀）：召唤后玩家计时器刚归零，恰推进一击
    //（2200ms 间隔；单击伤害上限 ~30 < 45，必不击杀）。
    game.tick(2200);
    const before = combatOf(game);
    expect(before.summons[0]!.hp).toBeGreaterThan(0);
    expect(before.summons[0]!.hp).toBeLessThan(45);

    const resumed = createGame({ content: makeSummonPack(), clock: new ManualClock(), save: game.snapshot(), seed: 7 });
    const cap2 = capture();
    wire(resumed, cap2);
    const restored = combatOf(resumed);
    expect(restored.summons).toEqual(before.summons); // {enemyId, phase, hp, et} 逐槽还原
    for (let i = 0; i < 200 && cap2.victories.length === 0; i++) resumed.tick(1000);
    expect(cap2.summons).toHaveLength(0); // 恢复不重播召唤
    expect(cap2.victories).toHaveLength(1);
    expect(cap2.attacks.some((e) => e.data?.side === 'player' && e.data?.enemyId === 'e1')).toBe(true);
  });

  it('恢复侧防御过滤：敌已移除/阶段越界/hp ≤ 0/Boss 定义移除 → 槽位弃置不崩', () => {
    const game = createGame({ content: makeSummonPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.summons.length === 0; i++) game.tick(1000);
    const save = game.snapshot();
    const raw = save.state as { combat: { summons: Array<Record<string, unknown>> } };
    raw.combat.summons = [
      { enemyId: 'ghost', phase: 1, hp: 45, et: 0 }, // 敌不存在
      { enemyId: 'e3', phase: 9, hp: 45, et: 0 }, // 阶段越界
      { enemyId: 'e3', phase: 1, hp: 0, et: 0 }, // 死亡槽位
      { enemyId: 'e3', phase: 1, hp: 45, et: 500 }, // 合法槽位
    ];
    const resumed = createGame({ content: makeSummonPack(), clock: new ManualClock(), save, seed: 7 });
    expect(combatOf(resumed).summons).toEqual([{ enemyId: 'e3', phase: 1, hp: 45, et: 500 }]);

    // Boss 定义移除（包变更）：召唤物随 bossPhase 一并清场归位。
    const plainSave = game.snapshot();
    (plainSave.state as { combat: { summons: unknown } }).combat.summons = [
      { enemyId: 'e3', phase: 1, hp: 45, et: 0 },
    ];
    const plainResumed = createGame({ content: makeCombatPack(), clock: new ManualClock(), save: plainSave, seed: 7 });
    expect(combatOf(plainResumed).summons).toEqual([]);
    expect(combatOf(plainResumed).bossPhase).toBe(-1);
  });
});

describe('#30 · 召唤投影与抽签（bosses.ts 单点）', () => {
  it('summonMinionOf：mult 乘区投影 hp/atk/def；阶段越界/池行缺失 = undefined', () => {
    const pack = makeSummonPack();
    const boss = bossDefOf(makeSummonPack());
    const minion = summonMinionOf(pack, boss, 1, 'e3')!;
    expect(minion.hp).toBe(45); // 90 × 0.5
    expect(minion.atk).toBe(7); // 13 × 0.5 = 6.5 → round 7
    expect(minion.def).toBe(4); // 缺省 = 原值
    expect(minion.gold).toEqual(findEnemy(pack, 'e3')!.gold); // 收益面不投影
    expect(summonMinionOf(pack, boss, 5, 'e3')).toBeUndefined(); // 阶段越界
    expect(summonMinionOf(pack, boss, 0, 'e3')).toBeUndefined(); // 该阶段无池
  });

  it('pickSummonEntry：权重按占比归一化，非法权重/缺失敌剔出有效池', () => {
    const pack = makeVariedPack();
    const pool = summonPoolOf(bossDefOf(makeVariedPack()), 0);
    expect(pool).toHaveLength(3);
    let zeroes = 0;
    let ones = 0;
    for (let i = 0; i < 400; i++) {
      const entry = pickSummonEntry(pack, pool, seededPick(i));
      expect(entry).toBeDefined();
      if (entry!.enemy === 'e3') zeroes += 1;
      else ones += 1;
    }
    // weight 1:3 → 频率约 1/4 : 3/4（容忍带宽）；ghost 恒不出现（重侧占优）。
    expect(zeroes).toBeGreaterThan(40);
    expect(zeroes).toBeLessThan(160);
    expect(ones).toBeGreaterThan(200);
    expect(summonPoolOf(bossDefOf(makeVariedPack()), 9)).toEqual([]); // 阶段越界 = 空池
  });
});

/* ---------- 测试辅助 ---------- */

const bossDefOf = (pack: GameContent): BossView => (pack as { bosses: BossView[] }).bosses[0]!;

/** 确定性掷点序列（i 决定相位，均匀覆盖 [0,1)）。 */
function seededPick(i: number): () => number {
  let n = (i * 2654435761) % 4294967296;
  return () => {
    n = (n * 48271) % 2147483647;
    return (n % 100000) / 100000;
  };
}
