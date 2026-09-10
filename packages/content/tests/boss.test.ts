import { describe, expect, it } from 'vitest';
import { validateContentPack } from '../src/index.js';
import type { ContentError } from '../src/index.js';
import { fantasyPackJson, loadFantasyPack } from '../src/packs/fantasy.js';
import { loadXiuxianPack, xiuxianPackJson } from '../src/packs/xiuxian.js';
import { minimalPack } from './fixtures.js';

/**
 * #8 验收：bosses 节（Boss 阶段脚本）——
 * - schema 关卡：形状/阈值区间/mods 键域/叙事池；
 * - 语义关卡：enemy xref + 每敌人一条、阈值严格递减（递进顺序）、
 *   变招 moveKey xref + 招式注册表放行、专属掉落 items xref。
 * 可选节：省略合法（普通敌人零降级路径）。修仙（饕餮三阶段）/魔幻
 * （魔像 Overload）两包为换包换行为样张。
 */

/** 基准包 = 共享最小合法包（fixtures.minimalPack）+ 一条两阶段 Boss。 */
function basePack(): Record<string, unknown> {
  const pack = minimalPack() as Record<string, unknown> & {
    combatText: { moves: Record<string, string[]> };
  };
  pack.combatText.moves.e1_rage = ['狂暴撕咬'];
  (pack as Record<string, unknown>).bosses = [
    {
      enemy: 'e1',
      drops: [{ item: 'herb1', chance: 1 }],
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
          narration: ['【{enemy}】彻底狂暴！'],
        },
      ],
    },
  ];
  return pack;
}

function makePack(): Record<string, any> {
  return JSON.parse(JSON.stringify(basePack()));
}

function expectError(result: ReturnType<typeof validateContentPack>, path: string, keyword: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const hit: ContentError | undefined = result.errors.find((e) => e.path === path && e.keyword === keyword);
  expect(hit, `期望 ${path} [${keyword}]，实际：${JSON.stringify(result.errors)}`).toBeDefined();
}

describe('validateContentPack · bosses Boss 节（#8）', () => {
  it('基准夹具通过（可选节 + 全字段）', () => {
    const result = validateContentPack(basePack());
    if (!result.ok) {
      console.error(result.errors.map((e) => `${e.path} [${e.keyword}] ${e.message}`).join('\n'));
    }
    expect(result.ok).toBe(true);
  });

  it('缺 bosses 节 → 合法（可选节，普通敌人零降级路径；变招键随之悬空须同删）', () => {
    const pack = makePack();
    delete pack.bosses;
    delete pack.combatText.moves.e1_rage;
    expect(validateContentPack(pack).ok).toBe(true);
  });

  it('Boss 敌人不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.bosses[0].enemy = 'e99';
    expectError(validateContentPack(pack), '/bosses/0/enemy', 'xref');
  });

  it('同一敌人重复登记 Boss → duplicate（每敌人至多一条）', () => {
    const pack = makePack();
    pack.bosses.push(JSON.parse(JSON.stringify(pack.bosses[0])));
    expectError(validateContentPack(pack), '/bosses/1/enemy', 'duplicate');
  });

  it('阶段阈值非严格递减 → shape（递进顺序）', () => {
    const pack = makePack();
    pack.bosses[0].phases[1].threshold = 0.7;
    expectError(validateContentPack(pack), '/bosses/0/phases/1/threshold', 'shape');

    const equal = makePack();
    equal.bosses[0].phases[1].threshold = 0.6;
    expectError(validateContentPack(equal), '/bosses/0/phases/1/threshold', 'shape');
  });

  it('变招键未在 moves 注册 → 字段级 xref', () => {
    const pack = makePack();
    pack.bosses[0].phases[1].moveKey = 'e1_ghost';
    expectError(validateContentPack(pack), '/bosses/0/phases/1/moveKey', 'xref');
  });

  it('变招键扩展招式注册表：moves 新键 + Boss 引用 → 放行（#8 注册表放行面）', () => {
    const pack = makePack();
    expect(validateContentPack(pack).ok).toBe(true); // e1_rage 由变招引用放行
  });

  it('悬空招式键仍被拒：moves 新键无 Boss 引用 → xref（注册表不放宽）', () => {
    const pack = makePack();
    delete pack.bosses;
    pack.combatText.moves.e1_rage = ['狂暴撕咬'];
    expectError(validateContentPack(pack), '/combatText/moves/e1_rage', 'xref');
  });

  it('专属掉落物品不存在 → 字段级 xref', () => {
    const pack = makePack();
    pack.bosses[0].drops[0].item = 'herb9';
    expectError(validateContentPack(pack), '/bosses/0/drops/0/item', 'xref');
  });

  it('mods 携带未钉键（hp）→ schema additionalProperties（阶段不投影 hp）', () => {
    const pack = makePack();
    pack.bosses[0].phases[0].mods.hp = 2;
    expectError(validateContentPack(pack), '/bosses/0/phases/0/mods/hp', 'additionalProperties');
  });

  it('阈值越界（0 / 1）→ schema exclusiveMinimum/Maximum', () => {
    const pack = makePack();
    pack.bosses[0].phases[0].threshold = 0;
    expectError(validateContentPack(pack), '/bosses/0/phases/0/threshold', 'exclusiveMinimum');

    const pack2 = makePack();
    pack2.bosses[0].phases[0].threshold = 1;
    expectError(validateContentPack(pack2), '/bosses/0/phases/0/threshold', 'exclusiveMaximum');
  });
});

