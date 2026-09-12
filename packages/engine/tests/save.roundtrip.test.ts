import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import {
  cloneState,
  createGame,
  initialState,
  playerMaxHp,
  restoreState,
  STAT_KEYS,
  type GameState,
  type SaveData,
} from '../src/index.js';
import { makeCombatPack } from './fixtures.js';

/**
 * #42 验收 AC1：roundtrip property 安全网——先于字段表重构落库的恒等契约。
 *
 * 任意**合法** state（值域按 restoreState 收编域生成）：
 * - cloneState 深拷恒等（snapshot 面的契约）；
 * - save → restoreState 恒等（snapshot().state 与恢复态逐字段一致）；
 * - 未知顶层键透传不丢（ADR-013 透明区），原型污染键拒收。
 *
 * 生成器值域与恢复守卫严格对齐（合法域内 identity，不测「非法输入被
 * 规范化」——那是各守卫单测的职责，见 save/createGame/dungeon 等套件）。
 */

/** 全字段域覆盖的内容包：combat 基座 + craft/配方 + 器胚/铭纹 + 秘境 + Boss 召唤。 */
function makeRoundtripPack(): ReturnType<typeof makeCombatPack> {
  const base = makeCombatPack();
  const items = (base as { items: Array<Record<string, unknown>> }).items;
  return {
    ...base,
    skills: [
      ...(base as { skills: Array<Record<string, unknown>> }).skills,
      { id: 'smith', name: '炼器', icon: '器', kind: 'craft' },
    ],
    recipes: [
      {
        name: '炼制聚气丹',
        skill: 'smith',
        unlockLevel: 1,
        output: { item: 'consumable_heal', count: 1 },
        materials: { herb1: 2 },
        successRate: 0.75,
        interval: 3000,
        exp: 8,
      },
    ],
    items: [
      ...items,
      {
        id: 'blank_sword',
        name: '剑胚',
        icon: '胚',
        type: 'blank',
        slot: 'weapon',
        sell: 40,
        floorRange: { min: 1, max: 3 },
        tierRange: { min: 1, max: 3 },
      },
      {
        id: 'insc_lie',
        name: '裂石',
        icon: '锐',
        type: 'inscription',
        sell: 0,
        tiers: [
          [{ stat: 'atk', zone: 'flat', value: 4 }],
          [{ stat: 'atk', zone: 'flat', value: 9 }],
          [{ stat: 'atk', zone: 'flat', value: 18 }],
        ],
      },
    ],
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
    bosses: [
      {
        enemy: 'e1',
        phases: [
          { threshold: 0.6, name: '血目暴睁' },
          {
            threshold: 0.3,
            name: '护法现世',
            summons: { count: 2, enemies: [{ enemy: 'e3', weight: 1, mult: { hp: 0.5, atk: 0.5 } }] },
          },
        ],
      },
    ],
  } as ReturnType<typeof makeCombatPack>;
}

/* ---------- 确定性生成器（LCG；property 语义靠例数覆盖，不靠随机库） ---------- */

