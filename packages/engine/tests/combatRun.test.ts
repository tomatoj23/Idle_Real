import { describe, expect, it } from 'vitest';
import { createCombatRun, makeCombatState, type CombatRunDeps } from '../src/combatRun.js';
import { fillTemplate } from '../src/combat.js';
import type { CombatState } from '../src/state.js';
import type { GameContent, GameEvent } from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #51 D4：CombatRun.step 直测——三个「首次可单测点」（聚焦选靶 / interval
 * 调度 / boss phase 跳级追赶）+ 休整到期自动再战 + 系别临时态收编
 * （applyElementProc/resetProcs）。不经 createGame：直接构造 CombatState 与
 * deps 读取器，验证窄门后的战斗状态机本体。
 *
 * 确定性纪律：断言只钉不随 rng 波动翻转的量（事件计数/目标 id/阈值次序/
 * 整态重置），伤害值域先验算留足窗口（calcDmg 波动 ±10%，mitigation 曲线
 * def/(def+120)）：
 * - atk 30 vs def 4 → 26~32（召唤物 hp 45 恰两击）；vs def 2 → 27~32（e1 hp 60 不死）
 * - atk 500 vs def 0 → 450~550（ehuge hp 1000 打 960 → 410~510，跨四阈值且必不致死）
 * - atk 500 vs efatal hp 50 → 首击必杀
 */

/** 确定性 LCG（恒 ∈ (0,1)，pickText 索引安全）。 */
function makeRandom(): () => number {
  let seed = 42;
  return () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
}

/** 基础包 + 大血木桩（hp 1000 / 不还手）：interval 与 phase 追赶的承靶敌。 */
function makeStakePack(bossPhases?: unknown[]): GameContent {
  const base = makeCombatPack() as GameContent & {
    enemies: Array<Record<string, unknown>>;
  };
  const pack = {
    ...base,
    enemies: [
      ...base.enemies,
      {
        id: 'ehuge',
        name: '古渊蛟',
        icon: '蛟',
        level: 9,
        kind: 'claw',
        hp: 1000,
        atk: 0,
        def: 0,
        attackInterval: 100000,
        exp: 10,
      },
    ],
  };
  if (!bossPhases) return pack as GameContent;
  return { ...pack, bosses: [{ enemy: 'ehuge', phases: bossPhases }] } as GameContent;
}

