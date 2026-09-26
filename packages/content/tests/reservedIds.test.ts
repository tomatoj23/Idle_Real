import { describe, expect, it } from 'vitest';
import { validateContentPack } from '../src/index.js';
import { fantasyPackJson } from '../src/packs/fantasy.js';
import { xiuxianPackJson } from '../src/packs/xiuxian.js';
import { expectError, minimalPack } from './fixtures.js';

/**
 * 内容 id 撞名导入期拒绝（#75 项 12 根治 #69 恢复期两难）：Object.prototype
 * 方法名（constructor/prototype/hasOwnProperty）恰好过 id 形态 pattern，一旦
 * 成 id 就遮蔽状态表的属性读（state.skills['constructor'] 撞内置方法）。此前
 * 只能二选一——静默丢数据或容忍方法遮蔽；现在导入期在 checkIds 单点大声拒。
 *
 * - 正对照：撞名 id 逐个断言 reserved 报错。构造法 = 克隆官方包注入撞名条目
 *   （语义检查以 schema 干净为前提，须用全须全尾的包做底）；元素 id 域为
 *   camelCase pattern，三名全可达；物品等严格小写域 hasOwnProperty 先被
 *   pattern 拦（同为导入即拒，不在此列）。
 * - 反对照：官方双题材包原样加载零影响（判据不误伤）。
 */

function cloneXiuxian(): Record<string, any> {
  return structuredClone(xiuxianPackJson) as Record<string, any>;
}

describe('内容 id 撞名导入期拒绝（#75 项 12）', () => {
  for (const bad of ['constructor', 'prototype', 'hasOwnProperty']) {
    it(`id "${bad}" 导入即拒（camelCase id 域三名全可达）`, () => {
      const pack = cloneXiuxian();
      pack.elements = [{ id: bad, name: '撞名系' }];
      expectError(validateContentPack(pack), '/elements/0', 'reserved');
    });
  }

  it('正对照：含 constructor 物品 id 的包断言报错（票面验收原案）', () => {
    const pack = cloneXiuxian();
    const at = pack.items.length as number;
    pack.items.push({ id: 'constructor', name: '撞名物', icon: '撞', type: 'mat', sell: 1 });
    expectError(validateContentPack(pack), `/items/${at}`, 'reserved');
  });

  it('反对照：官方双题材包与既有最小夹具原样加载零影响', () => {
    for (const [name, packJson] of [
      ['xiuxian', xiuxianPackJson],
      ['fantasy', fantasyPackJson],
      ['minimalPack 夹具', minimalPack()],
    ] as const) {
      const result = validateContentPack(packJson);
      expect(
        result.ok,
        `${name} 不应报错：${JSON.stringify(result.ok ? [] : result.errors)}`,
      ).toBe(true);
    }
  });
});