function makeRand(seed: number): () => number {
  let n = (seed >>> 0) || 1;
  return () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

const int = (rand: () => number, min: number, max: number): number =>
  min + Math.floor(rand() * (max - min + 1));
const bool = (rand: () => number, p: number): boolean => rand() < p;
const pick = <T>(rand: () => number, values: readonly T[]): T =>
  values[Math.floor(rand() * values.length)]!;

interface Coverage {
  craftActivity: boolean;
  gatherActivity: boolean;
  restingCombat: boolean;
  liveCombat: boolean;
  summons: boolean;
  inscribedGear: boolean;
  wornGear: boolean;
  dungeonRun: boolean;
  buffs: boolean;
}

/**
 * 生成一个「恢复守卫合法域内」的 state：全部 22 字段随机非退化填充。
 * 值域约束（合法域）与 restoreState 的收编规则一一对应，恒等才成立。
 */
function generateState(rand: () => number, content: Parameters<typeof initialState>[0]): GameState {
  const state = initialState(content, int(rand, 0, 4294967295));

  for (const skillId of Object.keys(state.skills)) {
    state.skills[skillId] = { xp: int(rand, 0, 30000) };
  }
  const cap = playerMaxHp(content, state.skills);
  state.hp = int(rand, 0, cap);
  state.gold = int(rand, 0, 100000);
  for (const itemId of ['herb1', 'silk', 'core1']) {
    if (bool(rand, 0.6)) state.items[itemId] = int(rand, 1, 30);
  }

  // 活动：null / gather（herb#0）/ craft（smith 配方#0）三分支。
  const actRoll = rand();
  if (actRoll < 0.3) {
    state.activity = null;
  } else if (actRoll < 0.65) {
    state.activity = { skillId: 'herb', index: 0, name: '采青灵草', progress: int(rand, 0, 3000) };
  } else {
    state.activity = { skillId: 'smith', index: 0, name: '炼制聚气丹', progress: int(rand, 0, 3000) };
  }

  // 装备：equip/器胚两底材 + 稀有度全档 + 合法词条/铭纹（纹阶 1~3 在 tierRange 域内）。
  const uids: number[] = [];
  for (let i = int(rand, 0, 2); i > 0; i--) {
    const uid = uids.length + 1;
    uids.push(uid);
    const affixes = Array.from({ length: int(rand, 0, 2) }, (_, k) => ({
      name: `词缀${k + 1}`,
      stat: pick(rand, ['atk', 'def', 'hp', 'luck'] as const),
      val: int(rand, 1, 10),
    }));
    const inscriptions = bool(rand, 0.5)
      ? [{ id: 'insc_lie', tier: int(rand, 1, 3) }]
      : undefined;
    state.gear.push({
      uid,
      itemId: pick(rand, ['sword1', 'blank_sword']),
      rarity: pick(rand, ['common', 'fine', 'rare', 'epic'] as const),
      affixes,
      ...(inscriptions ? { inscriptions } : {}),
    });
  }
  state.gearSeq = uids.length + int(rand, 0, 2);
  if (uids.length > 0 && bool(rand, 0.5)) state.equips.weapon = pick(rand, uids);

  // buff：仅收 effect 类消耗品（heal-only 的 consumable_heal 不在收编域，不生成）。
  if (bool(rand, 0.5)) state.buffs['consumable_atk'] = 1000 + int(rand, 1, 100000);

  // 战斗：常态（ehp>0）与休整期（ehp=0 ∧ respT>0）双门控分支；召唤槽全池内（#48）。
  if (bool(rand, 0.5)) {
    const resting = bool(rand, 0.2);
    state.combat = {
      enemyId: 'e1',
      ehp: resting ? 0 : int(rand, 1, 60),
      pt: int(rand, 0, 3000),
      et: int(rand, 0, 3000),
      respT: resting ? int(rand, 1, 5000) : 0,
      rounds: int(rand, 0, 50),
      crits: int(rand, 0, 10),
      tiers: {
        light: int(rand, 0, 20),
        mid: int(rand, 0, 20),
        heavy: int(rand, 0, 20),
        deadly: int(rand, 0, 20),
      },
      bossPhase: pick(rand, [-1, 0, 1]),
      summons: Array.from({ length: int(rand, 0, 2) }, () => ({
        enemyId: 'e3',
        phase: 1,
        hp: int(rand, 1, 45),
        et: int(rand, 0, 2000),
      })),
    };
  }

  if (bool(rand, 0.5)) {
    state.lastEncounter['e1'] = { rounds: int(rand, 1, 30), won: bool(rand, 0.5), at: int(rand, 0, 100000) };
  }
  state.rebirths = int(rand, 0, 50);
  state.daoYun = int(rand, 0, 500);
  state.daoYunEarned = state.daoYun + int(rand, 0, 500); // 只增不减域：累计 ≥ 余额
  state.talents = ['t_a', 't_b'].slice(0, int(rand, 0, 2)); // 无重复（去重域内生成）
  if (state.combat !== null && bool(rand, 0.5)) state.dungeon = { dungeonId: 'crypt', floor: 1 };
  if (bool(rand, 0.5)) state.dungeonBest['crypt'] = int(rand, 0, 5);
  for (const key of STAT_KEYS) {
    if (bool(rand, 0.4)) state.stats[key] = int(rand, 0, 1000);
  }
  state.achievements = ['ach_x', 'ach_y', 'ach_z'].slice(0, int(rand, 0, 3));
  if (bool(rand, 0.5)) state.autoFight = !state.autoFight;
  if (bool(rand, 0.5)) state.autoEat = !state.autoEat;
  return state;
}

function coverageOf(state: GameState, cov: Coverage): void {
  if (state.activity?.skillId === 'smith') cov.craftActivity = true;
  if (state.activity?.skillId === 'herb') cov.gatherActivity = true;
  if (state.combat !== null && state.combat.respT > 0 && state.combat.ehp === 0) cov.restingCombat = true;
  if (state.combat !== null && state.combat.ehp > 0) cov.liveCombat = true;
  if ((state.combat?.summons.length ?? 0) > 0) cov.summons = true;
  if (state.gear.some((gear) => gear.inscriptions !== undefined)) cov.inscribedGear = true;
  if (Object.keys(state.equips).length > 0) cov.wornGear = true;
  if (state.dungeon !== null) cov.dungeonRun = true;
  if (Object.keys(state.buffs).length > 0) cov.buffs = true;
}

describe('#42 roundtrip 安全网（字段表的恒等契约）', () => {
  const content = makeRoundtripPack();

  it('任意合法 state：clone 恒等 + save→restore 恒等（property ×300）', () => {
    const cov: Coverage = {
      craftActivity: false, gatherActivity: false, restingCombat: false, liveCombat: false,
      summons: false, inscribedGear: false, wornGear: false, dungeonRun: false, buffs: false,
    };
    for (let i = 1; i <= 300; i++) {
      const state = generateState(makeRand(i * 7919 + 1), content);
      coverageOf(state, cov);
      // clone 恒等（snapshot 面契约）。
      expect(cloneState(state), `clone @case ${i}`).toEqual(state);
      // save → restore 恒等（state 快照面与 snapshot() 同构：cloneState 产物）。
      const save = {
        version: 1 as const,
        time: 1000,
        state: cloneState(state) as unknown as Readonly<Record<string, unknown>>,
      };
      expect(restoreState(content, save, 777), `restore @case ${i}`).toEqual(state);
    }
    // 语料非退化：九个易退化分支都真实出现过，property 才有牙齿。
    expect(cov).toEqual({
      craftActivity: true, gatherActivity: true, restingCombat: true, liveCombat: true,
      summons: true, inscribedGear: true, wornGear: true, dungeonRun: true, buffs: true,
    });
  });

  it('clone 深拷隔离：嵌套容器变异不回渗原 state（toEqual 查不出别名共享）', () => {
    const state = generateState(makeRand(20260913), content);
    state.combat ??= {
      enemyId: 'e1', ehp: 30, pt: 0, et: 0, respT: 0, rounds: 1, crits: 0,
      tiers: { light: 1, mid: 0, heavy: 0, deadly: 0 }, bossPhase: -1,
      summons: [{ enemyId: 'e3', phase: 1, hp: 45, et: 0 }],
    };
    // 归一化：确保探测的字段都真实存在（生成器是概率性的，隔离断言要确定性）。
    state.items['herb1'] ??= 5;
    state.lastEncounter['e1'] ??= { rounds: 5, won: true, at: 100 };
    state.dungeonBest['crypt'] ??= 2;
    state.stats['kills'] ??= 3;
    state.buffs['consumable_atk'] ??= 99000;
    if (state.gear.length === 0) {
      state.gear.push({ uid: 501, itemId: 'blank_sword', rarity: 'common', affixes: [], inscriptions: [{ id: 'insc_lie', tier: 2 }] });
    }
    state.gear[0]!.inscriptions ??= [];
    if (state.dungeon === null) state.dungeon = { dungeonId: 'crypt', floor: 1 };
    if (state.activity === null) state.activity = { skillId: 'herb', index: 0, name: '采青灵草', progress: 100 };
    state.equips['weapon'] ??= state.gear[0]!.uid;

    const clone = cloneState(state);
    // 逐容器写入（含全部数组/记录/可空对象字段），原 state 必须纹丝不动。
    clone.gold = 1; clone.hp = 1; clone.gearSeq = 1; clone.rebirths = 1;
    clone.daoYun = 1; clone.daoYunEarned = 1; clone.rngSeed = 1;
    clone.autoFight = !clone.autoFight; clone.autoEat = !clone.autoEat;
    clone.items['herb1'] = 999;
    clone.skills['herb'] = { xp: 999 };
    clone.activity!.progress = 999;
    clone.equips['weapon'] = 999;
    clone.buffs['consumable_atk'] = 999;
    clone.gear[0]!.affixes.push({ name: '渗', stat: 'atk', val: 1 });
    clone.gear[0]!.inscriptions!.push({ id: '渗', tier: 1 });
    clone.combat!.ehp = 999;
    clone.combat!.tiers.light = 999;
    clone.combat!.summons[0]!.hp = 999;
    clone.lastEncounter['e1'] = { rounds: 999, won: false, at: 999 };
    clone.talents.push('渗');
    clone.dungeon!.floor = 999;
    clone.dungeonBest['crypt'] = 999;
    clone.stats['kills'] = 999;
    clone.achievements.push('渗');
    expect(state.gold).not.toBe(1);
    expect(state.hp).not.toBe(1);
    expect(state.items['herb1']).not.toBe(999);
    expect(state.skills['herb']).toEqual({ xp: expect.any(Number) });
    expect(state.skills['herb']!.xp).not.toBe(999);
    expect(state.activity!.progress).not.toBe(999);
    expect(state.equips['weapon']).not.toBe(999);
    expect(state.buffs['consumable_atk']).not.toBe(999);
    expect(state.gear[0]!.affixes).toHaveLength(clone.gear[0]!.affixes.length - 1);
    expect(state.gear[0]!.inscriptions).toHaveLength(clone.gear[0]!.inscriptions!.length - 1);
    expect(state.combat!.ehp).not.toBe(999);
    expect(state.combat!.tiers.light).not.toBe(999);
    expect(state.combat!.summons[0]!.hp).not.toBe(999);
    expect(state.lastEncounter['e1']).toEqual({ rounds: expect.any(Number), won: expect.any(Boolean), at: expect.any(Number) });
    expect(state.lastEncounter['e1']!.rounds).not.toBe(999);
    expect(state.talents).not.toContain('渗');
    expect(state.dungeon!.floor).not.toBe(999);
    expect(state.dungeonBest['crypt']).not.toBe(999);
    expect(state.stats['kills']).not.toBe(999);
    expect(state.achievements).not.toContain('渗');
  });

  it('未知顶层键透传不丢（restore/clone/snapshot 三面）；原型污染键拒收', () => {
    // JSON.parse 造 own property 形态的 __proto__（与真实坏档同构）。
    const raw = JSON.parse(
      '{ "gold": 42, "futureFlag": { "a": 1 }, "__proto__": { "polluted": 1 }, "constructor": 5, "prototype": 6 }',
    ) as Record<string, unknown>;
    const save = { version: 1 as const, time: 0, state: raw } as unknown as SaveData;

    const restored = restoreState(content, save, 7);
    expect((restored as unknown as Record<string, unknown>).futureFlag).toEqual({ a: 1 });
    const names = Object.getOwnPropertyNames(restored);
    expect(names).not.toContain('__proto__');
    expect(names).not.toContain('constructor');
    expect(names).not.toContain('prototype');

    // 未知键随快照存活（cloneState 顶层展开面）+ 二次往返不丢。
    const game = createGame({ content, clock: new ManualClock(), save });
    expect((game.snapshot().state as Record<string, unknown>).futureFlag).toEqual({ a: 1 });
    const again = restoreState(content, {
      version: 1,
      time: 0,
      state: cloneState(restored) as unknown as Readonly<Record<string, unknown>>,
    }, 7);
    expect((again as unknown as Record<string, unknown>).futureFlag).toEqual({ a: 1 });
  });

  it('引擎级往返：采集推进 → snapshot → 恢复 → state 恒等', () => {
    const game = createGame({ content, clock: new ManualClock(), seed: 7 });
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    game.tick(9000); // 3 轮：herb1 入袋（副产物 roll 推进 rngSeed）
    const first = game.snapshot();
    const resumed = createGame({ content, clock: new ManualClock(), save: first, seed: 7 });
    expect(resumed.snapshot().state).toEqual(first.state);
  });
});
