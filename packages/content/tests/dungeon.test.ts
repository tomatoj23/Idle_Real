import { describe, expect, it } from 'vitest';
import { validateContentPack } from '../src/index.js';
import type { ContentError } from '../src/index.js';
import { xiuxianPackJson } from '../src/packs/xiuxian.js';
import { fantasyPackJson, loadFantasyPack } from '../src/packs/fantasy.js';
import { loadXiuxianPack } from '../src/packs/xiuxian.js';
import { shellFixture } from './fixtures.js';

/**
 * #7 验收：dungeons 节（秘境分层爬塔）——
 * - schema 关卡：形状/权重/区间/枚举外字段；
 * - 语义关卡：id 去重、钥匙/敌人/奖励 xref、生命周期覆盖（缺口/重叠）。
 * 可选节：省略合法（引擎零降级路径）。修仙/魔幻两包为换包生效样张。
 */

const BASE_PACK: unknown = {
  skills: [
    { id: 'fight', name: '斗法', icon: '斗', kind: 'combat' },
    { id: 'smith', name: '炼器', icon: '器', kind: 'craft' },
  ],
  items: [
    { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
    { id: 'key1', name: '钥符', icon: '钥', type: 'mat', sell: 5 },
  ],
  recipes: [
    {
      name: '锻钥符',
      skill: 'smith',
      unlockLevel: 1,
      output: { item: 'key1', count: 1 },
      materials: { herb1: 2 },
      successRate: 1,
      interval: 4000,
      exp: 10,
    },
  ],
  enemies: [
    {
      id: 'e1', name: '青鬃狼', icon: '狼', level: 1, kind: 'claw',
      hp: 60, atk: 9, def: 2, attackInterval: 2800, exp: 16,
      gold: { min: 4, max: 10 }, drops: [],
    },
    {
      id: 'e2', name: '赤尾妖蝎', icon: '蝎', level: 8, kind: 'claw',
      hp: 140, atk: 17, def: 6, attackInterval: 2600, exp: 40,
      gold: { min: 12, max: 24 }, drops: [],
    },
  ],
  gearDrops: [],
  elements: [],
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
      basic: [{ v: '击', limbs: ['面门'] }],
      claw: [{ v: '抓', limbs: ['肩头'] }],
    },
    moves: { basic: ['搏兔一击'], e1: ['饿虎扑食'], e2: ['毒尾横扫'] },
    openings: ['你足尖一点'],
    critIntro: ['你气机鼓荡'],
    cons: {
      hit: {
        light: ['{defender}受创{d}点。'],
        mid: ['{defender}受创{d}点。'],
        heavy: ['{defender}受创{d}点。'],
        deadly: ['{defender}受创{d}点。'],
      },
      hurt: {
        light: ['你受创{d}点。'],
        mid: ['你受创{d}点。'],
        heavy: ['你受创{d}点。'],
        deadly: ['你受创{d}点。'],
      },
    },
    fatal: { hit: '{defender}受创{d}点！', hurt: '你受创{d}点。' },
    templates: {
      playerLight: ['你一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
      playerHeavy: ['{opening}——一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
      playerCrit: ['{critIntro}——「{move}」，{weapon}{verb}向{defender}的{limb}！'],
      enemyLight: ['{enemy}一式「{move}」，{verb}向你的{limb}。'],
      enemyHeavy: ['{enemy}凶性大发——「{move}」，{verb}向你的{limb}！'],
    },
    notes: {
      retreat: ['你收势撤战'],
      retreatToGather: ['你收势离战'],
      retreatWounded: ['你暂且退避'],
      retreatVictory: ['你见好就收'],
      reengage: ['你再度向【{enemy}】出手'],
      start: ['你与【{enemy}】战至一处'],
      autoConsume: ['你服下【{item}】'],
    },
    summary: {
      tiers: {
        light: ['轻痕积胜'], mid: ['稳中求进'], heavy: ['重创连绵'], deadly: ['锋芒毕露'],
      },
      base: ['{rounds} 合击倒 · {flavor}'],
      crit: ['{rounds} 合击倒 · {flavor} · {crits} 会心'],
    },
    compare: {
      revenge: ['今 {rounds} 合雪耻'],
      faster: ['今 {rounds} 合胜'],
      slower: ['今 {rounds} 合方克'],
      even: ['与前番 {rounds} 合如一'],
    },
  },
  texts: {
    basicName: '拳脚',
    reject: { '*': { 'bad-payload': '指令无效' } },
    shell: shellFixture(),
  },
  shop: [{ item: 'herb1', price: 10 }],
  dungeons: [
    {
      id: 'crypt',
      name: '妖窟秘境',
      icon: '窟',
      floors: 4,
      entry: { daoYun: 2, key: 'key1' },
      layers: [
        {
          floor: { min: 1, max: 2 },
          enemies: [{ enemy: 'e1', weight: 3 }, { enemy: 'e2', weight: 1 }],
          mult: { hp: 1.5, gold: 1.2 },
          rewards: { gold: 10, daoYun: 1, items: [{ item: 'herb1', count: 2 }] },
          recommendedPower: { min: 10, max: 30 },
        },
        {
          floor: { min: 3, max: 4 },
          enemies: [{ enemy: 'e2', weight: 1 }],
          rewards: { gold: 20 },
        },
      ],
    },
  ],
};

function makePack(): Record<string, any> {
  return JSON.parse(JSON.stringify(BASE_PACK));
}

function expectError(result: ReturnType<typeof validateContentPack>, path: string, keyword: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const hit: ContentError | undefined = result.errors.find((e) => e.path === path && e.keyword === keyword);
  expect(hit, `期望 ${path} [${keyword}]，实际：${JSON.stringify(result.errors)}`).toBeDefined();
}

describe('validateContentPack · dungeons 秘境节（#7）', () => {
  it('基准夹具通过（可选节 + 全字段）', () => {
    const result = validateContentPack(BASE_PACK);
    if (!result.ok) {
      console.error(result.errors.map((e) => `${e.path} [${e.keyword}] ${e.message}`).join('\n'));
    }
    expect(result.ok).toBe(true);
  });

  it('缺 dungeons 节 → 合法（可选节，引擎零降级路径）', () => {
    const pack = makePack();
    delete pack.dungeons;
    expect(validateContentPack(pack).ok).toBe(true);
  });

  it('秘境 id 重复 → duplicate（dungeonBest 存档键唯一）', () => {
    const pack = makePack();
    pack.dungeons.push(JSON.parse(JSON.stringify(pack.dungeons[0])));
    expectError(validateContentPack(pack), '/dungeons/1', 'duplicate');
  });

  it('钥匙物品不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.dungeons[0].entry.key = 'ghost_key';
    expectError(validateContentPack(pack), '/dungeons/0/entry/key', 'xref');
  });

  it('层敌人不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.dungeons[0].layers[0].enemies[0].enemy = 'e99';
    expectError(validateContentPack(pack), '/dungeons/0/layers/0/enemies/0/enemy', 'xref');
  });

  it('层奖励物品不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.dungeons[0].layers[0].rewards.items[0].item = 'herb9';
    expectError(validateContentPack(pack), '/dungeons/0/layers/0/rewards/items/0/item', 'xref');
  });

  it('层表覆盖缺口（缺层 4）→ shape（生命周期覆盖）', () => {
    const pack = makePack();
    pack.dungeons[0].layers[1].floor = { min: 3, max: 3 };
    expectError(validateContentPack(pack), '/dungeons/0/layers', 'shape');
  });

  it('层表整体缺失下半 → shape（缺口报告层段）', () => {
    const pack = makePack();
    pack.dungeons[0].layers = [pack.dungeons[0].layers[0]];
    expectError(validateContentPack(pack), '/dungeons/0/layers', 'shape');
  });

  it('层段重叠（同层两行）→ duplicate（同层歧义）', () => {
    const pack = makePack();
    pack.dungeons[0].layers[1].floor = { min: 2, max: 4 };
    expectError(validateContentPack(pack), '/dungeons/0/layers/1/floor', 'duplicate');
  });

  it('层段超出总层数 → shape', () => {
    const pack = makePack();
    pack.dungeons[0].floors = 3;
    expectError(validateContentPack(pack), '/dungeons/0/layers/1/floor', 'shape');
  });

  it('推荐战力区间方向颠倒 → shape（软提示字段也钉方向性）', () => {
    const pack = makePack();
    pack.dungeons[0].layers[0].recommendedPower = { min: 30, max: 10 };
    expectError(validateContentPack(pack), '/dungeons/0/layers/0/recommendedPower', 'shape');
  });

  it('权重非正 → schema exclusiveMinimum（归一化掷点的前提）', () => {
    const pack = makePack();
    pack.dungeons[0].layers[0].enemies[0].weight = 0;
    expectError(validateContentPack(pack), '/dungeons/0/layers/0/enemies/0/weight', 'exclusiveMinimum');
  });

  it('层数段方向颠倒 → schema 语义面未拦但覆盖检查按排序解释（min>max 行为缺口）', () => {
    // min > max 由 JSON Schema 无方向约束——覆盖检查按区间算术，
    // 倒序行走不到任何层（max < min → 空段），最终以覆盖缺口大声失败。
    const pack = makePack();
    pack.dungeons[0].layers[0].floor = { min: 2, max: 1 };
    const result = validateContentPack(pack);
    expect(result.ok).toBe(false);
  });
});

