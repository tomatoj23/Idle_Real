import { describe, expect, it } from 'vitest';
import { validateContent, validateContentPack } from '../src/index.js';
import type { ContentError, JsonSchema } from '../src/index.js';
import itemSchemaJson from '../src/schemas/item.schema.json';

/**
 * 票 #16 验收：content 预留字段（器胚×铭纹 schema + 槽位 config 节 +
 * enemies element/affinities + prototype 字段先行）。
 *
 * 预留内容一律走测试夹具，默认包不放器胚/铭纹/系别内容
 * （无机制消费方，避免污染数值快照）。
 */

const itemSchema = itemSchemaJson as unknown as JsonSchema;

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

/** 最小合法包：单 craft 技艺 + 单材料 + 单配方 + 单敌人 + 兜底文案。 */
function makeBasePack(): Record<string, any> {
  return {
    skills: [{ id: 'smith', name: '炼器', icon: '器', kind: 'craft' }],
    items: [{ id: 'ore1', name: '凡铁', icon: '铁', type: 'mat', sell: 5 }],
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
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1 },
      { id: 'epic', name: '绝世', weight: 2, mult: 1.5, affix: 3, sell: 10, showcase: true },
    ],
    affixPool: [{ name: '锐锋', stat: 'atk', scale: 0.3 }],
    combatText: {
      verbs: {
        sword: [{ v: '刺', limbs: ['咽喉'] }],
        fist: [{ v: '击', limbs: ['面门'] }],
        claw: [{ v: '抓', limbs: ['肩头'] }],
        magic: [{ v: '摄', limbs: ['眉心'] }],
      },
      moves: { fist: ['搏兔一击'], e1: ['饿虎扑食'] },
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
    },
    shop: [],
  };
}

/* ==================== 器胚（blank） ==================== */

const BLANK = {
  id: 'blank_sword1',
  name: '青锋剑胚',
  icon: '胚',
  type: 'blank',
  sell: 0,
  slot: 'weapon',
  floorRange: { min: 1, max: 20 },
  tierRange: { min: 1, max: 3 },
  preferredTags: ['offense'],
  inherentModifiers: [{ stat: 'atk', zone: 'flat', value: 2 }],
};

describe('#16 · 器胚 schema 定形', () => {
  it('合法器胚通过；空偏好/空胚纹（空集合）合法', () => {
    const items = [{ ...BLANK, preferredTags: [], inherentModifiers: [] }];
    expect(validateContent(items, itemSchema)).toEqual({ ok: true });
  });

  it('缺 slot 的器胚被 schema 拒绝（判别式字段级错误）', () => {
    const items = [{ ...BLANK }] as Array<Record<string, unknown>>;
    delete items[0].slot;
    expectError(validateContent(items, itemSchema), '/0/slot', 'required');
  });

  it('缺 floorRange / tierRange 的器胚被 schema 拒绝', () => {
    const noFloor = [{ ...BLANK }] as Array<Record<string, unknown>>;
    delete noFloor[0].floorRange;
    expectError(validateContent(noFloor, itemSchema), '/0/floorRange', 'required');

    const noTier = [{ ...BLANK }] as Array<Record<string, unknown>>;
    delete noTier[0].tierRange;
    expectError(validateContent(noTier, itemSchema), '/0/tierRange', 'required');
  });

  it('tierRange 出界（纹阶只许 T1~T3）被拒绝', () => {
    const items = [{ ...BLANK, tierRange: { min: 1, max: 4 } }];
    expectError(validateContent(items, itemSchema), '/0/tierRange/max', 'maximum');
  });

  it('器胚携带铭纹字段 → oneOf 分支 additionalProperties 拒绝', () => {
    const items = [
      { ...BLANK, tiers: [[{ stat: 'atk', zone: 'flat', value: 1 }], [], []] } as Record<string, unknown>,
    ];
    expectError(validateContent(items, itemSchema), '/0/tiers', 'additionalProperties');
  });

  it('floorRange 方向颠倒 → 语义 shape 错误', () => {
    const pack = makeBasePack();
    pack.items.push({ ...BLANK, floorRange: { min: 20, max: 1 } });
    expectError(validateContentPack(pack), '/items/1/floorRange', 'shape');
  });

  it('tierRange 方向颠倒 → 语义 shape 错误', () => {
    const pack = makeBasePack();
    pack.items.push({ ...BLANK, tierRange: { min: 3, max: 1 } });
    expectError(validateContentPack(pack), '/items/1/tierRange', 'shape');
  });

  it('胚纹乘法区 value ≤ 0 → 语义 shape 错误', () => {
    const pack = makeBasePack();
    pack.items.push({
      ...BLANK,
      inherentModifiers: [
        { stat: 'atk', zone: 'mult', value: 0 },
        { stat: 'def', zone: 'addPct', value: -120 },
      ],
    });
    expectError(validateContentPack(pack), '/items/1/inherentModifiers/0/value', 'shape');
    expectError(validateContentPack(pack), '/items/1/inherentModifiers/1/value', 'shape');
  });
});

