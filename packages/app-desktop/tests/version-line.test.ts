// @vitest-environment happy-dom
/**
 * #12 版本策略验收：页脚版本行 = content 包版本 + 引擎版本的纯数据渲染——
 * - 改 content 包 version → 页脚跟随（「content 包版本变更 → 游戏内可见」）；
 * - 版本行措辞来自 texts.shell.footer.versionLine 模板（壳零版本文案硬编码）；
 * - 缺键回显键名（#26 裁决 ④ 防御路径与生产同码）。
 */
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@wendao/content';
import { ENGINE_VERSION, type SaveData } from '@wendao/engine';
import { makePack as basePack, makeShellTexts } from './helpers/pack';
import { makeSave as baseSave } from './helpers/save';
import { mountGame } from './helpers/mount';

/** 最小包：单战斗技能 + 一把剑 + 指定包版本；shell 只配被测键。 */
function makePack(version: string, footer?: { versionLine: string }): ContentPack {
  return basePack({
    version,
    skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
    items: [
      { id: 'sword', name: '试炼剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 10, bonuses: { atk: 5 } },
    ],
    rarities: [{ id: 'plain', name: '朴素', weight: 1, mult: 1, affix: 0, sell: 1 }],
    texts: {
      shell: makeShellTexts({
        tabs: { skills: '修', combat: '斗', bag: '袋', shop: '市' },
        common: { needLevel: '需 {level} 层', compareWrap: '（{compare}）', itemListSep: '、' },
        ...(footer ? { footer } : {}),
      }),
    },
  });
}

function makeSave(): SaveData {
  return baseSave({
    gold: 0,
    hp: 100,
    items: {},
    skills: { fight: { xp: 0 } },
    activity: null,
    gear: [],
    equips: {},
    buffs: {},
    combat: null,
    autoFight: false,
    autoEat: false,
    lastEncounter: {},
  });
}

function mount(content: ContentPack): HTMLElement {
  return mountGame({ content, save: makeSave() }).root;
}

describe('#12 · 页脚版本行', () => {
  it('渲染 content 包版本 + 引擎版本；改包版本 → 页脚跟随', () => {
    const before = mount(makePack('9.9.9', { versionLine: '{name} v{content} · 引擎 v{engine}' }));
    const line = before.querySelector('footer.version-line');
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain('试炼 v9.9.9');
    expect(line!.textContent).toContain(`引擎 v${ENGINE_VERSION}`);

    // 验收「content 包版本变更 → 游戏内可见」：版本是读出来的，不是壳内常量。
    const after = mount(makePack('9.9.10', { versionLine: '{name} v{content} · 引擎 v{engine}' }));
    const lineAfter = after.querySelector('footer.version-line')!;
    expect(lineAfter.textContent).toContain('9.9.10');
    expect(lineAfter.textContent).not.toContain('9.9.9');
  });

  it('缺 footer 文案键 → 键名回显（防御路径可见，非空白页脚）', () => {
    const root = mount(makePack('1.0.0'));
    expect(root.querySelector('footer.version-line')?.textContent).toBe('footer.versionLine');
  });
});