describe('题材包秘境样张（#7 换包生效）', () => {
  it('修仙包：两座秘境（道韵门 / 钥匙门），层表覆盖其生命周期', () => {
    const result = validateContentPack(xiuxianPackJson);
    if (!result.ok) {
      console.error(result.errors.map((e) => `${e.path} [${e.keyword}] ${e.message}`).join('\n'));
    }
    expect(result.ok).toBe(true);
    const pack = loadXiuxianPack();
    expect(pack.dungeons).toHaveLength(2);
    const yaoku = pack.dungeons![0]!;
    expect(yaoku.entry).toEqual({ daoYun: 10 });
    const guimiao = pack.dungeons![1]!;
    expect(guimiao.entry).toEqual({ key: 'guimiao_yaofu' });
    // 深层奖励含道韵（与转生联动）+ 钥匙符在顶 层奖励里（钥匙门闭环）。
    expect(yaoku.layers.at(-1)?.rewards?.daoYun).toBeGreaterThan(0);
    expect(yaoku.layers.at(-1)?.rewards?.items?.map((s) => s.item)).toContain('guimiao_yaofu');
    // 层表含 recommendedPower（软提示字段预留）。
    expect(yaoku.layers[0]!.recommendedPower).toEqual({ min: 20, max: 45 });
  });

  it('魔幻包：英语秘境样张（层表/奖励结构同协议，第二题材零引擎改动）', () => {
    const pack = loadFantasyPack();
    expect(validateContentPack(fantasyPackJson).ok).toBe(true);
    expect(pack.dungeons).toHaveLength(1);
    const delve = pack.dungeons![0]!;
    expect(delve.id).toBe('sunken_crypt');
    expect(delve.entry).toEqual({ daoYun: 3 });
    expect(delve.layers).toHaveLength(3);
    expect(delve.layers.at(-1)?.rewards?.daoYun).toBeGreaterThan(0);
  });
});
