import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  bossEnemyOf,
  createGame,
  dungeonFloorEnemyOf,
  findBossOf,
  type GameContent,
  type GameEvent,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #8 验收：Boss 机制（阶段脚本）——
 * - AC1 假时钟打 Boss：跨阈值 boss:phase 事件触发、属性修正生效、阶段文案出现；
 * - AC2 阶段脚本 100% content 定义（换包换 Boss 行为）。
 * 附带：boss.drops 专属掉落、变招（moves 覆盖）、再战重置、秘境×Boss 叠乘、
 * 存档往返、普通敌人零扰动。
 */

/** Boss 测试包：e1 两阶段（≤0.6 atk×2 + 叙事；≤0.3 间隔×0.5 + 变招）。 */
function makeBossPack(): GameContent {
  const pack = makeCombatPack() as GameContent & { combatText: { moves: Record<string, string[]> } };
  pack.combatText.moves.e1_rage = ['狂暴撕咬'];
  return {
    ...pack,
    bosses: [
      {
        enemy: 'e1',
        drops: [{ item: 'core1', chance: 1 }],
        phases: [
          {
            threshold: 0.6,
            name: '血目暴睁',
            mods: { atk: 2 },
            narration: ['【{enemy}】血目暴睁——{phase}！'],
          },
          {
            threshold: 0.3,
            name: '狂暴',
            mods: { attackInterval: 0.5 },
            moveKey: 'e1_rage',
            narration: ['【{enemy}】彻底狂暴，出手快如闪电！'],
          },
        ],
      },
    ],
  } as GameContent;
}

/** AC2 换包样张：e1 单阶段（阈值 0.5，防御 ×3，英语名）。 */
function makeStonePack(): GameContent {
  return {
    ...makeCombatPack(),
    bosses: [
      { enemy: 'e1', phases: [{ threshold: 0.5, name: 'Stone Skin', mods: { def: 3 } }] },
    ],
  } as GameContent;
}

/** 斗法修为 3 层存档：对 e1 恰 4-5 击——两阶段在击杀前确定性触发（15~18 伤/击）。 */
function midSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: { skills: { fight: { xp: 100 } }, items: {} },
  } as unknown as SaveData;
}

interface Capture {
  phases: GameEvent[];
  notes: GameEvent[];
  attacks: GameEvent[];
  victories: GameEvent[];
}

const capture = (): Capture => ({ phases: [], notes: [], attacks: [], victories: [] });

function wire(game: ReturnType<typeof createGame>, cap: Capture): void {
  game.events.subscribe((event) => {
    if (event.type === 'boss:phase') cap.phases.push(event);
    else if (event.type === 'combat-note') cap.notes.push(event);
    else if (event.type === 'attack') cap.attacks.push(event);
    else if (event.type === 'victory') cap.victories.push(event);
  });
}

