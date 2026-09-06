import { describe, expect, it } from 'vitest';
import { validateContentPack, type PackValidationResult } from '../src/index.js';
import { fantasyPackJson } from '../src/packs/fantasy.js';
import { xiuxianPackJson } from '../src/packs/xiuxian.js';

/**
 * #6 验收：rebirth 节协议面——
 * - 语义校验：清单键域闭集/两集互斥、天赋树 xref/查环/修饰符区约束、
 *   解锁表目标 xref/同目标重复、境界词表同层数重复；
 * - AC3 换包换树：修仙/魔幻两包各自声明整棵树（id/名/公式互异），同过校验。
 */

/** 深拷贝修仙包并覆写 rebirth 子树（真实包变易，负路径逐字段断言）。 */
function mutate(apply: (pack: Record<string, any>) => void): PackValidationResult {
  const pack = JSON.parse(JSON.stringify(xiuxianPackJson)) as Record<string, any>;
  apply(pack);
  return validateContentPack(pack);
}

function errorsOf(result: PackValidationResult): readonly string[] {
  return result.ok ? [] : result.errors.map((e) => `${e.path} [${e.keyword}]`);
}

describe('#6 · rebirth 节校验', () => {
  it('两包各自的整棵树与公式互异（换包可换整棵树）且均过校验', () => {
    for (const pack of [xiuxianPackJson, fantasyPackJson]) {
      const result = validateContentPack(pack);
      if (!result.ok) {
        console.error(errorsOf(result).join('\n'));
      }
      expect(result.ok).toBe(true);
    }
    const x = (xiuxianPackJson as { rebirth?: any }).rebirth;
    const f = (fantasyPackJson as { rebirth?: any }).rebirth;
    // 树 100% 来自 content：id 域、公式、境界词表逐面互异。
    expect(new Set(x.talents.map((t: any) => t.id))).not.toEqual(
      new Set(f.talents.map((t: any) => t.id)),
    );
    expect(x.formula).not.toEqual(f.formula);
    expect(x.realms.map((r: any) => r.name)).not.toEqual(f.realms.map((r: any) => r.name));
    // 面貌样张：修仙包八档境界（B2 收编，对照旧 js/data.js REALMS）。
    expect(x.realms.map((r: any) => r.name)).toEqual([
      '练气期', '筑基期', '金丹期', '元婴期', '化神期', '炼虚期', '合体期', '大乘期',
    ]);
  });

  it('重置集键域闭集：登记 keep 专属键 → xref；两集冲突 → shape', () => {
    const wrongKey = mutate((pack) => {
      pack.rebirth.reset = ['skills', 'gear'];
    });
    expect(errorsOf(wrongKey)).toContain('/rebirth/reset/1 [xref]');

    const conflict = mutate((pack) => {
      pack.rebirth.reset = ['skills', 'items', 'gold', 'buffs', 'lastEncounter', 'gear'];
    });
    const lines = errorsOf(conflict);
    expect(lines).toContain('/rebirth/reset/5 [xref]');
    expect(lines).toContain('/rebirth/keep/0 [shape]');
  });

  it('天赋树：requires 悬空引用 xref；前置链成环 shape（菱形依赖不误报）', () => {
    const dangling = mutate((pack) => {
      pack.rebirth.talents[0].requires = ['t_ghost'];
    });
    expect(errorsOf(dangling)).toContain('/rebirth/talents/0/requires/0 [xref]');

    const cycle = mutate((pack) => {
      // t_xueting（树根）反指 t_wudao（其下游）→ 成环。
      pack.rebirth.talents[0].requires = ['t_wudao'];
    });
    expect(errorsOf(cycle)).toContain('/rebirth/talents/0/requires [shape]');

    const diamond = mutate((pack) => {
      // 菱形：t_posha 与 t_tongming 同时前置 t_ruijin（合法共享前置，不得报环）。
      pack.rebirth.talents[9].requires = ['t_ruijin', 't_tongming'];
    });
    expect(errorsOf(diamond).filter((line) => line.includes('requires') && line.includes('shape'))).toEqual([]);
  });

  it('天赋效果修饰符区约束：乘法区 value ≤ 0 → shape', () => {
    const bad = mutate((pack) => {
      pack.rebirth.talents[0].effects = [{ stat: 'gatherXp', zone: 'mult', value: 0 }];
    });
    expect(errorsOf(bad)).toContain('/rebirth/talents/0/effects/0/value [shape]');
  });

  it('天赋 id 去重（state.talents 存档键，ADR-015）', () => {
    const dup = mutate((pack) => {
      pack.rebirth.talents[1].id = pack.rebirth.talents[0].id;
    });
    expect(errorsOf(dup)).toContain('/rebirth/talents/1 [duplicate]');
  });

  it('解锁表：目标敌人 xref；同目标重复登记 duplicate', () => {
    const dangling = mutate((pack) => {
      pack.rebirth.unlocks[0].enemies = ['e_ghost'];
    });
    expect(errorsOf(dangling)).toContain('/rebirth/unlocks/0/enemies/0 [xref]');

    const dup = mutate((pack) => {
      pack.rebirth.unlocks = [
        { requires: { daoYun: 5 }, enemies: ['e8'] },
        { requires: { daoYun: 10 }, enemies: ['e8'] },
      ];
    });
    expect(errorsOf(dup)).toContain('/rebirth/unlocks/1/enemies/0 [duplicate]');
  });

  it('境界词表：同层数重复 → duplicate（层数→称号映射歧义）', () => {
    const dup = mutate((pack) => {
      pack.rebirth.realms[1].level = pack.rebirth.realms[0].level;
    });
    expect(errorsOf(dup)).toContain('/rebirth/realms/1 [duplicate]');
  });
});
