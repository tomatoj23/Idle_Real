// @vitest-environment happy-dom
/**
 * 页面注册表壳核行为（#46 D7/AC1/AC4）：
 * - 未知 tab 注入 → console.warn + 回落修炼页（裸 cast 与坊市静默兜底退役）；
 * - 九页全量走页：注册表逐页查找分发，页页有内容。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction } from '@wendao/engine';
import { buildUi } from '../src/ui';

function mount(): { root: HTMLElement; ui: ReturnType<typeof buildUi> } {
  const content = loadXiuxianPack();
  const game = createGame({ content, clock: new ManualClock(), seed: 7 });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return { root, ui };
}

describe('#46 · 未知 tab 防御（D7）', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  afterEach(() => {
    warn.mockClear();
  });

  it('导航按钮被注入未知 tab 串 → warn + 回落修炼页（不从 bag 静默兜底）', () => {
    const { root } = mount();
    // 先切到乾坤袋：激活态跟随（正常分发路径）。
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    expect(root.querySelector('.tab.active')?.getAttribute('data-tab')).toBe('bag');
    expect(warn).not.toHaveBeenCalled();

    // 注入未知 tab 值后再点：warn + 回落修炼页（状态卡在场）。
    const bagBtn = root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!;
    bagBtn.dataset.tab = 'wuxing';
    bagBtn.click();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('wuxing');
    expect(root.querySelector('.status-card')).not.toBeNull();
    expect(root.querySelector('.chip')).not.toBeNull();
  });

  it('合法九键照常分发，不再有裸 cast 需求', () => {
    const { root } = mount();
    for (const tab of ['craft', 'combat', 'dungeon', 'bag', 'shop', 'rebirth', 'talents', 'achievements']) {
      root.querySelector<HTMLButtonElement>(`.tab[data-tab="${tab}"]`)!.click();
      expect(root.querySelector('#page-root .page')).not.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    }
  });
});