/* ==================== 铭纹（inscription） ==================== */

const INSCRIPTION = {
  id: 'rune_edge',
  name: '锐金铭',
  icon: '锐',
  type: 'inscription',
  sell: 0,
  tiers: [
    [{ stat: 'atk', zone: 'flat', value: 3 }],
    [{ stat: 'atk', zone: 'flat', value: 6 }],
    [
      { stat: 'atk', zone: 'flat', value: 10 },
      { stat: 'atk', zone: 'addPct', value: 5, condition: { element: 'metal' } },
    ],
  ],
  tags: ['offense'],
  feature: { primitive: 'armorBreak', condition: { moveId: 'sword1' }, value: 0.2 },
};

describe('#16 · 铭纹 schema 定形', () => {
  it('合法铭纹通过；空 tags 合法', () => {
    const items = [{ ...INSCRIPTION, tags: [] }];
    expect(validateContent(items, itemSchema)).toEqual({ ok: true });
  });

  it('缺 tiers 的铭纹被 schema 拒绝（判别式字段级错误）', () => {
    const items = [{ ...INSCRIPTION }] as Array<Record<string, unknown>>;
    delete items[0].tiers;
    expectError(validateContent(items, itemSchema), '/0/tiers', 'required');
  });

  it('tiers 长度 ≠ 3 被拒绝（三阶表定长：少报 minItems，多报 maxItems）', () => {
    const short = [{ ...INSCRIPTION, tiers: INSCRIPTION.tiers.slice(0, 2) }];
    expectError(validateContent(short, itemSchema), '/0/tiers', 'minItems');

    const long = [
      { ...INSCRIPTION, tiers: [...INSCRIPTION.tiers, INSCRIPTION.tiers[0]] },
    ];
    expectError(validateContent(long, itemSchema), '/0/tiers', 'maxItems');
  });

  it('某一阶为空数组被拒绝（每阶至少一条修饰符）', () => {
    const items = [{ ...INSCRIPTION, tiers: [[], INSCRIPTION.tiers[1], INSCRIPTION.tiers[2]] }];
    expectError(validateContent(items, itemSchema), '/0/tiers/0', 'minItems');
  });

  it('condition 空对象（无任何条件维）被拒绝', () => {
    const items = [
      {
        ...INSCRIPTION,
        tiers: [
          [{ stat: 'atk', zone: 'flat', value: 3, condition: {} }],
          INSCRIPTION.tiers[1],
          INSCRIPTION.tiers[2],
        ],
      },
    ];
    expectError(validateContent(items, itemSchema), '/0/tiers/0/0/condition', 'minProperties');
  });

  it('铭纹携带器胚字段 → oneOf 分支 additionalProperties 拒绝', () => {
    const items = [{ ...INSCRIPTION, floorRange: { min: 1, max: 2 } } as Record<string, unknown>];
    expectError(validateContent(items, itemSchema), '/0/floorRange', 'additionalProperties');
  });

  it('铭纹阶内修饰符乘法区 value ≤ 0 → 语义 shape 错误', () => {
    const pack = makeBasePack();
    pack.items.push({
      ...INSCRIPTION,
      tiers: [[{ stat: 'atk', zone: 'mult', value: -1 }], INSCRIPTION.tiers[1], INSCRIPTION.tiers[2]],
    });
    expectError(validateContentPack(pack), '/items/1/tiers/0/0/value', 'shape');
  });
});

/* ==================== 空集合合法性边界 ==================== */

describe('#16 · 空集合合法性边界', () => {
  it('items: [] 仍被拒（#2 定下的节下限不放宽；「空集合合法」指器胚/铭纹的可选集合）', () => {
    expectError(validateContent([], itemSchema), '', 'minItems');
  });
});

/* ==================== enemies 系别字段（可选零破坏） ==================== */

