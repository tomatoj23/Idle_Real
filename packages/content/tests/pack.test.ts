import { describe, expect, it } from 'vitest';
import { validateContentPack } from '../src/index.js';
import type { ContentError } from '../src/index.js';
import { xiuxianPackJson } from '../src/packs/xiuxian.js';

/**
 * 跨引用语义检查的基准夹具：最小合法包。
 * 各用例在深拷贝上做单点破坏，断言字段级错误。
 */
const BASE_PACK: unknown = {
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
      ],
    },
    { id: 'smith', name: '炼器', icon: '器', kind: 'craft' },
  ],
  items: [
    { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
    { id: 'silk', name: '灵蚕丝', icon: '蚕', type: 'mat', sell: 6 },
    { id: 'sword1', name: '青锋剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, bonuses: { atk: 6 } },
    { id: 'body1', name: '布道袍', icon: '衣', type: 'equip', slot: 'body', sell: 35, bonuses: { def: 6 } },
    { id: 'pill_heal', name: '回气丹', icon: '回', type: 'pill', sell: 18, heal: { percent: 0.3 } },
  ],
  recipes: [
    {
      name: '缝布道袍',
      skill: 'smith',
      unlockLevel: 5,
      output: { item: 'body1', count: 1 },
      materials: { silk: 3 },
      successRate: 1,
      interval: 4500,
      exp: 12,
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
      drops: [{ item: 'herb1', chance: 0.4 }],
    },
  ],
  gearDrops: [{ enemy: 'e1', chance: 0.1, pool: ['sword1'] }],
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
    verbs: {
      sword: [{ v: '刺', limbs: ['咽喉'] }],
      fist: [{ v: '击', limbs: ['面门'] }],
      claw: [{ v: '抓', limbs: ['肩头'] }],
      magic: [{ v: '摄', limbs: ['眉心'] }],
    },
    moves: { fist: ['搏兔一击'], sword1: ['青虹一闪'], e1: ['饿虎扑食'] },
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
  texts: {
    fistName: '拳脚',
    reject: { '*': { 'bad-payload': '指令无效', 'unknown-action': '未知指令' } },
  },
  shop: [{ item: 'pill_heal', price: 45 }],
};

function makePack(): Record<string, any> {
  return JSON.parse(JSON.stringify(BASE_PACK));
}

/** 与 BASE_PACK 槽位引用（weapon/body）配套的槽位定义。 */
function THREE_SLOTS(): unknown {
  return [
    { id: 'weapon', name: '法器' },
    { id: 'body', name: '护体' },
  ];
}

function expectError(result: ReturnType<typeof validateContentPack>, path: string, keyword: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  const hit: ContentError | undefined = result.errors.find((e) => e.path === path && e.keyword === keyword);
  expect(hit, `期望 ${path} [${keyword}]，实际：${JSON.stringify(result.errors)}`).toBeDefined();
}

describe('validateContentPack · 跨引用检查', () => {
  it('基准夹具通过，并返回类型化内容包', () => {
    const result = validateContentPack(BASE_PACK);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.items).toHaveLength(5);
    }
  });

  it('掉落池引用不存在的物品 → 字段级 xref', () => {
    const pack = makePack();
    pack.gearDrops[0].pool[0] = 'ghost_claw';
    expectError(validateContentPack(pack), '/gearDrops/0/pool/0', 'xref');
  });

  it('异宝池引用非 equip 物品 → 字段级 xref', () => {
    const pack = makePack();
    pack.gearDrops[0].pool[0] = 'silk';
    expectError(validateContentPack(pack), '/gearDrops/0/pool/0', 'xref');
  });

  it('异宝掉落归属敌人不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.gearDrops[0].enemy = 'e99';
    expectError(validateContentPack(pack), '/gearDrops/0/enemy', 'xref');
  });

  it('武器未注册招式 → 指向该物品的 xref', () => {
    const pack = makePack();
    delete pack.combatText.moves.sword1;
    expectError(validateContentPack(pack), '/items/2', 'xref');
  });

  it('敌人未注册招式 → 指向该敌人的 xref', () => {
    const pack = makePack();
    delete pack.combatText.moves.e1;
    expectError(validateContentPack(pack), '/enemies/0', 'xref');
  });

  it('悬空招式注册键 → xref', () => {
    const pack = makePack();
    pack.combatText.moves.sword9 = ['无名一式'];
    expectError(validateContentPack(pack), '/combatText/moves/sword9', 'xref');
  });

  it('配方材料不存在 → 指向材料键的 xref', () => {
    const pack = makePack();
    pack.recipes[0].materials = { silk9: 3 };
    expectError(validateContentPack(pack), '/recipes/0/materials/silk9', 'xref');
  });

  it('配方技艺不存在 / 非 craft 类 → 指向 skill 的 xref', () => {
    const missing = makePack();
    missing.recipes[0].skill = 'cooking';
    expectError(validateContentPack(missing), '/recipes/0/skill', 'xref');

    const notCraft = makePack();
    notCraft.recipes[0].skill = 'herb';
    expectError(validateContentPack(notCraft), '/recipes/0/skill', 'xref');
  });

  it('活动产出物品不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.skills[0].activities[0].output.item = 'herb9';
    expectError(validateContentPack(pack), '/skills/0/activities/0/output/item', 'xref');
  });

  it('活动副产出物品不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.skills[0].activities[0].byproduct.item = 'silk9';
    expectError(validateContentPack(pack), '/skills/0/activities/0/byproduct/item', 'xref');
  });

  it('敌人掉落物品不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.enemies[0].drops[0].item = 'herb9';
    expectError(validateContentPack(pack), '/enemies/0/drops/0/item', 'xref');
  });

  it('坊市货架物品不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.shop[0].item = 'pill9';
    expectError(validateContentPack(pack), '/shop/0/item', 'xref');
  });
});