describe('#8 · AC1 假时钟打 Boss（阈值推进/属性修正/阶段文案/变招）', () => {
  it('跨阈值：boss:phase 逐级触发、叙事入战报、阶段修正生效、变招生效、专属掉落', () => {
    const game = createGame({ content: makeBossPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.victories.length === 0; i++) game.tick(1000);
    expect(cap.victories.length).toBe(1);
    // 阈值推进：两阶段按序各触发一次（击杀前确定性跨过 0.6/0.3）。
    expect(cap.phases.map((e) => e.data?.phase)).toEqual([1, 2]);
    expect(cap.phases[0]!.data).toMatchObject({ enemyId: 'e1', enemyName: '青鬃狼', name: '血目暴睁' });
    expect(cap.phases[1]!.data).toMatchObject({ name: '狂暴' });
    // 阶段文案出现：叙事经 {enemy}/{phase} 填槽入战斗日志（combat-note）。
    expect(cap.notes.some((e) => String(e.data?.text).includes('血目暴睁'))).toBe(true);
    expect(cap.notes.some((e) => String(e.data?.text).includes('彻底狂暴'))).toBe(true);
    // 属性修正生效（bossEnemyOf 单一来源）：atk ×2 / attackInterval ×0.5。
    expect(bossEnemyOf(makeBossPack(), 'e1', 0)?.atk).toBe(18); // 9 × 2
    expect(bossEnemyOf(makeBossPack(), 'e1', 1)?.attackInterval).toBe(1400); // 2800 × 0.5
    // 变招生效：阶段 2 后敌方出招句改用新注册招式（e1_rage）。
    expect(
      cap.attacks.some((e) => e.data?.side === 'enemy' && String(e.data?.text).includes('狂暴撕咬')),
    ).toBe(true);
    // 专属掉落：boss.drops chance 1 → 必得 core1（与 enemy.drops 叠加）。
    expect(game.snapshot().state.items.core1).toBeGreaterThanOrEqual(1);
  });

  it('再战重置：自动再战从头演阶段（第二场 boss:phase 重新逐级触发）', () => {
    const game = createGame({ content: makeBossPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 200 && cap.victories.length < 2; i++) game.tick(1000);
    expect(cap.victories.length).toBe(2);
    expect(cap.phases.map((e) => e.data?.phase)).toEqual([1, 2, 1, 2]);
  });
});

describe('#8 · AC2 阶段脚本 100% content（换包换 Boss 行为）', () => {
  it('单阶段/不同阈值/防御修正随包走：事件与投影全部跟随', () => {
    expect(bossEnemyOf(makeStonePack(), 'e1', 0)?.def).toBe(6); // 2 × 3
    const game = createGame({ content: makeStonePack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.victories.length === 0; i++) game.tick(1000);
    expect(cap.victories.length).toBe(1);
    expect(cap.phases.map((e) => [e.data?.phase, e.data?.name])).toEqual([[1, 'Stone Skin']]);
  });
});

describe('#8 · 秘境 × Boss 叠乘与存档往返', () => {
  it('秘境层内打 Boss：层倍率在前、阶段修正在后（复合投影 + 事件照常）', () => {
    const pack = {
      ...makeBossPack(),
      dungeons: [
        {
          id: 'crypt',
          name: '妖窟',
          icon: '窟',
          floors: 2,
          layers: [
            { floor: { min: 1, max: 2 }, enemies: [{ enemy: 'e1', weight: 1 }], mult: { hp: 1.2, atk: 1.1 } },
          ],
        },
      ],
    } as GameContent;
    // 复合投影：e1 层倍率 atk 9→10（round 9.9），阶段 ×2 → 20。
    const dungeonView = dungeonFloorEnemyOf(pack, 'crypt', 1, 'e1')!;
    expect(dungeonView.atk).toBe(10);
    expect(bossEnemyOf(pack, 'e1', 0, dungeonView)?.atk).toBe(20);
    expect(bossEnemyOf(pack, 'e1', 0, dungeonView)?.hp).toBe(72); // 阶段不投影 hp

    const game = createGame({ content: pack, clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'dungeon:enter', payload: { dungeonId: 'crypt' } });
    for (let i = 0; i < 100 && cap.phases.length === 0; i++) game.tick(1000);
    expect(cap.phases.length).toBeGreaterThanOrEqual(1);
    expect(game.snapshot().state.dungeon).not.toBeNull(); // 秘境推进未被打断
  });

  it('存档往返：bossPhase 随战斗态恢复，后续阶段照常推进', () => {
    const game = createGame({ content: makeBossPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.phases.length === 0; i++) game.tick(1000);
    expect(cap.phases).toHaveLength(1);

    const resumed = createGame({ content: makeBossPack(), clock: new ManualClock(), save: game.snapshot(), seed: 7 });
    const cap2 = capture();
    wire(resumed, cap2);
    expect(resumed.snapshot().state.combat?.bossPhase).toBe(0);
    for (let i = 0; i < 60 && cap2.victories.length === 0; i++) resumed.tick(1000);
    expect(cap2.phases.map((e) => e.data?.phase)).toEqual([2]); // 第二阶段续演
    expect(cap2.victories.length).toBe(1);
  });

  it('普通敌人零扰动：无 bosses 节 → findBossOf undefined、无 boss:phase 事件', () => {
    expect(findBossOf(makeCombatPack(), 'e1')).toBeUndefined();
    expect(bossEnemyOf(makeCombatPack(), 'e1', 0)).toBeUndefined();
    const game = createGame({ content: makeCombatPack(), clock: new ManualClock(), save: midSave(), seed: 7 });
    const cap = capture();
    wire(game, cap);
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    for (let i = 0; i < 60 && cap.victories.length === 0; i++) game.tick(1000);
    expect(cap.victories.length).toBe(1);
    expect(cap.phases).toHaveLength(0);
  });
});
