import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  affinityMultiplier,
  createGame,
  findEnemy,
  makeAttackText,
  pickElementFlavor,
  signatureOf,
  type Contribution,
  type GameContent,
  type GameEvent,
} from '../src/index.js';
import type { GameState } from '../src/state.js';
import { makeCombatPack } from './fixtures.js';

/**
 * 系别第一波（issue #15，ADR-012 结构签名）：
 * - 金·破防：受击者 def 临时降低 → 伤害档位跃迁（对未破防期望值判档）；
 * - 水·滞缓：敌方攻击间隔临时延长；
 * - 风·迅疾：自身攻击间隔临时缩短；
 * - 雷·霆爆：复用暴击体系，暴击专属风味句；
 * - 亲和度：受某系攻击的伤害调整百分点（正=易伤克制，负=抗性被克）；
 * - elementFlavor：起手/后果/克制/被克风味句池，攻方系别路由；
 * - 临时态只在闭包内（存档零新字段），恢复即散；
 * - 玩家攻侧聚合语境带 element → 系别条件修饰符（攻/抗双向）走 ADR-011 管线。
 * 系数/时长全在 content（elements[].signature / enemy.affinities），引擎零写死。
 */

const rng = (): number => 0.5; // 波动 1.0、暴击不中（50 ≥ 5）、掉落不中