/** 直测 harness：本地战斗态句柄 + 捕获面 + 假时钟随 step 同步推进（与 tick 同序）。 */
function makeHarness(pack: GameContent, opts?: { atk?: number }) {
  const events: GameEvent[] = [];
  const goldLedger: Array<{ delta: number; source: string }> = [];
  const itemLedger: Array<{ itemId: string; count: number; source: string }> = [];
  const encounters = new Map<string, { rounds: number; won: boolean; at: number }>();
  const dungeonCalls: string[] = [];
  const stopNotes: Array<string | undefined> = [];
  const player = { hp: 100000, atk: opts?.atk ?? 30 };
  let combat: CombatState | null = null;
  let autoFight = true;
  let now = 0;
  const note = (key: string, vars?: Readonly<Record<string, string>>): string => {
    const notes = (pack as { combatText?: { notes?: Record<string, string[]> } }).combatText?.notes;
    const pool = notes?.[key];
    const template = Array.isArray(pool) ? pool[0] : undefined;
    return template === undefined ? key : fillTemplate(template, vars ?? {});
  };
  const deps: CombatRunDeps = {
    content: pack,
    cparams: {
      playerAttackInterval: 2200,
      critMultiplier: 1.6,
      critCap: 75,
      lowHpFraction: 0.3,
      autoEatHpFraction: 0.5,
      victoryRestMs: 1500,
      levelGateOffset: 2,
      statAtkBase: 8,
      statAtkPerLevel: 3,
      statDefBase: 2,
      statDefPerLevel: 1.2,
      statCritBase: 5,
      autoFight: true,
      autoEat: true,
      defenseK: 120,
      damageVariance: 0.1,
      tierLightMax: 0.95,
      tierMidMax: 1.05,
      tierHeavyMax: 1.5,
      criticalHpFraction: 0.15,
    },
    combatText: (pack as { combatText?: Record<string, never> }).combatText ?? {},
    random: makeRandom(),
    now: () => now,
    emit: (event) => events.push(event),
    note,
    combat: {
      get: () => combat,
      set: (next) => {
        combat = next;
      },
    },
    panel: {
      hp: () => player.hp,
      setHp: (value) => {
        player.hp = value;
      },
      maxHp: () => 100000,
      lowHp: () => player.hp < 100000 * 0.3,
      battleStats: () => ({ atk: player.atk, crit: 0, def: 2, maxHp: 100000 }),
      moveKey: () => 'basic',
      element: () => undefined,
      verbStyle: () => 'basic',
      weaponName: () => '拳脚',
      signature: () => undefined,
    },
    flags: {
      autoFight: () => autoFight,
      autoEat: () => false,
    },
    ledger: {
      gold: (delta, source) => goldLedger.push({ delta, source }),
      item: (itemId, count, source) => {
        itemLedger.push({ itemId, count, source });
        return true;
      },
      gearIncome: () => true,
      exp: (_skill, amount) => amount,
      daoYun: () => {},
    },
    combatSkill: () => undefined,
    gearSeq: {
      next: () => 1,
      commit: () => {},
    },
    encounter: {
      prevOf: (enemyId) => encounters.get(enemyId),
      record: (enemyId, rounds, won) => {
        encounters.set(enemyId, { rounds, won, at: now });
      },
    },
    dungeon: {
      current: () => null,
      advance: () => dungeonCalls.push('advance'),
      leave: () => dungeonCalls.push('leave'),
      creditFloorRewards: () => dungeonCalls.push('credit'), // #52 胜利入账窄门（直测不消费层奖励）
    },
    stopCombat: (n) => {
      stopNotes.push(n);
      combat = null;
      if (n !== undefined) events.push({ type: 'combat-note', time: now, data: { text: n } });
    },
    eatSilent: () => {},
    findHealConsumable: () => undefined,
  };
  const run = createCombatRun(deps);
  return {
    run,
    deps,
    events,
    goldLedger,
    itemLedger,
    encounters,
    dungeonCalls,
    stopNotes,
    player,
    /** 与 game.tick 同序：先推游戏内时间，再喂 step（系别临时态过期基准）。 */
    step: (ms: number) => {
      now += ms;
      run.step(ms);
    },
    setCombat: (c: CombatState | null) => {
      combat = c;
    },
    combatRef: () => combat,
    setAutoFight: (value: boolean) => {
      autoFight = value;
    },
  };
}

const playerAttacks = (events: GameEvent[]): Extract<GameEvent, { type: 'attack' }>[] =>
  events.filter(
    (e): e is Extract<GameEvent, { type: 'attack' }> => e.type === 'attack' && e.data?.side === 'player',
  );
const notesOf = (events: GameEvent[]): string[] =>
  events.filter((e) => e.type === 'combat-note').map((e) => String(e.data?.text));

