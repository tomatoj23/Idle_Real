import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { createGame, type GameEvent } from '../src/index.js';
import type { GameState } from '../src/state.js';
import { makeCombatPack } from './fixtures.js';

/** drain 到出现指定类型事件为止（防御式上限）。 */
function eventsOf(game: ReturnType<typeof createGame>): GameEvent[] {
  return game.events.drain();
}

describe('验收 · 假时钟 300 游戏秒打狼', () => {
  it('胜利事件含灵石区间掉落、掉落物、combat 经验事件', () => {
    const clock = new ManualClock();
    const pack = makeCombatPack();
    const game = createGame({ content: pack, clock, seed: 42 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });

    let victory: GameEvent | undefined;
    for (let i = 0; i < 60 && !victory; i++) {
      game.tick(5000);
      victory = eventsOf(game).find((event) => event.type === 'victory');
    }
    expect(victory).toBeDefined();
    const data = victory!.data as Record<string, unknown>;
    // 灵石掉落在敌人 gold 区间内
    expect(data.gp).toBeGreaterThanOrEqual(4);
    expect(data.gp).toBeLessThanOrEqual(10);
    expect(data.summary).toBeTruthy();
    // combat 经验事件（skills combat exp 增加）
    const snap = game.snapshot().state as unknown as GameState;
    expect(snap.skills['combat']?.xp).toBeGreaterThan(0);
    expect(snap.lastEncounter['e1']).toMatchObject({ won: true });
  });

  it('佩戴稀有度武器 → snapshot.stats.atk 反映倍率+词条（经管线聚合）', () => {
    const pack = makeCombatPack();
    const save = {
      version: 1 as const,
      time: 0,
      state: {
        gp: 0,
        hp: 112,
        items: { pill_atk: 1 },
        skills: { combat: { xp: 0 } },
        activity: null,
        // 罕见剑：atk round(6×1.3)=8 + 词条锐锋 3 → flat 11；crit 词条 4
        gear: [
          { uid: 1, itemId: 'sword1', rarity: 'rare', affixes: [{ name: '锐锋', stat: 'atk', val: 3 }, { name: '通明', stat: 'crit', val: 4 }] },
        ],
        equips: { weapon: 1 },
        buffs: {},
        combat: null,
        autoFight: true,
        autoEat: true,
        lastEncounter: {},
      },
    };
    const game = createGame({ content: pack, clock: new ManualClock(), save });
    const stats = game.snapshot().stats;
    // 基线 atk = 8 + 1 层×3 = 11；装备 flat 11 → 22
    expect(stats?.atk).toBe(22);
    // 暴击：基线 5 + 词条 4 = 9
    expect(stats?.crit).toBe(9);
    // maxHp：112 基线，无血装 → 112
    expect(stats?.maxHp).toBe(112);

    // 丹药 buff（atk mult 1.2）与装备同管线叠加：round(22×1.2)=26
    game.dispatch({ type: 'pill:eat', payload: { item: 'pill_atk' } });
    expect(game.snapshot().stats?.atk).toBe(26);
  });

  it('victory 事件含 summary 画像；再战同一敌人 lastEncounter 可对照', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeCombatPack(), clock, seed: 7 });
    const victories: GameEvent[] = [];

    const fightOnce = (): void => {
      game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
      let guard = 0;
      while (guard++ < 10000) {
        game.tick(5000);
        const drained = eventsOf(game);
        const victory = drained.find((event) => event.type === 'victory');
        if (victory) {
          victories.push(victory);
          // 战斗态保留（休整），手动收势便于下一场门控
          game.dispatch({ type: 'combat:stop' });
          return;
        }
        if (drained.some((event) => event.type === 'defeat')) return;
      }
    };

    fightOnce();
    expect(victories.length).toBe(1);
    const first = victories[0]!.data as Record<string, unknown>;
    expect(String(first.summary)).toContain('合击倒');

    // 气血不足时调息（败北回血线 30% 可再战；胜后 hp 不足则脱战回血）。
    let guard = 0;
    while (guard++ < 100000) {
      const hp = (game.snapshot().state as unknown as GameState).hp;
      if (hp >= 112 * 0.3) break;
      game.tick(5000);
      eventsOf(game);
    }
    fightOnce();

    expect(victories.length).toBe(2);
    const second = victories[1]!.data as Record<string, unknown>;
    // 第二场携带同对手对照：prevEncounter 来自第一场
    expect(second.prevEncounter).toMatchObject({ won: true, rounds: first.rounds });
    expect(second.compare).toBeTruthy();
    const st = game.snapshot().state as unknown as GameState;
    expect(st.lastEncounter['e1']?.rounds).toBe(second.rounds);
  });

  it('致命一击文案在残血+重击时出现（注入 rng 定向构造）', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeCombatPack(), clock, rng: () => 0.02 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'efatal' } });
    let fatalSeen = false;
    let victory = false;
    for (let i = 0; i < 100 && !victory; i++) {
      game.tick(5000);
      for (const event of eventsOf(game)) {
        if (event.type === 'attack' && event.data?.side === 'player') {
          if (String(event.data.text).includes('灵光溃散')) fatalSeen = true;
        }
        if (event.type === 'victory') victory = true;
      }
    }
    expect(victory).toBe(true);
    expect(fatalSeen).toBe(true);
  });
});

describe('验收 · 战斗 500 场回归', () => {
  it('无未捕获异常、事件文案完备、异宝按掉率出现、日志容量受控', () => {
    const clock = new ManualClock();
    const game = createGame({ content: makeCombatPack(), clock, seed: 20260903 });
    const TOTAL = 500;
    let victories = 0;
    let defeats = 0;
    let gearDrops = 0;
    let badText = 0;
    let attackEvents = 0;
    let heavyOrDeadly = 0;
    let guard = 0;

    while (victories + defeats < TOTAL && guard++ < 200000) {
      if (!(game.snapshot().state as unknown as GameState).combat) {
        game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
      }
      game.tick(5000);
      for (const event of eventsOf(game)) {
        if (event.type === 'victory') {
          victories++;
          if (event.data?.gearDropName) gearDrops++;
        } else if (event.type === 'defeat') {
          defeats++;
        } else if (event.type === 'attack') {
          attackEvents++;
          const text = String(event.data?.text ?? '');
          if (text.length < 4 || !text.includes('点')) badText++;
          if (event.data?.side === 'player' && ['heavy', 'deadly'].includes(String(event.data.tier))) {
            heavyOrDeadly++; // 伤害档可达重/濒死（回归集）
          }
        }
      }
    }

    expect(victories + defeats).toBe(TOTAL);
    // 全部攻击事件文案完备
    expect(badText).toBe(0);
    expect(attackEvents).toBeGreaterThan(TOTAL);
    // 伤害档可达重/濒死（回归集：真实对局中出现，非仅构造比值）
    expect(heavyOrDeadly).toBeGreaterThan(0);
    // 异宝掉率 0.5：期望 250，宽区间防抖
    expect(gearDrops).toBeGreaterThan(150);
    expect(gearDrops).toBeLessThan(350);
    // 事件总线容量受控（limit 256）：drain 后队列清空
    expect(game.events.drain().length).toBeLessThanOrEqual(256);
  });
});
