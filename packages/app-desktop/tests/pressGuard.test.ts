// @vitest-environment happy-dom
/**
 * 按压窗口守卫（#99）：心跳整页换血让路给进行中的按压。
 *
 * #92 审计 N1 实证：mousedown → 整页 innerHTML 换血 → mouseup 落在新 DOM 上
 * → 浏览器不派发 click（mousedown/mouseup 目标无公共祖先）——约 2s 一次换血
 * 时估 ~5% 真实点击被吞。守卫挂换血本体（render 签名变化→重建处）在按压窗口
 * 内推迟：lastSig 不动（navigate/env.render 的 lastSig='' 强制重建等价面保持），
 * 释放后 click 派发完再补换血；pointerup 不达（按下中失窗）超时放行。
 *
 * 变异对照（scripts/mutation-sets/press-guard-99.mjs 四条：守卫摘除/推迟期
 * lastSig 误写/释放补换血摘除/饥饿兜底摘除）——改完必须验红再还原，
 * 别信「测试在场」。
 *
 * happy-dom 不自 mousedown+mouseup 合成 click，且真实浏览器 click 在 mouseup
 * 后同批派发、先于计时器：夹具在 pointerup 后同步补发 click 代表该合成，
 * 释放补换血走宏任务让 click 先落地；端到端真鼠标序由 Electron 真机驱动
 * 验收（票面 AC，vitest 不替代）。
 */
import { describe, expect, it, vi } from 'vitest';
import { PRESS_DEFER_MAX_MS } from '../src/ui';
import { mountGame } from './helpers/mount';

/** pointer 事件对（happy-dom 无原生合成，监听面只认类型串）。 */
const pointer = (type: string, el: Element): void => {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true }));
};

/** 释放后等补换血宏任务（守卫的补换血计时器先入队，先于本等待执行）。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('按压窗口守卫（#99）', () => {
  it('按压跨越心跳换血：按下期间不重建，释放后 click 生效、补换血落地', async () => {
    const actions: string[] = [];
    const { root, ui, game, clock } = mountGame({
      onAction: (action) => actions.push(action.type),
    });
    // 先正常开工（点按路径既有套件全覆盖），停按钮在场成为按压目标。
    root.querySelector<HTMLElement>('.act-card .btn[data-act="start"]')!.click();
    ui.render();
    const stopBtn = root.querySelector<HTMLElement>('[data-act="stop"]');
    expect(stopBtn).not.toBeNull();

    // 按下 → 心跳字段推进（xp/物品）→ 换血条件成立：让路，原节点存活。
    pointer('pointerdown', stopBtn!);
    clock.advance(3000);
    game.tick(3000);
    ui.render();
    expect(stopBtn!.isConnected, '按压窗口内整页换血被推迟（原节点存活）').toBe(true);

    // 抬起：真浏览器 click 在计时器前派发——夹具同步补发。
    pointer('pointerup', stopBtn!);
    stopBtn!.click();

    await flush();
    expect(actions).toContain('activity:stop');
    expect(root.querySelector('[data-act="stop"]')).toBeNull();
    expect(stopBtn!.isConnected, '释放后补换血已应用（推迟不吞重建）').toBe(false);
  });

  it('按压窗口内切页（lastSig=\'\' 强制重建）：推迟不丢失，释放后补换血到新页', async () => {
    const { root, ui } = mountGame();
    const startBtn = root.querySelector<HTMLElement>('.act-card .btn[data-act="start"]');
    expect(startBtn).not.toBeNull();

    pointer('pointerdown', startBtn!);
    // 按住时切页：navigate 置 lastSig='' 强制重建 → 守卫推迟（票评②等价面）。
    root.querySelector<HTMLElement>('.tab[data-tab="bag"]')!.click();
    ui.render();
    expect(startBtn!.isConnected, '切页重建被按压推迟（修炼页 DOM 未换血）').toBe(true);

    pointer('pointerup', startBtn!);
    await flush();
    expect(startBtn!.isConnected, '释放后补换血落到新页').toBe(false);
    expect(root.querySelector('.tab[data-tab="bag"]')!.classList.contains('active')).toBe(true);
  });

  it('release 饥饿兜底：pointerup 不达时超时放行，换血不被永久推迟', () => {
    vi.useFakeTimers();
    try {
      const { root, ui, game, clock } = mountGame();
      root.querySelector<HTMLElement>('.act-card .btn[data-act="start"]')!.click();
      ui.render();
      const stopBtn = root.querySelector<HTMLElement>('[data-act="stop"]');
      expect(stopBtn).not.toBeNull();

      pointer('pointerdown', stopBtn!);
      clock.advance(3000);
      game.tick(3000);
      ui.render();
      expect(stopBtn!.isConnected, '按压窗口内换血被推迟').toBe(true);

      // 不发 pointerup（按下中失窗）：过按压窗口上限 → 超时放行补换血。
      vi.advanceTimersByTime(PRESS_DEFER_MAX_MS + 1);
      expect(stopBtn!.isConnected, '超时放行：换血不再被永久推迟').toBe(false);
      // 超时后补发的 pointerup 无处可达（原节点已退场），不得二次重建/报错。
      pointer('pointerup', stopBtn!);
      expect(root.querySelector('[data-act="stop"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
