import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  createGame,
  gearContributions,
  makeGear,
  type GameContent,
  type GameEvent,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #021 批 4 验收：语义键域开放（P1-2/N3/N4）。
 *
 * 铁律检验法：新增 stat 键（幸运）/ 新增动词风格 / 改敌人受击风格
 * = 纯 JSON 改动不改码。schema 侧负路径在 @wendao/content pack.test.ts，
 * 这里证引擎消费侧键域贯通（bonuses 投影、verbStyle 解析、enemy.kind）。
 */

/** 带佩戴武器的存档（武器随包声明 verbStyle）。 */
function saveWithWeapon(): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gp: 0,
      hp: 112,
      items: {},
      skills: { fight: { xp: 0 } },
      activity: null,
      gear: [{ uid: 1, itemId: 'sword1', rarity: 'common', affixes: [] }],
      equips: { weapon: 1 },
      buffs: {},
      combat: null,
      autoFight: false,
      autoEat: false,
      lastEncounter: {},
    },
  };
}

/** 首个匹配侧别的攻击事件文本。 */
function firstAttackText(game: ReturnType<typeof createGame>, side: string): string {
  const attack = game.events
    .drain()
    .find((event: GameEvent) => event.type === 'attack' && event.data?.side === side);
  return String(attack?.data?.text ?? '');
}

describe('#021 · 新增 stat 键 = 纯 JSON（N3 键域贯通）', () => {
  it('幸运键：模板加成原值参与标尺、投影为 flat 贡献、词条池可掷', () => {
    const pack = {
      ...makeCombatPack(),
      affixPool: [{ name: '天幸', stat: 'luck', scale: 0.5 }],
    } as unknown as GameContent;
    // 标尺 = max(攻 10, 幸运 4（原值参与）, 兜底 3) = 10；词条 val = round(10×0.5×1.0) = 5
    const gear = makeGear(pack, 'sword1', { atk: 10, luck: 4 }, 1, () => 0.5, 'rare');
    expect(gear.affixes).toEqual([{ name: '天幸', stat: 'luck', val: 5 }]);
    // 投影开放键域：模板键逐个投影（rare mult 1.3 → atk 13 / luck 5）+ 词条 luck 5
    const contributions = gearContributions(pack, gear, { atk: 10, luck: 4 }, '青锋剑');
    expect(contributions.map((c) => `${c.modifier.stat}:${c.modifier.value}`)).toEqual([
      'atk:13',
      'luck:5',
      'luck:5',
    ]);
  });
});

describe('#021 · 玩家动词风格随武器 verbStyle（P1-2 解绑）', () => {
  it('武器声明 verbStyle: magic → 法杖走 magic 池（纯 JSON 改动）', () => {
    const pack = makeCombatPack() as GameContent;
    (pack as { items: Array<{ id: string; verbStyle?: string }> }).items.find(
      (item) => item.id === 'sword1',
    )!.verbStyle = 'magic';
    const game = createGame({ content: pack, clock: new ManualClock(), save: saveWithWeapon(), seed: 42 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    game.tick(2500); // 玩家间隔 2200 → 首击
    expect(firstAttackText(game, 'player')).toContain('摄向青鬃狼的眉心');
  });

  it('无武器 → fist 兜底池（历史行为不变）', () => {
    const game = createGame({ content: makeCombatPack(), clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    game.tick(2500);
    expect(firstAttackText(game, 'player')).toContain('击向青鬃狼的面门');
  });

  it('武器缺 verbStyle 声明 → 回落 fist 兜底池（引擎零内嵌 sword 规则）', () => {
    const pack = makeCombatPack() as GameContent;
    const sword = (pack as { items: Array<{ id: string; verbStyle?: string }> }).items.find(
      (item) => item.id === 'sword1',
    )!;
    delete sword.verbStyle;
    const game = createGame({ content: pack, clock: new ManualClock(), save: saveWithWeapon(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    game.tick(2500);
    expect(firstAttackText(game, 'player')).toContain('击向青鬃狼的面门');
  });
});

describe('#021 · 敌人受击风格随 kind 开放（VerbStyle/EnemyKind 裁决 ⑦）', () => {
  it('敌人 kind 指向新增 staff 风格 → 动词走新池（改缺省风格 = 纯 JSON）', () => {
    const pack = makeCombatPack() as GameContent;
    const raw = pack as {
      enemies: Array<{ id: string; kind: string }>;
      combatText: { verbs: Record<string, Array<{ v: string; limbs: string[] }>> };
    };
    raw.enemies.find((enemy) => enemy.id === 'e1')!.kind = 'staff';
    raw.combatText.verbs.staff = [{ v: '卷', limbs: ['周身'] }];
    const game = createGame({ content: pack, clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    game.tick(3000); // 敌间隔 2800 → 首击
    expect(firstAttackText(game, 'enemy')).toContain('卷向你的周身');
  });
});
