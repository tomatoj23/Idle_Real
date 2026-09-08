import { describe, expect, it } from 'vitest';
import { validateContentPack } from '../src/index.js';
import type { ContentError } from '../src/index.js';
import { shellFixture } from './fixtures.js';

/**
 * 票 #25 验收：Element 七系键域开放 + 存在性校验（循 #21 VerbStyle 先例）。
 *
 * schema 只钉键形态（`^[a-z][a-zA-Z0-9_]*$`，与 stat/verbStyle 统一），
 * elements 节是包内系别键域的唯一注册表；enemy.element / affinities 键 /
 * 铭纹条件 element 的引用合法性由语义校验对照注册表强制（xref，坏包
 * 加载期拒绝，逐字段可定位）。引擎零感知（系别只是条件匹配的不透明键，
 * 不填 element = 凡击），引擎侧消费语义由既有 modifiers.test.ts 覆盖。
 */

/** 七系官方包样式注册表（金木水火土风雷，ADR-012）。 */
const SEVEN = [
  { id: 'metal', name: '金' },
  { id: 'wood', name: '木' },
  { id: 'water', name: '水' },
  { id: 'fire', name: '火' },
  { id: 'earth', name: '土' },
  { id: 'wind', name: '风' },
  { id: 'thunder', name: '雷' },
];

/** 最小合法包：单技艺 + 材料/铭纹 + 单敌人 + 兜底文案；elements 缺省空域。 */
function makeBasePack(): Record<string, any> {
  return {
    version: '0.1.0',
    skills: [{ id: 'smith', name: '炼器', icon: '器', kind: 'craft' }],
    items: [
      { id: 'ore1', name: '凡铁', icon: '铁', type: 'mat', sell: 5 },
      {
        id: 'rune_edge',
        name: '锐金铭',
        icon: '锐',
        type: 'inscription',
        sell: 0,
        tiers: [
          [{ stat: 'atk', zone: 'flat', value: 3 }],
          [{ stat: 'atk', zone: 'flat', value: 6 }],
          [{ stat: 'atk', zone: 'addPct', value: 5, condition: { moveId: 'e1' } }],
        ],
      },
    ],
    recipes: [
      {
        name: '锻铁剑',
        skill: 'smith',
        unlockLevel: 1,
        output: { item: 'ore1', count: 1 },
        materials: { ore1: 2 },
        successRate: 1,
        interval: 4000,
        exp: 10,
      },
    ],
    enemies: [
      {
        id: 'e1',
        name: '妖狼',
        icon: '狼',
        level: 1,
        kind: 'claw',
        hp: 60,
        atk: 9,
        def: 2,
        attackInterval: 2800,
        exp: 16,
        gold: { min: 4, max: 10 },
        drops: [],
      },
    ],
    gearDrops: [],
    elements: [],
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1 },
      { id: 'epic', name: '绝世', weight: 2, mult: 1.5, affix: 3, sell: 10, showcase: true },
    ],
    affixPool: [{ name: '锐锋', stat: 'atk', scale: 0.3 }],
    combatText: {
      verbs: {
        sword: [{ v: '刺', limbs: ['咽喉'] }],
        basic: [{ v: '击', limbs: ['面门'] }],
        claw: [{ v: '抓', limbs: ['肩头'] }],
        magic: [{ v: '摄', limbs: ['眉心'] }],
      },
      moves: { basic: ['搏兔一击'], e1: ['饿虎扑食'] },
      openings: ['你足尖一点，身形快若惊鸿'],
      critIntro: ['你气机鼓荡，一式全力施为'],
      cons: {
        hit: {
          light: ['{defender}受了点轻伤，受创{d}点。'],
          mid: ['{defender}闷哼一声，受创{d}点。'],
          heavy: ['{defender}喷出一口鲜血，受创{d}点。'],
          deadly: ['{defender}摇摇欲坠，受创{d}点。'],
        },
        hurt: {
          light: ['你受创{d}点。'],
          mid: ['你闷哼一声，受创{d}点。'],
          heavy: ['你喷出一口鲜血，受创{d}点。'],
          deadly: ['你摇摇欲坠，受创{d}点。'],
        },
      },
      fatal: {
        hit: '{defender}发出一声哀鸣——这致命一击受创{d}点！',
        hurt: '你眼前一黑，受创{d}点。',
      },
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
        autoConsume: ['你服下一枚【{item}】，气息稍定'],
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
    texts: {
      basicName: '拳脚',
      reject: { '*': { 'bad-payload': '指令无效', 'unknown-action': '未知指令' } },
      shell: shellFixture(),
    },
    shop: [],
  };
}

function expectError(
  result: { readonly ok: boolean; readonly errors?: readonly ContentError[] },
  path: string,
  keyword: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  const hit = result.errors.find((e) => e.path === path && e.keyword === keyword);
  expect(hit, `期望 ${path} [${keyword}]，实际：${JSON.stringify(result.errors)}`).toBeDefined();
}