describe('validateContentPack · 去重与形态', () => {
  it('物品 id 重复 → duplicate', () => {
    const pack = makePack();
    pack.items.push({ ...pack.items[0] });
    expectError(validateContentPack(pack), '/items/5', 'duplicate');
  });

  it('equip 缺 slot / 缺 bonuses → shape', () => {
    const noSlot = makePack();
    delete noSlot.items[2].slot;
    expectError(validateContentPack(noSlot), '/items/2/slot', 'shape');

    const noBonuses = makePack();
    delete noBonuses.items[2].bonuses;
    expectError(validateContentPack(noBonuses), '/items/2/bonuses', 'shape');
  });

  it('pill 无 effect 也无 heal → shape', () => {
    const pack = makePack();
    delete pack.items[4].heal;
    expectError(validateContentPack(pack), '/items/4/effect', 'shape');
  });

  it('mat 携带装备/丹药字段 → schema oneOf 分支拦截（#16 起跨形态字段在 schema 关卡拒绝）', () => {
    const pack = makePack();
    pack.items[0].bonuses = { atk: 1 };
    expectError(validateContentPack(pack), '/items/0/bonuses', 'additionalProperties');
  });

  it('gather 技能无活动 / craft 技能带活动 → shape', () => {
    const idle = makePack();
    delete idle.skills[0].activities;
    expectError(validateContentPack(idle), '/skills/0', 'shape');

    const busyCraft = makePack();
    busyCraft.skills[1].activities = [{ ...busyCraft.skills[0].activities[0] }];
    expectError(validateContentPack(busyCraft), '/skills/1/activities', 'shape');
  });

  it('敌人灵石区间 min > max → shape', () => {
    const pack = makePack();
    pack.enemies[0].gold = { min: 10, max: 4 };
    expectError(validateContentPack(pack), '/enemies/0/gold', 'shape');
  });

  it('缺少内容节 → required', () => {
    const pack = makePack();
    delete pack.shop;
    expectError(validateContentPack(pack), '/shop', 'required');
  });
});

describe('validateContentPack · 引擎兜底约定', () => {
  it('缺 fist 兜底招式 → xref', () => {
    const pack = makePack();
    delete pack.combatText.moves.fist;
    expectError(validateContentPack(pack), '/combatText/moves', 'xref');
  });

  it('缺 fist 兜底动词池 → schema 层 required 先行拦截（#021 批 4：键域开放后仅 fist 恒需）', () => {
    const pack = makePack();
    delete pack.combatText.verbs.fist;
    expectError(validateContentPack(pack), '/combatText/verbs/fist', 'required');
  });

  it('非兜底动词池缺失 → 合法（键域开放，存在性按引用强制）', () => {
    const pack = makePack();
    delete pack.combatText.verbs.magic;
    const result = validateContentPack(pack);
    expect(result.ok).toBe(true);
  });

  it('动词池为空数组 → schema 层 minItems 拦截', () => {
    const pack = makePack();
    pack.combatText.verbs.magic = [];
    expectError(validateContentPack(pack), '/combatText/verbs/magic', 'minItems');
  });
});

