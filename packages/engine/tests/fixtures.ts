import type { GameContent } from '../src/index.js';

/**
 * 形状合规的最小内容包：引擎零内容感知，测试自备形状。
 * 采青灵草 interval=3000 → 假时钟 60 游戏秒恰好 20 轮。
 */
export function makePack(): GameContent {
  return {
    skills: [
      {
        id: 'herb',
        name: '采药',
        icon: '药',
        kind: 'gather',
        activities: [
          {
            name: '采青灵草',
            unlockLevel: 1,
            interval: 3000,
            exp: 6,
            output: { item: 'herb1', count: 1 },
            byproduct: { item: 'silk', chance: 0.5 },
          },
          {
            name: '采紫云花',
            unlockLevel: 15,
            interval: 4000,
            exp: 15,
            output: { item: 'herb2', count: 1 },
          },
        ],
      },
      { id: 'combat', name: '斗法', icon: '斗', kind: 'combat' },
    ],
    items: [
      { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
      { id: 'silk', name: '灵蚕丝', icon: '蚕', type: 'mat', sell: 6 },
      { id: 'pill_heal', name: '回气丹', icon: '回', type: 'pill', sell: 18, heal: { percent: 0.3 } },
    ],
    shop: [{ item: 'pill_heal', price: 45 }],
  };
}

/** 60 游戏秒 / 3000ms 间隔。 */
export const CYCLES_60S = 20;

/**
 * 战斗切片内容包（issue #4）：在 makePack 基础上补敌人/武器/丹药/
 * 异宝掉落/战斗词库。e1 数值对齐默认包青鬃狼（hp 60）。
 */
export function makeCombatPack(): GameContent {
  return {
    ...makePack(),
    items: [
      ...makePack().items,
      { id: 'core1', name: '浊妖丹', icon: '丹', type: 'mat', sell: 25 },
      { id: 'sword1', name: '青锋剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, bonuses: { atk: 6 } },
      { id: 'scorp_tail', name: '蝎尾刺', icon: '刺', type: 'equip', slot: 'weapon', sell: 25, bonuses: { atk: 5 } },
      {
        id: 'pill_atk',
        name: '破煞丹',
        icon: '破',
        type: 'pill',
        sell: 130,
        effect: { duration: 300000, multipliers: { atk: 1.2 } },
      },
    ],
    enemies: [
      {
        id: 'e1',
        name: '青鬃狼',
        icon: '狼',
        level: 1,
        kind: 'claw',
        hp: 60,
        atk: 9,
        def: 2,
        attackInterval: 2800,
        exp: 16,
        gold: { min: 4, max: 10 },
        drops: [{ item: 'core1', chance: 0.25 }],
      },
      {
        id: 'efatal',
        name: '薄血妖',
        icon: '妖',
        level: 1,
        kind: 'claw',
        hp: 50,
        atk: 1,
        def: 0,
        attackInterval: 100000,
        exp: 5,
        gold: { min: 1, max: 2 },
        drops: [],
      },
    ],
    // 异宝掉率调高，便于回归统计断言（期望 = 场数 × 0.5）。
    gearDrops: [{ enemy: 'e1', chance: 0.5, pool: ['scorp_tail'] }],
    combatText: {
      verbs: {
        fist: [{ v: '击', limbs: ['面门'] }],
        claw: [{ v: '抓', limbs: ['肩头'] }],
      },
      moves: { fist: ['搏兔一击'], e1: ['饿虎扑食'], efatal: ['噬血狂扑'] },
      openings: ['你气沉丹田'],
      critIntro: ['你气机鼓荡'],
      cons: {
        hit: {
          light: ['{defender}轻哼，受创{d}点。'],
          mid: ['{defender}闷哼，受创{d}点。'],
          heavy: ['{defender}喷血，受创{d}点。'],
          deadly: ['{defender}摇摇欲坠，受创{d}点。'],
        },
        hurt: {
          light: ['你受创{d}点。'],
          mid: ['你闷哼，受创{d}点。'],
          heavy: ['你喷血，受创{d}点。'],
          deadly: ['你摇摇欲坠，受创{d}点。'],
        },
      },
      fatal: {
        hit: '{defender}灵光溃散——致命一击受创{d}点！',
        hurt: '你眼前一黑，受创{d}点——再挨一下要道消身殒！',
      },
    },
  } as GameContent;
}