describe('#51 D4 · interval 调度（出招点推进与 dt 消化）', () => {
  it('出招点对拍：2200ms 恰一击、2199ms 不补击、大步长一次追平 10 击', () => {
    const h = makeHarness(makeStakePack(), { atk: 30 });
    h.setCombat(makeCombatState('ehuge', 1000));

    h.step(2200);
    expect(playerAttacks(h.events)).toHaveLength(1);
    expect(h.combatRef()!.pt).toBe(0);
    h.step(2199); // 差 1ms 不到出招点：零事件（半拍不偷击）
    expect(playerAttacks(h.events)).toHaveLength(1);
    expect(h.combatRef()!.pt).toBe(2199);
    h.step(1);
    expect(playerAttacks(h.events)).toHaveLength(2);
    h.step(22000); // 大步长追赶：恰 10 个整间隔（假时钟全速语义）
    expect(playerAttacks(h.events)).toHaveLength(12);
    expect(h.combatRef()!.pt).toBe(0);
    // 木桩 atk 0 且间隔拉满：窗口内零敌方出招，威胁面隔离。
    expect(h.events.some((e) => e.type === 'attack' && e.data?.side === 'enemy')).toBe(false);
  });

  it('风·迅疾签名缩短玩家间隔；resetProcs 后回落基础间隔（系别临时态收编）', () => {
    // elements 注册 wind → swift 签名（比例 0.5 / 时长 5000ms），panel 现读。
    const pack = {
      ...makeStakePack(),
      elements: [{ id: 'wind', name: '风', signature: { primitive: 'swift', value: 0.5, duration: 5000 } }],
    } as GameContent;
    const h = makeHarness(pack, { atk: 30 });
    h.deps.panel.element = () => 'wind';
    h.deps.panel.signature = () => {
      const el = (pack as { elements?: Array<{ signature?: { primitive: string; value?: number; duration?: number } }> })
        .elements?.[0]?.signature;
      return el ? { ...el } : undefined;
    };
    h.setCombat(makeCombatState('ehuge', 1000));

    h.step(2200); // 首击按基础间隔；命中即续：swift 临时态生效（expiry = now + 5000）
    expect(playerAttacks(h.events)).toHaveLength(1);
    h.step(1100); // 迅疾在效：有效间隔 2200×(1−0.5)=1100 → 半窗即出第二击
    expect(playerAttacks(h.events)).toHaveLength(2);
    h.run.resetProcs(); // 开战复位门：过期归零 → 间隔回落 2200
    h.step(1100);
    expect(playerAttacks(h.events)).toHaveLength(2); // 1100 < 2200 不出招
    h.step(1100);
    expect(playerAttacks(h.events)).toHaveLength(3);
  });
});

