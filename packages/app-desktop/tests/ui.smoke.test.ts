// @vitest-environment happy-dom
/**
 * UI 渲染烟测（issue #3 验收）：打开即玩 → 点开始 → 背包增长 →
 * 关闭重开进度保留。UI 只消费 events + snapshot，测的正是这条接缝
 * （事件→日志/浮提示接线与生产共用 buildUi 内的同一套路径）。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import {
  createGame,
  localStorageSaveAdapter,
  ManualClock,
  type GameAction,
} from '@wendao/engine';
import { buildUi } from '../src/ui';

describe('UI 烟测（issue #3 验收）', () => {
  it('打开即玩：点开始 → 进度条走 → 背包增长 → 重开进度保留', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    const adapter = localStorageSaveAdapter('wendao_ui_smoke_v2');

    // —— 首次进入 ——
    const game = createGame({ content, clock, seed: 7 });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    ui.render();

    // 技能页骨架：状态卡、活动卡片网格
    expect(root.querySelector('.status-card')).not.toBeNull();
    expect(root.querySelectorAll('.act-card').length).toBeGreaterThanOrEqual(3);

    // 切到「采药」（默认选中炼气）
    root.querySelector<HTMLButtonElement>('.chip[data-skill="herb"]')!.click();
    ui.render();
    expect(root.textContent).toContain('采青灵草');

    // 点「开始」：真实点击路径（事件委托 → dispatch → 事件回流重绘）
    const startBtn = root.querySelector<HTMLButtonElement>('.act-card .btn[data-act="start"]');
    expect(startBtn).not.toBeNull();
    startBtn!.click();
    ui.render();
    expect(root.querySelector('.act-card.running')).not.toBeNull();
    expect(root.querySelector('[data-act="stop"]')).not.toBeNull();

    // 挂机 60 游戏秒：进度推进，乾坤袋增长
    for (let i = 0; i < 20; i++) {
      clock.advance(3000);
      game.tick(3000);
    }
    ui.render();
    expect(game.snapshot().state.items['herb1']).toBe(20);

    // 切到乾坤袋：材料行出现且数量正确
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    ui.render();
    const herbRow = Array.from(root.querySelectorAll('.bag-row')).find((row) =>
      row.textContent?.includes('青灵草'),
    );
    expect(herbRow?.textContent).toContain('×20');

    // —— 关闭重开：存档落 localStorage，新实例恢复 ——
    adapter.save(game.snapshot());
    const game2 = createGame({
      content,
      clock,
      save: adapter.load() ?? undefined,
    });
    const root2 = document.createElement('div');
    document.body.appendChild(root2);
    const ui2 = buildUi(root2, content, () => game2.snapshot(), game2.events);
    ui2.bindActions((action: GameAction) => game2.dispatch(action));
    ui2.render();
    root2.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    ui2.render();
    const herbRow2 = Array.from(root2.querySelectorAll('.bag-row')).find((row) =>
      row.textContent?.includes('青灵草'),
    );
    expect(herbRow2?.textContent).toContain('×20');

    // 修为与等级同样保留（60 秒 → 3 层）
    root2.querySelector<HTMLButtonElement>('.tab[data-tab="skills"]')!.click();
    root2.querySelector<HTMLButtonElement>('.chip[data-skill="herb"]')!.click();
    ui2.render();
    expect(root2.textContent).toContain('3 层');
  });

  it('灵石不足购买：reject 事件以红字浮提示呈现', () => {
    const clock = new ManualClock();
    const content = loadXiuxianPack();
    const game = createGame({ content, clock, seed: 7 });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    ui.render();

    root.querySelector<HTMLButtonElement>('.tab[data-tab="shop"]')!.click();
    ui.render();
    const buyBtn = root.querySelector<HTMLButtonElement>('.bag-row .btn[data-act="buy"]');
    expect(buyBtn).not.toBeNull();
    buyBtn!.click();

    const toast = root.querySelector('.toast-red');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('灵石不足');
  });
});
