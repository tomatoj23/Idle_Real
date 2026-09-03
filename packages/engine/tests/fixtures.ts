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
      // #018 N2 回归夹具：斗法技能 id 刻意 ≠ 'combat'（UI 硬编码 id 会被此改名揭穿）。
      { id: 'fight', name: '斗法', icon: '斗', kind: 'combat' },
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
      // #020 门控参数用例：3 层敌人——基线偏移 2 下 clv1 可战，偏移 0 下锁定。
      {
        id: 'e3',
        name: '赤炎虎',
        icon: '虎',
        level: 3,
        kind: 'claw',
        hp: 90,
        atk: 13,
        def: 4,
        attackInterval: 3000,
        exp: 40,
        gold: { min: 8, max: 18 },
        drops: [],
      },
    ],
    // 异宝掉率调高，便于回归统计断言（期望 = 场数 × 0.5）。
    gearDrops: [{ enemy: 'e1', chance: 0.5, pool: ['scorp_tail'] }],
    // 稀有度/词条池词表（#018，ADR-016 词表零默认）：引擎机制读此表掷点与实例化。
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1 },
      { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2 },
      { id: 'rare', name: '罕见', weight: 8, mult: 1.3, affix: 2, sell: 4 },
      { id: 'epic', name: '绝世', weight: 2, mult: 1.5, affix: 3, sell: 10, showcase: true },
    ],
    affixPool: [
      { name: '锐锋', stat: 'atk', scale: 0.3 },
      { name: '罡气', stat: 'def', scale: 0.3 },
      { name: '浑厚', stat: 'hp', scale: 1.5 },
      { name: '通明', stat: 'crit', scale: 0.25 },
    ],
    combatText: {
      // #019 起 verbs 四系按 schema 约定全配（不再依赖引擎兜底形状）。
      verbs: {
        sword: [{ v: '刺', limbs: ['咽喉'] }],
        fist: [{ v: '击', limbs: ['面门'] }],
        claw: [{ v: '抓', limbs: ['肩头'] }],
        magic: [{ v: '摄', limbs: ['眉心'] }],
      },
      moves: { fist: ['搏兔一击'], e1: ['饿虎扑食'], efatal: ['噬血狂扑'], e3: ['虎啸山林'] },
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
      // #019 批 2 扩节：句式模板/系统 note/战后摘要/对照语（与 default.json 同构）。
      templates: {
        playerLight: ['你一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
        playerHeavy: ['{opening}——一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
        playerCrit: ['{critIntro}——「{move}」倏然施出，{weapon}{verb}向{defender}的{limb}！'],
        enemyLight: ['{enemy}一式「{move}」，{verb}向你的{limb}。'],
        enemyHeavy: ['{enemy}凶性大发——「{move}」猛然施出，{verb}向你的{limb}！'],
      },
      notes: {
        retreat: ['你收势撤出战团'],
        retreatToGather: ['你收势离战，转赴修行'],
        retreatWounded: ['你气血未复，暂且退避调息'],
        retreatVictory: ['你见好就收，飘然离场'],
        reengage: ['你略定心神，再度向【{enemy}】出手'],
        start: ['剑拔弩张——你与【{enemy}】战至一处'],
        autoPill: ['你服下一枚【{item}】，气息稍定'],
      },
      summary: {
        tiers: {
          light: ['招式绵密，轻痕积胜'],
          mid: ['招招见血，稳中求进'],
          heavy: ['大开大合，重创连绵'],
          deadly: ['招招奔要害，锋芒毕露'],
        },
        base: ['{rounds} 合击倒 · {flavor}'],
        crit: ['{rounds} 合击倒 · {flavor} · {crits} 次会心'],
      },
      compare: {
        revenge: ['前番不敌，今 {rounds} 合雪耻'],
        faster: ['前番苦战 {prev} 合，今 {rounds} 合击倒'],
        slower: ['今番 {rounds} 合方克，比前番 {prev} 合多费周章'],
        even: ['与前番 {rounds} 合如出一辙'],
      },
    },
    // #019 批 2 texts 节（形状合规）：reject 展示文案走 '*' 兜底键；
    // #020 补 combat:start/level 模板验证 {level} 槽 = 敌层 − 门控偏移。
    texts: {
      fistName: '拳脚',
      reject: {
        '*': { 'bad-payload': '指令无效', 'unknown-action': '未知指令' },
        'combat:start': { level: '境界太低（需 {level} 层斗法），恐有性命之虞' },
      },
    },
  } as GameContent;
}