describe('#51 D4 · 聚焦选靶（#30 集火语义）', () => {
  it('召唤物在场玩家只打最老召唤物（主目标 ehp 冻结），清场播 reengage 后回主目标', () => {
    // 与 boss-summons.test 同构的召唤包：e1 阶段 2 召 2×e3 缩影（hp 45/atk 7）。
    const base = makeCombatPack() as GameContent & { enemies: Array<Record<string, unknown>> };
    const pack = {
      ...base,
      enemies: base.enemies.map((e) =>
        e.id === 'e1' ? { ...e, attackInterval: 1000000 } : e,
      ),
      bosses: [
        {
          enemy: 'e1',
          phases: [
            { threshold: 0.6, name: '血目暴睁' },
            {
              threshold: 0.3,
              name: '护法现世',
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
    const h = makeHarness(pack, { atk: 30 });
    const c = makeCombatState('e1', 60);
    c.bossPhase = 1; // 直置阶段：召唤池即实战池（免走阈值推进）
    c.summons = [
      { enemyId: 'e3', phase: 1, hp: 45, et: 0 },
      { enemyId: 'e3', phase: 1, hp: 45, et: 0 },
    ];
    h.setCombat(c);

    // 投影门直读：敌视图 + 召唤视图组（槽位序 = 集火序，投影 hp = 90×0.5）。
    expect(h.run.enemyProjection()?.id).toBe('e1');
    const minions = h.run.minionProjections();
    expect(minions?.map((row) => row.minion.hp)).toEqual([45, 45]);

    let guard = 0;
    while (h.combatRef()!.summons.length > 0 && guard++ < 100) h.step(2200);
    expect(guard).toBeLessThan(100);
    // 集火不变量：清场（reengage note）之前的玩家攻击全部落在 e3，主目标冻结。
    const reengageAt = notesOf(h.events).findIndex((text) => text.includes('再度'));
    expect(reengageAt).toBeGreaterThanOrEqual(0);
    const reengageTime = h.events.filter((e) => e.type === 'combat-note')[reengageAt]!.time;
    for (const attack of playerAttacks(h.events)) {
      if (attack.time <= reengageTime) expect(attack.data?.enemyId).toBe('e3');
    }
    expect(h.combatRef()!.ehp).toBe(60); // 召唤窗口内主目标零掉血
    // 清场后回主目标：下一击落 e1，ehp 开始下降。
    h.step(2200);
    const last = playerAttacks(h.events).at(-1)!;
    expect(last.data?.enemyId).toBe('e1');
    expect(h.combatRef()!.ehp).toBeLessThan(60);
  });
});

describe('#51 D4 · boss phase 跳级追赶（单击跨多阈值逐级补发）', () => {
  it('一击从 0.96 打到 ≤0.51：四个阈值一次跨完，boss:phase 逐级按序补发', () => {
    const pack = makeStakePack([
      { threshold: 0.95, name: '鳞甲尽赤' },
      { threshold: 0.94, name: '怒渊翻涌' },
      { threshold: 0.93, name: '古渊开阖' },
      { threshold: 0.92, name: '蛟狂' },
    ]);
    const h = makeHarness(pack, { atk: 500 });
    const c = makeCombatState('ehuge', 960); // ratio 0.96：压线在全部阈值之上
    h.setCombat(c);

    h.step(2200); // 单击 450~550 → ehp 410~510（ratio ≤0.51）→ 必跨 0.95/0.94/0.93/0.92
    expect(playerAttacks(h.events)).toHaveLength(1);
    const phases = h.events.filter((e) => e.type === 'boss:phase');
    expect(phases.map((e) => e.data?.phase)).toEqual([1, 2, 3, 4]);
    expect(phases.map((e) => e.data?.name)).toEqual(['鳞甲尽赤', '怒渊翻涌', '古渊开阖', '蛟狂']);
    expect(h.combatRef()!.bossPhase).toBe(3);
    expect(h.combatRef()!.ehp).toBeGreaterThan(0); // 跳级不吞击杀：victory 让位（胜者先判）
    expect(h.events.some((e) => e.type === 'victory')).toBe(false);
  });
});

describe('#51 D4 · 休整到期自动再战（respT 调度 + 整态重置）', () => {
  it('首击必杀 → 休整 1500ms → 到期按 autoFight 整态重置（伤档清零 + reengage）', () => {
    const h = makeHarness(makeCombatPack(), { atk: 500 });
    const first = makeCombatState('efatal', 50);
    h.setCombat(first);

    h.step(2200); // 首击必杀 → victory（战斗态保留，respT 计休整）
    const victories = h.events.filter((e) => e.type === 'victory');
    expect(victories).toHaveLength(1);
    expect(victories[0]!.data?.enemyId).toBe('efatal');
    expect(h.combatRef()!.respT).toBe(1500);
    expect(h.combatRef()!.rounds).toBe(1);
    // 对照记录入册（won=true）。
    expect(h.encounters.get('efatal')).toMatchObject({ rounds: 1, won: true });

    h.step(1499); // 休整差 1ms：不接战
    expect(h.combatRef()!.respT).toBe(1);
    expect(notesOf(h.events).some((text) => text.includes('再度'))).toBe(false);

    h.step(2); // 到期：autoFight → 同敌整态替换（makeCombatState 单一构造源）
    const rebattle = h.combatRef()!;
    expect(rebattle).not.toBe(first); // 整态替换，无旧态别名
    expect(rebattle.enemyId).toBe('efatal');
    expect(rebattle.ehp).toBe(50); // 敌方气血恢复
    expect(rebattle.rounds).toBe(0);
    expect(rebattle.crits).toBe(0);
    expect(rebattle.bossPhase).toBe(-1); // 阶段从头演
    expect(rebattle.summons).toEqual([]);
    expect(notesOf(h.events).at(-1)).toContain('再度'); // reengage note
  });

  it('autoFight 关：休整到期停战（retreatVictory note + 战斗态清空）', () => {
    const h = makeHarness(makeCombatPack(), { atk: 500 });
    h.setAutoFight(false);
    h.setCombat(makeCombatState('efatal', 50));

    h.step(2200); // 击杀进休整
    expect(h.events.some((e) => e.type === 'victory')).toBe(true);
    h.step(1500); // 到期 → 停战序（deps.stopCombat 窄门回调）
    expect(h.stopNotes).toHaveLength(1);
    expect(h.stopNotes[0]).toContain('见好就收');
    expect(h.combatRef()).toBeNull();
  });
});
