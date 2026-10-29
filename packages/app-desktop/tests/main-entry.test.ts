// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SAVE_KEY } from '../src/saveKey';

/**
 * #58 项 6 · 渲染入口 main.ts 装配：beforeunload 关闭即保存链。
 *
 * main.ts（renderer 侧）此前从未进过测试网——桌面主进程接线有
 * main-wiring.test.ts（假 electron 执行主进程入口），渲染入口没有对应物。
 * 本文件 import 真入口（editor app-assembly.test.ts 同款打法）：真装配
 * loadXiuxianPack → createGame → attachAutoSave → beforeunload 挂监 → buildUi，
 * 然后派发关闭事件，断言存档真落生产槽位（SAVE_KEY）。钉 main.ts:70 的
 * 监听挂接与 autoSave.flush() 调用——监听名拼错/flush 链断，本用例红。
 *
 * 注意：入口模块带顶层副作用（setInterval 主循环、真内容包装配），单文件
 * 单用例（模块注册表按文件隔离，不与其它测试共模块缓存）。
 */
describe('#58 项 6 · 渲染入口装配：beforeunload 关闭即保存', () => {
  it('关闭事件 → 自动保存落生产槽位（首启未触发时不落）', async () => {
    localStorage.removeItem(SAVE_KEY);
    document.body.innerHTML = '<div id="app"></div>';

    await import('../src/main.js');

    // 首启无档、未到 AUTOSAVE_MS 周期：槽位应仍为空（保存只发生在 flush 触发时）。
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();

    window.dispatchEvent(new Event('beforeunload'));

    const raw = localStorage.getItem(SAVE_KEY);
    expect(raw).not.toBeNull();
    const save = JSON.parse(raw!) as { version: number; savedAt?: number; state?: unknown };
    expect(save.version).toBe(1);
    expect(typeof save.savedAt).toBe('number');
    expect(save.state).toBeTruthy();
  });
});
