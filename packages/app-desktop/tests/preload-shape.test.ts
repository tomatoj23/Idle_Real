// @vitest-environment node
/**
 * #76 项 2：preload 形状冒烟——fakeBridge（desktop-bridge.test）与手写 CJS
 * preload 此前各自为政：preload 改名/漏方法时生产形状防御（src/desktop.ts
 * desktopBridgeOf）把半残桥静默拒掉、回落 localStorage，测试侧照绿。
 *
 * 本冒烟在 stub 依赖下**真求值** preload 源码（非正则对文本），把两颗钉子
 * 串进 test script：① 暴露面恰为 5 成员；② desktopBridgeOf 对它认账
 * （preload ↔ DesktopBridge 契约闭环——此前的无类型链就断在这两面之间）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { desktopBridgeOf } from '../src/desktop';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** 期望暴露面（与 src/desktop.ts DesktopBridge 同名单——preload 漂移即红，逼同步改）。 */
const BRIDGE_MEMBERS = ['flushSave', 'loadSave', 'mode', 'reportAchievement', 'writeSave'];

/** CJS 沙箱求值 preload（require('electron') 打桩），返回 contextBridge 收到的暴露对象。 */
function evalPreload(source: string): Record<string, unknown> {
  const exposed: Record<string, unknown> = {};
  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld: (key: string, api: Record<string, unknown>): void => {
        expect(key).toBe('wendao'); // 桥名也是契约面（renderer 只认 window.wendao）
        Object.assign(exposed, api);
      },
    },
    ipcRenderer: {
      sendSync: (channel: string): unknown => (channel === 'wendao:platform-info' ? 'mock' : null),
      send: (): void => {},
    },
  };
  const req = (name: string): unknown => {
    if (name === 'electron') return fakeElectron;
    throw new Error(`preload 要求了计划外模块：${name}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(req, mod, mod.exports);
  return exposed;
}

function assertBridgeShape(exposed: Record<string, unknown>): void {
  expect(Object.keys(exposed).sort()).toEqual(BRIDGE_MEMBERS);
  expect(exposed.mode).toBe('mock');
  for (const method of ['loadSave', 'writeSave', 'flushSave', 'reportAchievement']) {
    expect(typeof exposed[method]).toBe('function');
  }
}

describe('#76 · preload 形状冒烟', () => {
  it('electron/preload.cjs 暴露面 = 5 成员，且过 desktopBridgeOf 形状门（契约钉）', () => {
    const exposed = evalPreload(readFileSync(join(pkgRoot, 'electron', 'preload.cjs'), 'utf8'));
    assertBridgeShape(exposed);
    // 契约钉：renderer 形状防御对真 preload 认账（改名/漏方法在此变红，不再静默回落）。
    const g = globalThis as { wendao?: unknown };
    g.wendao = exposed;
    try {
      expect(desktopBridgeOf()).toBe(exposed);
    } finally {
      delete g.wendao;
    }
  });

  // dist 产物在场才查（未构建环境显式跳过，不是静默绿）；只钉同形，字节新鲜度归
  // build:preload 的拷后断言。skipIf 在收集期判存在性，输出里跳过可见。
  it.skipIf(!existsSync(join(pkgRoot, 'dist-electron', 'preload.cjs')))(
    'dist-electron/preload.cjs 形状冒烟（构建产物同形；新鲜度归 build:preload）',
    () => {
      assertBridgeShape(
        evalPreload(readFileSync(join(pkgRoot, 'dist-electron', 'preload.cjs'), 'utf8')),
      );
    },
  );
});