/** 系别测试包：四系注册 + 机械签名 + 系别武器 + 高防木桩/亲和 Boss + 风味池。 */
function makeElementPack(): GameContent {
  const base = makeCombatPack();
  return {
    ...base,
    items: [
      ...base.items,
      { id: 'sword_metal', name: '重剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, verbStyle: 'sword', bonuses: { atk: 6 }, element: 'metal' },
      { id: 'sword_water', name: '寒泉剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, verbStyle: 'sword', bonuses: { atk: 6 }, element: 'water' },
      { id: 'sword_wind', name: '清风剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, verbStyle: 'sword', bonuses: { atk: 6 }, element: 'wind' },
      { id: 'sword_thunder', name: '雷纹剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, verbStyle: 'sword', bonuses: { atk: 6 }, element: 'thunder' },
    ],
    elements: [
      { id: 'metal', name: '金', signature: { primitive: 'defenseBreak', value: 0.5, duration: 8000 } },
      { id: 'water', name: '水', signature: { primitive: 'slow', value: 0.5, duration: 8000 } },
      { id: 'wind', name: '风', signature: { primitive: 'swift', value: 0.5, duration: 8000 } },
      { id: 'thunder', name: '雷' },
      { id: 'fire', name: '火' },
    ],
    enemies: [
      ...base.enemies,
      // 高防木桩：破防前后减伤差足够拉开伤害档（def 40，defenseK 120）。
      {
        id: 'etank',
        name: '石傀',
        icon: '石',
        level: 1,
        kind: 'claw',
        hp: 500000,
        atk: 1,
        def: 40,
        attackInterval: 100000,
        exp: 5,
        gold: { min: 1, max: 2 },
        drops: [],
      },
      // 亲和 Boss：水克火易伤（+50）、火克金抗性（−50）——五行相克由 content 表达。
      {
        id: 'eboss',
        name: '炎兽',
        icon: '炎',
        level: 1,
        kind: 'claw',
        hp: 500000,
        atk: 1,
        def: 2,
        attackInterval: 100000,
        exp: 5,
        gold: { min: 1, max: 2 },
        drops: [],
        element: 'fire',
        affinities: { water: 50, metal: -50 },
      },
      // 陪练木桩：正常出招节奏（2800ms）打不死，供水/风系间隔断言用。
      {
        id: 'esparr',
        name: '木桩',
        icon: '桩',
        level: 1,
        kind: 'claw',
        hp: 500000,
        atk: 1,
        def: 2,
        attackInterval: 2800,
        exp: 5,
        gold: { min: 1, max: 2 },
        drops: [],
      },
    ],
    combatText: {
      ...base.combatText,
      moves: { ...base.combatText.moves, etank: ['石压'], eboss: ['炎扑'] },
      elementFlavor: {
        metal: {
          attacks: ['金锐之气撕开{defender}的护体罡气——破防了！'],
          resists: ['金锐之气被赤焰煞气压了下去，锋芒顿挫。'],
        },
        water: {
          attacks: ['寒潮涌动，{defender}身形一滞。'],
          counters: ['寒潮暴涨，赤焰煞气遇水即熄！'],
        },
        wind: { attacks: ['罡风绕体，你的剑势愈急。'] },
        thunder: {
          attacks: ['雷光缠绕剑锋。'],
          crits: ['霆爆！紫雷自九天而落，在{defender}周身炸成雷狱！'],
        },
        fire: { attacks: ['炎潮般的煞气翻涌而至。'] },
      },
    },
  } as GameContent;
}

/** 佩戴指定武器的存档（寻常档无词条 → atk = 基线 11 + 6 = 17）。 */
function saveWith(itemId: string) {
  return {
    version: 1 as const,
    time: 0,
    state: {
      gold: 0,
      hp: 112,
      items: {},
      skills: { fight: { xp: 0 } },
      activity: null,
      gear: [{ uid: 1, itemId, rarity: 'common', affixes: [] }],
      equips: { weapon: 1 },
      buffs: {},
      combat: null,
      autoFight: false,
      autoEat: false,
      lastEncounter: {},
    },
  };
}

interface AttackEvent {
  readonly dmg: number;
  readonly tier: string;
  readonly crit: boolean;
  readonly text: string;
  readonly element?: unknown;
}

/** 推进 totalMs（按 5000ms 步长），收集玩家/敌方攻击事件。 */
function fight(
  game: ReturnType<typeof createGame>,
  enemyId: string,
  totalMs: number,
): { player: AttackEvent[]; enemy: AttackEvent[] } {
  game.dispatch({ type: 'combat:start', payload: { enemyId } });
  const player: AttackEvent[] = [];
  const enemy: AttackEvent[] = [];
  let stepped = 0;
  while (stepped < totalMs) {
    game.tick(5000);
    stepped += 5000;
    for (const event of game.events.drain()) {
      if (event.type !== 'attack') continue;
      const data = event.data as Record<string, unknown>;
      const entry: AttackEvent = {
        dmg: data.dmg as number,
        tier: data.tier as string,
        crit: data.crit as boolean,
        text: String(data.text ?? ''),
        element: data.element,
      };
      (data.side === 'player' ? player : enemy).push(entry);
    }
  }
  return { player, enemy };
}

/* ==================== 纯机制单元 ==================== */

describe('#15 · 亲和度乘区', () => {
  it('百分点亲和 → 乘数；缺省/非法 = 1（凡击同律）', () => {
    expect(affinityMultiplier(undefined)).toBe(1);
    expect(affinityMultiplier(0)).toBe(1);
    expect(affinityMultiplier(50)).toBe(1.5);
    expect(affinityMultiplier(-50)).toBe(0.5);
    expect(affinityMultiplier(-100)).toBe(0); // 全抗 → dmg 钳 1（下限在调用方）
    expect(affinityMultiplier(Number.NaN)).toBe(1);
  });
});

describe('#15 · elementFlavor 路由', () => {
  const pools = {
    elementFlavor: {
      thunder: { attacks: ['雷光缠绕剑锋。'], crits: ['霆爆！紫雷落在{defender}周身！'] },
      metal: { attacks: ['破防了！'], resists: ['锋芒顿挫。'] },
      water: { attacks: ['身形一滞。'], counters: ['遇水即熄！'] },
    },
  };

  it('被克（亲和 < 0）→ resists 池优先', () => {
    expect(pickElementFlavor(pools, 'metal', -50, false, rng)).toBe('锋芒顿挫。');
  });

  it('克制（亲和 > 0）→ counters 池优先', () => {
    expect(pickElementFlavor(pools, 'water', 50, true, rng)).toBe('遇水即熄！');
  });

  it('暴击 + crits 池 → 霆爆专属；普通击走 attacks 池', () => {
    expect(pickElementFlavor(pools, 'thunder', undefined, true, rng)).toBe('霆爆！紫雷落在{defender}周身！');
    expect(pickElementFlavor(pools, 'thunder', undefined, false, rng)).toBe('雷光缠绕剑锋。');
  });

  it('无系别 / 池缺失 → 空串（不造句）；resists 缺池回落 attacks', () => {
    expect(pickElementFlavor(pools, undefined, undefined, false, rng)).toBe('');
    expect(pickElementFlavor(pools, 'wind', undefined, false, rng)).toBe('');
    expect(pickElementFlavor(pools, 'water', 50, false, rng)).toBe('遇水即熄！');
  });

  it('makeAttackText 追加风味句并填 {defender} 槽', () => {
    const text = makeAttackText(
      { ...pools, verbs: { basic: [{ v: '击', limbs: ['面门'] }] }, moves: { basic: ['搏兔一击'] }, cons: { hit: { light: ['{defender}轻哼，受创{d}点。'] } }, templates: { playerLight: ['你一招「{move}」。'] } },
      {
        side: 'player',
        enemyName: '炎兽',
        moveKey: 'basic',
        verbStyle: 'basic',
        weaponName: '雷纹剑',
        dmg: 10,
        crit: false,
        atk: 11,
        defenderDef: 2,
        defenderHp: 30,
        defenderMaxHp: 60,
        element: 'thunder',
      },
      rng,
    );
    expect(text).toContain('你一招「搏兔一击」。');
    expect(text).toContain('雷光缠绕剑锋。');
    const resist = makeAttackText(
      { ...pools, verbs: { basic: [{ v: '击', limbs: ['面门'] }] }, moves: { basic: ['搏兔一击'] }, cons: { hit: { light: ['{defender}轻哼，受创{d}点。'] } }, templates: { playerLight: ['你一招「{move}」。'] } },
      {
        side: 'player',
        enemyName: '炎兽',
        moveKey: 'basic',
        verbStyle: 'basic',
        weaponName: '重剑',
        dmg: 10,
        crit: false,
        atk: 11,
        defenderDef: 2,
        defenderHp: 30,
        defenderMaxHp: 60,
        element: 'metal',
        affinity: -50,
      },
      rng,
    );
    expect(resist).toContain('锋芒顿挫。');
  });
});

describe('#15 · 内容视图投影', () => {
  it('elementsOf/findElementOf/signatureOf：签名透明投影，未注册回 undefined', () => {
    const pack = makeElementPack();
    expect(signatureOf(pack, 'metal')).toEqual({ primitive: 'defenseBreak', value: 0.5, duration: 8000 });
    expect(signatureOf(pack, 'thunder')).toBeUndefined();
    expect(signatureOf(pack, 'nobody')).toBeUndefined();
  });

  it('EnemyView.affinities 投影（#25 预留字段的引擎消费面）', () => {
    const pack = makeElementPack();
    expect(findEnemy(pack, 'eboss')?.affinities).toEqual({ water: 50, metal: -50 });
    expect(findEnemy(pack, 'e1')?.affinities).toBeUndefined();
  });
});

/* ==================== 战斗事件流签名（验收①：可见且可断言） ==================== */

describe('#15 · 金·破防（伤害档位跃迁）', () => {
  it('首击凡伤，破防生效后 def 减半 → 档位 mid 跃迁 heavy', () => {
    const game = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_metal'), rng });
    const { player } = fight(game, 'etank', 12000);
    expect(player.length).toBeGreaterThanOrEqual(3);
    // 首击：def 40 → dmg = round(17×(1−40/160)) = 13，r≈1.02 → mid
    expect(player[0]).toMatchObject({ dmg: 13, tier: 'mid', element: 'metal' });
    // 破防后：def 20 → dmg = round(17×(1−20/160)) = 15，对未破防期望 r≈1.18 → heavy
    expect(player[1]).toMatchObject({ dmg: 15, tier: 'heavy' });
    expect(player[1]!.text).toContain('破防了！');
  });

  it('临时态到期回落（duration < tick 步长 → 每 tick 首击凡伤）', () => {
    const pack = makeElementPack();
    (pack.elements as Array<Record<string, unknown>>).splice(0, 1, {
      id: 'metal',
      name: '金',
      signature: { primitive: 'defenseBreak', value: 0.5, duration: 3000 },
    });
    const game = createGame({ content: pack, clock: new ManualClock(), save: saveWith('sword_metal'), rng });
    // tick 取攻击间隔（2200ms）的整倍数 4400：恰 2 击/tick、进度零结转；
    // duration 3000 < 4400 → 每 tick 首击时临时态已过期（凡伤并续上破防），
    // 同 tick 次击在效（破防伤）。逐 tick 交替 [凡伤, 破防] 即「到期回落」证据。
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'etank' } });
    const hits: AttackEvent[] = [];
    for (let i = 0; i < 3; i++) {
      game.tick(4400);
      for (const event of game.events.drain()) {
        if (event.type === 'attack' && event.data?.side === 'player') {
          hits.push(event.data as unknown as AttackEvent);
        }
      }
    }
    expect(hits.length).toBe(6);
    for (const [odd, hit] of hits.entries()) {
      expect(hit).toMatchObject(odd % 2 === 0 ? { dmg: 13, tier: 'mid' } : { dmg: 15, tier: 'heavy' });
    }
  });
});

describe('#15 · 水·滞缓与风·迅疾（攻击间隔变化）', () => {
  it('水系武器：同窗口内敌方出招次数少于凡击', () => {
    const plain = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_thunder'), rng });
    const water = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_water'), rng });
    // 两把武器同为 atk+6：唯一变量是水系滞缓（雷系零机械原语 = 凡击基线）
    const a = fight(plain, 'esparr', 30000);
    const b = fight(water, 'esparr', 30000);
    expect(a.enemy.length).toBeGreaterThan(0);
    expect(b.enemy.length).toBeGreaterThan(0);
    expect(b.enemy.length).toBeLessThan(a.enemy.length);
    expect(b.player[0]!.text).toContain('身形一滞');
  });

  it('风系武器：同窗口内自身出招次数多于凡击', () => {
    const plain = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_thunder'), rng });
    const wind = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_wind'), rng });
    const a = fight(plain, 'esparr', 30000);
    const b = fight(wind, 'esparr', 30000);
    expect(b.player.length).toBeGreaterThan(a.player.length);
    expect(b.player[0]!.text).toContain('剑势愈急');
  });
});

describe('#15 · 雷·霆爆（暴击专属文案）与亲和度', () => {
  it('雷系暴击走霆爆风味句，事件带 element', () => {
    const game = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_thunder'), rng: () => 0.02 });
    const { player } = fight(game, 'etank', 8000);
    expect(player.length).toBeGreaterThan(0);
    expect(player[0]!.crit).toBe(true);
    expect(player[0]!.text).toContain('霆爆');
    expect(player[0]!.element).toBe('thunder');
  });

  it('被克（火克金 −50）：伤害减半、档位读轻、负面文案', () => {
    const game = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_metal'), rng });
    const { player } = fight(game, 'eboss', 8000);
    expect(player.length).toBeGreaterThan(0);
    // dmgBase = round(17×(1−2/122)) = 17 → ×0.5 = 8.5 → round = 9；r = 9/16.72 → light
    expect(player[0]).toMatchObject({ dmg: 9, tier: 'light', element: 'metal' });
    expect(player[0]!.text).toContain('锋芒顿挫');
  });

  it('克制（水克火 +50）：伤害 ×1.5、档位跃迁、克制文案', () => {
    const game = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_water'), rng });
    const { player } = fight(game, 'eboss', 8000);
    expect(player.length).toBeGreaterThan(0);
    // 17 × 1.5 = 25.5 → 26；r = 26/16.72 ≥ 1.5 → deadly
    expect(player[0]).toMatchObject({ dmg: 26, tier: 'deadly', element: 'water' });
    expect(player[0]!.text).toContain('遇水即熄');
  });

  it('敌方系别攻击带风味句（攻方系别路由，无受击亲和语境）', () => {
    const pack = makeElementPack();
    (pack.enemies as Array<Record<string, unknown>>).push({
      id: 'efire',
      name: '火蜥',
      icon: '火',
      level: 1,
      kind: 'claw',
      hp: 500000,
      atk: 1,
      def: 0,
      attackInterval: 2800,
      exp: 5,
      gold: { min: 1, max: 2 },
      drops: [],
      element: 'fire',
    });
    const game = createGame({ content: pack, clock: new ManualClock(), save: saveWith('sword_thunder'), rng });
    const { enemy } = fight(game, 'efire', 10000);
    expect(enemy.length).toBeGreaterThan(0);
    expect(enemy[0]!.text).toContain('炎潮般的煞气');
    expect(enemy[0]!.element).toBe('fire');
  });

  it('无系别（凡击）：无亲和调整、无风味句、事件不带 element', () => {
    const game = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword1'), rng });
    const { player } = fight(game, 'eboss', 8000);
    expect(player.length).toBeGreaterThan(0);
    expect(player[0]).toMatchObject({ dmg: 17, tier: 'mid' });
    expect(player[0]!.element).toBeUndefined();
    expect(player[0]!.text).not.toContain('遇水即熄');
  });
});

/* ==================== 临时态不落盘 + 系别条件修饰符 ==================== */

describe('#15 · 抗性/临时态不进存档新字段', () => {
  it('破防生效中快照：combat 态零新增键；恢复后临时态散尽', () => {
    const clock = new ManualClock();
    const pack = makeElementPack();
    const game = createGame({ content: pack, clock, save: saveWith('sword_metal'), rng });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'etank' } });
    game.tick(5000); // 首击已上破防（duration 8000 仍在效）
    const combat = (game.snapshot().state as unknown as GameState).combat;
    expect(combat).not.toBeNull();
    expect(Object.keys(combat!).sort()).toEqual(['bossPhase', 'crits', 'ehp', 'enemyId', 'et', 'pt', 'respT', 'rounds', 'tiers']);

    // 存档恢复（新实例）：临时态闭包不随档 → 破防散尽，次击回凡伤。
    const save = game.snapshot();
    const restored = createGame({ content: makeElementPack(), clock: new ManualClock(), save, rng });
    restored.dispatch({ type: 'combat:start', payload: { enemyId: 'etank' } });
    restored.tick(2200);
    const hit = restored.events
      .drain()
      .find((event: GameEvent) => event.type === 'attack' && event.data?.side === 'player');
    expect((hit!.data as Record<string, unknown>).dmg).toBe(13);
  });
});

describe('#15 · 系别条件修饰符（玩家攻侧语境带 element）', () => {
  const thunderContribution: Contribution = {
    modifier: { stat: 'atk', zone: 'flat', value: 100, condition: { element: 'thunder' } },
    source: { id: 't_x', kind: 'test' },
  };

  it('雷系武器命中条件 → atk +100 入管；凡击武器不命中', () => {
    const thunder = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword_thunder'), rng, contributions: [thunderContribution] });
    const plain = createGame({ content: makeElementPack(), clock: new ManualClock(), save: saveWith('sword1'), rng, contributions: [thunderContribution] });
    const a = fight(thunder, 'etank', 8000);
    const b = fight(plain, 'etank', 8000);
    // 雷：dmg = round((17+100)×(1−40/160)) = round(87.75) = 88；凡击：13
    expect(a.player[0]).toMatchObject({ dmg: 88 });
    expect(b.player[0]).toMatchObject({ dmg: 13 });
  });
});