/* ==================== 注册表节形态 ==================== */

describe('#25 · elements 注册表节形态', () => {
  it('缺 elements 节 → required（节恒在，循 #21 verbs 注册表先例）', () => {
    const pack = makeBasePack();
    delete pack.elements;
    expectError(validateContentPack(pack), '/elements', 'required');
  });

  it('空注册表 + 零引用 → 通过（无系别玩法合法）', () => {
    expect(validateContentPack(makeBasePack()).ok).toBe(true);
  });

  it('注册表 id 重复 → duplicate', () => {
    const pack = makeBasePack();
    pack.elements = [
      { id: 'fire', name: '火' },
      { id: 'fire', name: '炎' },
    ];
    expectError(validateContentPack(pack), '/elements/1', 'duplicate');
  });

  it('注册表条目缺 name → required（展示名词表归 content，引擎零感知）', () => {
    const pack = makeBasePack();
    pack.elements = [{ id: 'fire' }];
    expectError(validateContentPack(pack), '/elements/0/name', 'required');
  });

  it('系别键形态非法（大写开头）→ schema pattern（键形态与 stat/verbStyle 统一）', () => {
    const pack = makeBasePack();
    pack.elements = [{ id: 'Fire', name: '火' }];
    expectError(validateContentPack(pack), '/elements/0/id', 'pattern');
  });
});

/* ==================== 合法自定义系别（验收①） ==================== */

describe('#25 · 合法自定义系别（法术学派演示）', () => {
  it('注册自定义系别后，敌人 element/affinities/铭纹条件全链引用放行', () => {
    const pack = makeBasePack();
    pack.elements = [
      { id: 'arcane', name: '奥术' },
      { id: 'holy', name: '圣光' },
      { id: 'shadow', name: '暗影' },
    ];
    pack.enemies[0].element = 'arcane';
    pack.enemies[0].affinities = { holy: -50, shadow: 30 };
    pack.items[1].tiers[2] = [
      { stat: 'atk', zone: 'addPct', value: 5, condition: { element: 'shadow' } },
    ];
    const result = validateContentPack(pack);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  it('七系官方包样式：注册金木水火土风雷 + fire 引用放行（现修仙包形态回归）', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.enemies[0].element = 'fire';
    pack.enemies[0].affinities = { water: -50, thunder: 30 };
    const result = validateContentPack(pack);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });
});

/* ==================== 未注册引用拒绝（验收②） ==================== */

describe('#25 · 未注册引用拒绝（报错逐字段可定位）', () => {
  it('enemy.element 引用未注册系别 → 逐字段 xref', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.enemies[0].element = 'light';
    expectError(validateContentPack(pack), '/enemies/0/element', 'xref');
  });

  it('affinities 键未注册 → 指向该键的 xref', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.enemies[0].affinities = { water: -50, light: 10 };
    expectError(validateContentPack(pack), '/enemies/0/affinities/light', 'xref');
  });

  it('注册表为空域时任何引用都被拒（空注册表 ≠ 放行）', () => {
    const pack = makeBasePack();
    pack.enemies[0].element = 'fire';
    expectError(validateContentPack(pack), '/enemies/0/element', 'xref');
  });

  it('铭纹三阶表条件引用未注册系别 → 逐字段 xref', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.items[1].tiers[2] = [
      { stat: 'atk', zone: 'addPct', value: 5, condition: { element: 'light' } },
    ];
    expectError(validateContentPack(pack), '/items/1/tiers/2/0/condition/element', 'xref');
  });

  it('胚纹与 feature 条件引用未注册系别 → 各自可定位', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.items[1].feature = { primitive: 'armorBreak', condition: { element: 'light' }, value: 0.2 };
    pack.items.push({
      id: 'blank_sword1',
      name: '青锋剑胚',
      icon: '胚',
      type: 'blank',
      sell: 0,
      slot: 'weapon',
      floorRange: { min: 1, max: 20 },
      tierRange: { min: 1, max: 3 },
      inherentModifiers: [{ stat: 'hp', zone: 'flat', value: 10, condition: { element: 'light' } }],
    });
    const result = validateContentPack(pack);
    expectError(result, '/items/1/feature/condition/element', 'xref');
    expectError(result, '/items/2/inherentModifiers/0/condition/element', 'xref');
  });
});

/* ==================== schema 边界不随键域放宽 ==================== */

describe('#25 · schema 边界保留', () => {
  it('affinities 数值越界（−100~100 百分点）仍被拒', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.enemies[0].affinities = { fire: -150 };
    expectError(validateContentPack(pack), '/enemies/0/affinities/fire', 'minimum');
  });

  it('affinities 键形态非法仍被 schema 拒（大写开头不过 patternProperties）', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.enemies[0].affinities = { Fire: 10 };
    expectError(validateContentPack(pack), '/enemies/0/affinities/Fire', 'additionalProperties');
  });
});