describe('#16 · enemies element/affinities', () => {
  it('带 element/affinities 的 Boss 样例条目过校验', () => {
    const pack = makeBasePack();
    pack.enemies[0].element = 'fire';
    pack.enemies[0].affinities = { water: -50, thunder: 30 };
    const result = validateContentPack(pack);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  it('不填 element/affinities 照常通过（零破坏）', () => {
    expect(validateContentPack(makeBasePack()).ok).toBe(true);
  });

  it('未知系别被拒', () => {
    const pack = makeBasePack();
    pack.enemies[0].element = 'light';
    expectError(validateContentPack(pack), '/enemies/0/element', 'enum');
  });

  it('affinities 数值越界（−100~100 百分点）被拒', () => {
    const pack = makeBasePack();
    pack.enemies[0].affinities = { fire: -150 };
    expectError(validateContentPack(pack), '/enemies/0/affinities/fire', 'minimum');
  });

  it('affinities 非法系别键被拒', () => {
    const pack = makeBasePack();
    pack.enemies[0].affinities = { light: 10 };
    expectError(validateContentPack(pack), '/enemies/0/affinities/light', 'additionalProperties');
  });
});

/* ==================== config 槽位节 ==================== */

describe('#16 · config 槽位节', () => {
  it('合法槽位节通过；icon 省略合法（未显式写入不落盘）', () => {
    const pack = makeBasePack();
    pack.config = { slots: [{ id: 'weapon', name: '法器' }] };
    const result = validateContentPack(pack);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  it('config 缺省照常通过（可选节零破坏）', () => {
    expect(validateContentPack(makeBasePack()).ok).toBe(true);
  });

  it('config.slots 为空数组被拒', () => {
    const pack = makeBasePack();
    pack.config = { slots: [] };
    expectError(validateContentPack(pack), '/config/slots', 'minItems');
  });

  it('槽位缺 name 被拒', () => {
    const pack = makeBasePack();
    pack.config = { slots: [{ id: 'weapon' }] };
    expectError(validateContentPack(pack), '/config/slots/0/name', 'required');
  });

  it('槽位 id 重复 → duplicate', () => {
    const pack = makeBasePack();
    pack.config = {
      slots: [
        { id: 'weapon', name: '法器' },
        { id: 'weapon', name: '法宝' },
      ],
    };
    expectError(validateContentPack(pack), '/config/slots/1', 'duplicate');
  });

  it('物品 slot 未在 config.slots 定义 → xref', () => {
    const pack = makeBasePack();
    pack.items.push({ ...BLANK });
    pack.config = { slots: [{ id: 'body', name: '护体' }] };
    expectError(validateContentPack(pack), '/items/1/slot', 'xref');
  });

  it('缺 config 但物品带 slot → 仍通过（既有包零破坏）', () => {
    const pack = makeBasePack();
    pack.items.push({ ...BLANK });
    expect(validateContentPack(pack).ok).toBe(true);
  });
});

/* ==================== prototype 字段（门禁侧三检） ==================== */

describe('#16 · prototype 字段预留（ADR-015 / SexyMUD ADR-0030）', () => {
  it('合法原型链通过：父声明 prototypeKey，子 prototypeParent 指向它', () => {
    const pack = makeBasePack();
    pack.skills.push({
      id: 'smith2',
      name: '天工',
      icon: '工',
      kind: 'craft',
      prototypeKey: 'smith2',
      prototypeParent: 'smith',
    });
    pack.skills[0].prototypeKey = 'smith';
    const result = validateContentPack(pack);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  it('prototypeKey ≠ 自身 id → prototype', () => {
    const pack = makeBasePack();
    pack.skills[0].prototypeKey = 'base';
    expectError(validateContentPack(pack), '/skills/0/prototypeKey', 'prototype');
  });

  it('父原型不存在于同集合 → prototype', () => {
    const pack = makeBasePack();
    pack.skills[0].prototypeParent = 'ghost';
    expectError(validateContentPack(pack), '/skills/0/prototypeParent', 'prototype');
  });

  it('父未声明 prototypeKey → prototype（显式声明才可被继承）', () => {
    const pack = makeBasePack();
    pack.skills.push({ id: 'smith2', name: '天工', icon: '工', kind: 'craft' });
    pack.skills[1].prototypeParent = 'smith';
    expectError(validateContentPack(pack), '/skills/1/prototypeParent', 'prototype');
  });

  it('继承链成环 → prototype', () => {
    const pack = makeBasePack();
    pack.skills[0].prototypeKey = 'smith';
    pack.skills[0].prototypeParent = 'smith2';
    pack.skills.push({
      id: 'smith2',
      name: '天工',
      icon: '工',
      kind: 'craft',
      prototypeKey: 'smith2',
      prototypeParent: 'smith',
    });
    expectError(validateContentPack(pack), '/skills/0/prototypeParent', 'prototype');
    expectError(validateContentPack(pack), '/skills/1/prototypeParent', 'prototype');
  });

  it('items 同样受检：prototypeKey ≠ id → prototype', () => {
    const pack = makeBasePack();
    pack.items[0].prototypeKey = 'ore';
    expectError(validateContentPack(pack), '/items/0/prototypeKey', 'prototype');
  });

  it('enemies 同样受检：父未声明 key → prototype', () => {
    const pack = makeBasePack();
    pack.enemies.push({
      id: 'e2',
      name: '妖狼王',
      icon: '王',
      level: 8,
      kind: 'claw',
      hp: 140,
      atk: 17,
      def: 6,
      attackInterval: 2600,
      exp: 40,
      gold: { min: 12, max: 24 },
      drops: [],
      prototypeKey: 'e2',
      prototypeParent: 'e1',
    });
    expectError(validateContentPack(pack), '/enemies/1/prototypeParent', 'prototype');
  });
});