describe('validateContentPack · 稀有度/词条池词表（#018，ADR-016 词表零默认）', () => {
  it('缺 rarities 节 → required（节恒在强制）', () => {
    const pack = makePack();
    delete pack.rarities;
    expectError(validateContentPack(pack), '/rarities', 'required');
  });

  it('缺 affixPool 节 → required（节恒在强制）', () => {
    const pack = makePack();
    delete pack.affixPool;
    expectError(validateContentPack(pack), '/affixPool', 'required');
  });

  it('rarities 空数组 → minItems（词表恒非空，缺档回退才有第一档可退）', () => {
    const pack = makePack();
    pack.rarities = [];
    expectError(validateContentPack(pack), '/rarities', 'minItems');
  });

  it('权重非正 → exclusiveMinimum（权重归一化掷点的前提）', () => {
    const pack = makePack();
    pack.rarities[0].weight = 0;
    expectError(validateContentPack(pack), '/rarities/0/weight', 'exclusiveMinimum');
  });

  it('稀有度 id 重复 → duplicate（GearInstance.rarity 存档键唯一）', () => {
    const pack = makePack();
    pack.rarities.push({ ...pack.rarities[0] });
    expectError(validateContentPack(pack), '/rarities/4', 'duplicate');
  });

  it('词条 stat 违反键形态 → pattern（#021 批 4：键域开放后 schema 只钉形态）', () => {
    const pack = makePack();
    pack.affixPool[0].stat = 'Luck';
    expectError(validateContentPack(pack), '/affixPool/0/stat', 'pattern');
  });

  it('词条池空数组 → minItems', () => {
    const pack = makePack();
    pack.affixPool = [];
    expectError(validateContentPack(pack), '/affixPool', 'minItems');
  });
});

describe('validateContentPack · 批 4 语义键域（#021）', () => {
  it('新增 stat 键（幸运）贯通：bonuses / affixPool.stat / multipliers 全部纯 JSON 放行', () => {
    const pack = makePack();
    pack.items[2].bonuses = { atk: 6, luck: 5 }; // equip 加成新键
    pack.affixPool.push({ name: '天幸', stat: 'luck', scale: 0.3 }); // 词条池新键
    pack.items[4].effect = { duration: 60000, multipliers: { hp: 1.5 } }; // 丹药倍率新键
    const result = validateContentPack(pack);
    expect(result.ok).toBe(true);
  });

  it('equip.verbStyle 未在 verbs 注册 → 字段级 xref（存在性校验拦截坏引用）', () => {
    const pack = makePack();
    pack.items[2].verbStyle = 'staff';
    expectError(validateContentPack(pack), '/items/2/verbStyle', 'xref');
  });

  it('equip.verbStyle 注册新风格（staff + verbs.staff 池）→ 放行（键域开放演示）', () => {
    const pack = makePack();
    pack.items[2].verbStyle = 'staff';
    pack.combatText.verbs.staff = [{ v: '点', limbs: ['眉心'] }];
    const result = validateContentPack(pack);
    expect(result.ok).toBe(true);
  });

  it('enemy.kind 未在 verbs 注册 → 字段级 xref', () => {
    const pack = makePack();
    pack.enemies[0].kind = 'tentacle';
    expectError(validateContentPack(pack), '/enemies/0/kind', 'xref');
  });

  it('enemy.kind 指向新注册风格 → 放行（改敌人受击风格 = 纯 JSON）', () => {
    const pack = makePack();
    pack.enemies[0].kind = 'staff';
    pack.combatText.verbs.staff = [{ v: '卷', limbs: ['周身'] }];
    const result = validateContentPack(pack);
    expect(result.ok).toBe(true);
  });

  it('enemy.level 超 config.progression.maxLevel → shape（层数上限单一来源，schema 魔法数 99 清退）', () => {
    const pack = makePack();
    pack.config = { slots: THREE_SLOTS(), progression: { maxLevel: 50 } };
    pack.enemies[0].level = 92;
    expectError(validateContentPack(pack), '/enemies/0/level', 'shape');
  });

  it('活动/配方 unlockLevel 超 config.progression.maxLevel → shape（同族魔法数 99 清退）', () => {
    const pack = makePack();
    pack.config = { slots: THREE_SLOTS(), progression: { maxLevel: 2 } };
    pack.skills[0].activities[0].unlockLevel = 5;
    expectError(validateContentPack(pack), '/skills/0/activities/0/unlockLevel', 'shape');
    expectError(validateContentPack(pack), '/recipes/0/unlockLevel', 'shape');
  });

  it('enemy.level 不超上限 / config 缺省时跳过对照', () => {
    const bounded = makePack();
    bounded.config = { slots: THREE_SLOTS(), progression: { maxLevel: 99 } };
    bounded.enemies[0].level = 99;
    expect(validateContentPack(bounded).ok).toBe(true);

    const unbounded = makePack();
    unbounded.enemies[0].level = 120; // 无 config → 无法取得上限，不对照
    expect(validateContentPack(unbounded).ok).toBe(true);
  });
});

describe('validateContentPack · 题材包破坏演示（验收）', () => {
  it('从修仙包删除 silk → 相关跨引用逐字段报错', () => {
    const pack = JSON.parse(JSON.stringify(xiuxianPackJson)) as Record<string, any>;
    pack.items = pack.items.filter((it: { id: string }) => it.id !== 'silk');
    const result = validateContentPack(pack);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    // 采药副产出、布道袍配方、坊市货架三处引用都应拿到字段级错误。
    for (const path of [
      '/skills/1/activities/0/byproduct/item',
      '/recipes/6/materials/silk',
      '/shop/4/item',
    ]) {
      expect(result.errors.find((e) => e.path === path), path).toBeDefined();
    }
  });
});