/* ==================== 机制签名与风味句（#15，ADR-012 结构签名） ==================== */

describe('#15 · elements 机制签名', () => {
  it('机械签名（破防/滞缓/迅疾）配 value+duration → 通过', () => {
    const pack = makeBasePack();
    pack.elements = [
      { id: 'metal', name: '金', signature: { primitive: 'defenseBreak', value: 0.4, duration: 8000 } },
      { id: 'water', name: '水', signature: { primitive: 'slow', value: 0.25, duration: 8000 } },
      { id: 'wind', name: '风', signature: { primitive: 'swift', value: 0.2, duration: 8000 } },
    ];
    expect(validateContentPack(pack).ok).toBe(true);
  });

  it('纯风味系（雷·霆爆零机械原语）不声明 signature → 合法', () => {
    const pack = makeBasePack();
    pack.elements = [{ id: 'thunder', name: '雷' }];
    expect(validateContentPack(pack).ok).toBe(true);
  });

  it('未注册原语（火·燃爆第二波未至）→ 假系大声拒绝（xref，逐字段可定位）', () => {
    const pack = makeBasePack();
    pack.elements = [{ id: 'fire', name: '火', signature: { primitive: 'burn', value: 0.2, duration: 5000 } }];
    expectError(validateContentPack(pack), '/elements/0/signature/primitive', 'xref');
  });

  it('机械原语缺 value / duration → 语义校验 shape（schema 只钉边界形态）', () => {
    const pack = makeBasePack();
    pack.elements = [{ id: 'metal', name: '金', signature: { primitive: 'defenseBreak' } }];
    const result = validateContentPack(pack);
    expectError(result, '/elements/0/signature/value', 'shape');
    expectError(result, '/elements/0/signature/duration', 'shape');
  });

  it('value 越界（0,1 之外）→ schema exclusiveMaximum/exclusiveMinimum', () => {
    const pack = makeBasePack();
    pack.elements = [{ id: 'metal', name: '金', signature: { primitive: 'defenseBreak', value: 1.5, duration: 8000 } }];
    expectError(validateContentPack(pack), '/elements/0/signature/value', 'exclusiveMaximum');
    pack.elements = [{ id: 'metal', name: '金', signature: { primitive: 'slow', value: 0, duration: 8000 } }];
    expectError(validateContentPack(pack), '/elements/0/signature/value', 'exclusiveMinimum');
  });

  it('signature 携带未知字段 → additionalProperties 拒绝', () => {
    const pack = makeBasePack();
    pack.elements = [
      { id: 'metal', name: '金', signature: { primitive: 'defenseBreak', value: 0.4, duration: 8000, chance: 0.5 } },
    ];
    expectError(validateContentPack(pack), '/elements/0/signature/chance', 'additionalProperties');
  });
});

describe('#15 · 武器 element 与 elementFlavor 引用面', () => {
  it('equip 武器配已注册系别 → 放行；未注册 → 逐字段 xref', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    // 武器槽物品须在 combatText.moves 注册招式名（既有校验关卡，#14 起器胚同律）。
    pack.combatText.moves.sword_w = ['雷动九天'];
    pack.items.push({ id: 'sword_w', name: '雷纹剑', icon: '剑', type: 'equip', sell: 30, slot: 'weapon', bonuses: { atk: 6 }, element: 'thunder' });
    expect(validateContentPack(pack).ok).toBe(true);
    pack.items[2].element = 'light';
    expectError(validateContentPack(pack), '/items/2/element', 'xref');
  });

  it('mat 分支不收 element（oneOf additionalProperties 拒绝）', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.items[0].element = 'fire';
    expectError(validateContentPack(pack), '/items/0/element', 'additionalProperties');
  });

  it('elementFlavor 键 = 注册系别；未注册键 → xref', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.combatText.elementFlavor = {
      thunder: { crits: ['霆爆！紫雷落在{defender}周身！'] },
    };
    expect(validateContentPack(pack).ok).toBe(true);
    pack.combatText.elementFlavor.light = { attacks: ['光'] };
    expectError(validateContentPack(pack), '/combatText/elementFlavor/light', 'xref');
  });

  it('elementFlavor 条目空池（minProperties）与未知池键 → schema 拒', () => {
    const pack = makeBasePack();
    pack.elements = SEVEN;
    pack.combatText.elementFlavor = { thunder: {} };
    expectError(validateContentPack(pack), '/combatText/elementFlavor/thunder', 'minProperties');
    pack.combatText.elementFlavor = { thunder: { openers: ['起手'] } };
    expectError(validateContentPack(pack), '/combatText/elementFlavor/thunder/openers', 'additionalProperties');
  });
});
