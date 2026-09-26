// @vitest-environment node
/**
 * #71 三轮 · 渲染进程崩溃恢复判据（纯模块单测）。
 *
 * 承重两条（票面测试计划点名）：
 * ① crashed 连报 3 次走 reload、第 4 次 escalate——上限就是 fatal.ts 拒绝 relaunch
 *    的同一个崩环防线（一份让渲染进程启动期崩坏的存档 = 每次 reload 都崩）；
 * ② markLoaded() 把计数清回 0（下一次报数回到 1/3）——没有它，正常游戏里偶尔一次
 *    崩溃会永久消耗预算，数天后的第 4 次无关崩溃被误升级成 app.exit。
 *
 * 放行面（clean-exit / 已销毁 / 正在退出 → ignore）单独成例：没有它们，「一律
 * ignore」或「一律 escalate」的全拒实现也能通过动手面的例。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：把 `attempts >= RELOAD_LIMIT`
 * 改成 `>`、删掉 markLoaded 的清零、把 clean-exit 落进动手面——每种都必须有例变红。
 */
import { describe, expect, it } from 'vitest';
import {
  createRendererRecovery,
  RELOAD_LIMIT,
  type GoneReason,
  type RendererRecovery,
} from '../electron/rendererRecovery';

interface Harness {
  readonly recovery: RendererRecovery;
  quitting: boolean;
  destroyed: boolean;
}

function harness(): Harness {
  const state: Harness = {
    quitting: false,
    destroyed: false,
    recovery: undefined as unknown as RendererRecovery,
  };
  // 谓词每次 decide 都现查（对象属性可中途翻转，见「谓词是活的」例）。
  (state as { recovery: RendererRecovery }).recovery = createRendererRecovery({
    isQuitting: () => state.quitting,
    isDestroyed: () => state.destroyed,
  });
  return state;
}

describe('#71 三轮 · 放行面（不动作）', () => {
  it('clean-exit 是真退出：ignore（重载 = 关不掉的僵尸窗口）', () => {
    const { recovery } = harness();
    expect(recovery.decide('clean-exit')).toEqual({ action: 'ignore' });
  });

  it('窗口已销毁：ignore（没有可重载的对象）', () => {
    const h = harness();
    h.destroyed = true;
    expect(h.recovery.decide('crashed')).toEqual({ action: 'ignore' });
  });

  it('正在退出：ignore（退出链上的渲染进程消失不是故障）', () => {
    const h = harness();
    h.quitting = true;
    expect(h.recovery.decide('crashed')).toEqual({ action: 'ignore' });
  });

  it('谓词是活的：每次 decide 现查，不在工厂求值期冻结', () => {
    const h = harness();
    expect(h.recovery.decide('crashed')).toEqual({ action: 'reload', attempt: 1 });
    h.destroyed = true;
    expect(h.recovery.decide('crashed')).toEqual({ action: 'ignore' });
  });
});

describe('#71 三轮 · 重载上限与清零', () => {
  it('crashed 连报：前 3 次 reload（attempt 1..3），第 4 次 escalate', () => {
    const { recovery } = harness();
    const actions = (['crashed', 'crashed', 'crashed', 'crashed'] as GoneReason[]).map((r) =>
      recovery.decide(r),
    );
    expect(actions).toEqual([
      { action: 'reload', attempt: 1 },
      { action: 'reload', attempt: 2 },
      { action: 'reload', attempt: 3 },
      { action: 'escalate' },
    ]);
    expect(RELOAD_LIMIT).toBe(3); // 日志面 `reload n/3` 的分母与上限同源
  });

  it('承重例：markLoaded() 后计数归零，下一次报数回到 1（而非 3）', () => {
    const { recovery } = harness();
    recovery.decide('crashed');
    recovery.decide('crashed');
    recovery.markLoaded();
    expect(recovery.decide('crashed')).toEqual({ action: 'reload', attempt: 1 });
    // 清零后预算真的重来：再走满 3 次才 escalate（证明不是「只改报数」）。
    recovery.decide('crashed');
    recovery.decide('crashed');
    expect(recovery.decide('crashed')).toEqual({ action: 'escalate' });
  });

  it('oom 与 killed 各走 reload（动手面）', () => {
    const { recovery } = harness();
    expect(recovery.decide('oom')).toEqual({ action: 'reload', attempt: 1 });
    expect(recovery.decide('killed')).toEqual({ action: 'reload', attempt: 2 });
  });

  it('abnormal-exit 与 launch-failed 同在动手面（枚举全五员）', () => {
    const { recovery } = harness();
    expect(recovery.decide('abnormal-exit')).toEqual({ action: 'reload', attempt: 1 });
    expect(recovery.decide('launch-failed')).toEqual({ action: 'reload', attempt: 2 });
  });

  it('integrity-failure 直接 escalate：asar 被动过，重载没用', () => {
    const { recovery } = harness();
    expect(recovery.decide('integrity-failure')).toEqual({ action: 'escalate' });
  });

  it('未知 reason（日后 Electron 新增）也走重载路径并受同一上限：白窗永挂正是本模块要消灭的病', () => {
    const { recovery } = harness();
    const unknown = 'some-future-reason' as GoneReason;
    expect(recovery.decide(unknown)).toEqual({ action: 'reload', attempt: 1 });
    recovery.decide(unknown);
    recovery.decide(unknown);
    expect(recovery.decide(unknown)).toEqual({ action: 'escalate' });
  });
});