/**
 * #30 验收：阶段召唤脚本（summons）——
 * - schema 关卡：count/enemies 必填、边界、池行形态、mult 键域；
 * - 语义关卡：召唤池行 enemy xref enemies + 行内去重（投影按敌 id 定位）。
 * 可选字段：省略 = 该阶段零召唤（零降级路径）。
 */
describe('validateContentPack · bosses 阶段召唤脚本（#30）', () => {
  /** 基准包第二阶段（狂暴）挂召唤脚本：2 只 e2 缩影 + 叙事池。 */
  function baseWithSummons(): Record<string, any> {
    const pack = makePack();
    pack.bosses[0].phases[1].summons = {
      count: 2,
      enemies: [{ enemy: 'e2', weight: 1, mult: { hp: 0.5, atk: 0.6, def: 1 } }],
      narration: ['【{enemy}】召来护法！'],
    };
    return pack;
  }

  it('合法召唤脚本通过（count/池/权重/mult/叙事全字段）', () => {
    expect(validateContentPack(baseWithSummons()).ok).toBe(true);
  });

  it('缺 count / 缺 enemies → schema required', () => {
    const pack = baseWithSummons();
    delete pack.bosses[0].phases[1].summons.count;
    expectError(validateContentPack(pack), '/bosses/0/phases/1/summons/count', 'required');

    const pack2 = baseWithSummons();
    delete pack2.bosses[0].phases[1].summons.enemies;
    expectError(validateContentPack(pack2), '/bosses/0/phases/1/summons/enemies', 'required');
  });

  it('count 越界（0 / 25）→ schema minimum/maximum', () => {
    const pack = baseWithSummons();
    pack.bosses[0].phases[1].summons.count = 0;
    expectError(validateContentPack(pack), '/bosses/0/phases/1/summons/count', 'minimum');

    const pack2 = baseWithSummons();
    pack2.bosses[0].phases[1].summons.count = 25;
    expectError(validateContentPack(pack2), '/bosses/0/phases/1/summons/count', 'maximum');
  });

  it('召唤物敌人不存在 → 字段级 xref', () => {
    const pack = baseWithSummons();
    pack.bosses[0].phases[1].summons.enemies[0].enemy = 'e99';
    expectError(validateContentPack(pack), '/bosses/0/phases/1/summons/enemies/0/enemy', 'xref');
  });

  it('召唤池行内 enemy 重复 → duplicate（投影按敌 id 定位，重复即歧义）', () => {
    const pack = baseWithSummons();
    pack.bosses[0].phases[1].summons.enemies.push({ enemy: 'e2', weight: 3 });
    expectError(validateContentPack(pack), '/bosses/0/phases/1/summons/enemies/1/enemy', 'duplicate');
  });

  it('mult 携带未钉键（gold）→ schema additionalProperties（召唤物无收益投影）', () => {
    const pack = baseWithSummons();
    pack.bosses[0].phases[1].summons.enemies[0].mult.gold = 2;
    expectError(
      validateContentPack(pack),
      '/bosses/0/phases/1/summons/enemies/0/mult/gold',
      'additionalProperties',
    );
  });

  it('weight ≤ 0 → schema exclusiveMinimum（无效权重不在语义层静默剔除作者意图）', () => {
    const pack = baseWithSummons();
    pack.bosses[0].phases[1].summons.enemies[0].weight = 0;
    expectError(validateContentPack(pack), '/bosses/0/phases/1/summons/enemies/0/weight', 'exclusiveMinimum');
  });
});

describe('题材包 Boss 样张（#8 换包换行为）', () => {
  it('修仙包：饕餮三阶段（阈值严格递减 + 变招键注册 + 专属掉落）', () => {
    const result = validateContentPack(xiuxianPackJson);
    if (!result.ok) {
      console.error(result.errors.map((e) => `${e.path} [${e.keyword}] ${e.message}`).join('\n'));
    }
    expect(result.ok).toBe(true);
    const pack = loadXiuxianPack();
    expect(pack.bosses).toHaveLength(1);
    const boss = pack.bosses![0]!;
    expect(boss.enemy).toBe('e8');
    expect(boss.phases.map((p) => p.threshold)).toEqual([0.6, 0.35, 0.15]); // 三阶段递进
    expect(boss.phases[1]!.moveKey).toBe('e8_devour');
    expect(pack.combatText.moves.e8_devour?.length).toBeGreaterThan(0);
    expect(boss.drops?.length).toBeGreaterThan(0);
    // #30 召唤脚本：真身阶段召唤 2 只 e2 缩影（换包换召唤行为的官方包样张）。
    const finalPhase = boss.phases.at(-1)!;
    expect(finalPhase.summons?.count).toBe(2);
    expect(finalPhase.summons?.enemies.map((entry) => entry.enemy)).toEqual(['e2']);
    expect(finalPhase.summons?.narration?.length).toBeGreaterThan(0);
    // 秘境每 10 层插 Boss（#7/#8 联动内容面）：妖窟顶 层 = 饕餮。
    const yaoku = pack.dungeons![0]!;
    expect(yaoku.layers.at(-1)?.enemies.map((e) => e.enemy)).toEqual(['e8']);
  });

  it('魔幻包：魔像 Overload 单阶段（英语叙事样张，换包换行为）', () => {
    expect(validateContentPack(fantasyPackJson).ok).toBe(true);
    const pack = loadFantasyPack();
    expect(pack.bosses).toHaveLength(1);
    const boss = pack.bosses![0]!;
    expect(boss.enemy).toBe('arcane_golem');
    expect(boss.phases[0]!.name).toBe('Overload');
    expect(boss.phases[0]!.mods).toEqual({ atk: 1.4, attackInterval: 0.8 });
  });
});
