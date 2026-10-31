// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { mountGame } from './helpers/mount';
import type { SaveData } from '@wendao/engine';

/**
 * #58 项 8 · data-* 属性插值纪律回归钉（用户裁决：统一过 esc，防御纵深）：
 * 动态模板的字符串值进 data-* 属性必须经 esc——不依赖 schema pattern 担保
 * id 域。本用例把一个含引号的敌意 id 直送增益条（data-buff 插值点，修仙包
 * 正常 id 永远触不到的路径），钉「属性值原样往返、不破格出逃」：esc 被摘
 * （变异 `data-buff="${esc(id)}"` → `data-buff="${id}"`）则 dataset.buff 截断
 * 在首个引号 + 冒出野属性，双断言皆红。
 */

/** 含引号与空格的敌意 id：未转义即可破出属性边界（伪造 onx 属性）。 */
const HOSTILE = 'x" onx="y';

describe('#58 项 8 · data-* 属性插值过 esc', () => {
  it('敌意 buff id：属性值往返无损、不伪造额外属性', () => {
    const pack = loadXiuxianPack();
    const content = {
      ...pack,
      items: [
        ...pack.items,
        {
          id: HOSTILE,
          name: '敌意丹',
          icon: '敌',
          type: 'consumable',
          sell: 1,
          effect: { duration: 300000, multipliers: { atk: 1.1 } },
        },
      ],
    } as typeof pack;
    const save = {
      version: 2 as const,
      time: 0,
      state: { items: { [HOSTILE]: 1 } },
    } as unknown as SaveData;
    const { root, ui, game } = mountGame({ content, save });

    game.dispatch({ type: 'consumable:eat', payload: { item: HOSTILE } });
    ui.render();

    const chip = root.querySelector<HTMLElement>('.buff-chip[data-buff]');
    expect(chip).not.toBeNull();
    // 往返无损：dataset 读回完整敌意 id（截断即 esc 被摘）。
    expect(chip!.dataset.buff).toBe(HOSTILE);
    // 不破格出逃：未转义时 ` onx="y` 会成为独立属性。
    expect(chip!.hasAttribute('onx')).toBe(false);
  });
});
