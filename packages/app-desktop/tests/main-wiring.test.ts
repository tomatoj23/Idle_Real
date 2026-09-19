// @vitest-environment node
/**
 * #71 · 主进程接线活体（在假 electron 下执行真正的 main.ts）。
 *
 * 判据本身另有 navGuard / fatal 两个单测覆盖；本文件量的是**接线**：空菜单是否真
 * 被置、权限 handler 是否真的一律回调 false、will-navigate 是否把判据接成了
 * preventDefault、成就 id 的门是否真在 IPC 口上、崩溃 handler 是否真的挂在 process。
 * 这些没有第二种观测手段——真机窗口不归 CI 管，而 main.ts 在本仓从未被任何用例执行
 * 过（electron 目录里此前只有零依赖的 platform.ts 进过 vitest，主进程入口没有）。
 *
 * 分支固定：删掉 VITE_DEV_SERVER_URL 之后才 import（main.ts 在模块求值期读它，
 * 事后改无效），走的是打包态 loadFile 分支。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ---------- 假 electron：只立 main.ts 用到的面（缺面即抛，比默默可用更接近真相） ---------- */

const calls: string[] = [];
const ipcHandlers = new Map<string, (event: { returnValue?: unknown }, ...a: unknown[]) => void>();
const winHandlers = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
const dialogs: Array<[string, string]> = [];
let menuArg: unknown = 'setApplicationMenu-never-called';
let permissionHandler:
  | ((win: unknown, permission: string, callback: (granted: boolean) => void) => void)
  | undefined;
let windowOpenHandler: (() => unknown) | undefined;
let loadFileArg = '';
let userDataDir = '';

vi.mock('electron', () => {
  class FakeBrowserWindow {
    static getAllWindows(): unknown[] {
      return [];
    }
    readonly webContents = {
      setWindowOpenHandler: (handler: () => unknown) => {
        windowOpenHandler = handler;
        calls.push('window-open-handler');
      },
      on: (event: string, handler: (e: { preventDefault(): void }, url: string) => void) => {
        winHandlers.set(event, handler);
      },
      openDevTools: () => calls.push('open-devtools'),
    };
    loadFile(path: string): Promise<void> {
      loadFileArg = path;
      calls.push('load-file');
      return Promise.resolve();
    }
    loadURL(url: string): Promise<void> {
      calls.push(`load-url:${url}`);
      return Promise.resolve();
    }
  }
  return {
    app: {
      name: 'wendao-wiring-test',
      requestSingleInstanceLock: () => {
        calls.push('single-instance-lock');
        return true;
      },
      on: (event: string) => calls.push(`app.on:${event}`),
      quit: () => calls.push('app.quit'),
      exit: (code: number) => calls.push(`app.exit:${code}`),
      getPath: (name: string) => {
        if (name !== 'userData') throw new Error(`unexpected getPath(${name})`);
        return userDataDir;
      },
      whenReady: () => Promise.resolve(),
    },
    BrowserWindow: FakeBrowserWindow,
    dialog: {
      showErrorBox: (title: string, content: string) => {
        dialogs.push([title, content]);
      },
    },
    ipcMain: {
      on: (channel: string, handler: (event: { returnValue?: unknown }, ...a: unknown[]) => void) =>
        ipcHandlers.set(channel, handler),
    },
    Menu: {
      setApplicationMenu: (menu: unknown) => {
        menuArg = menu;
        calls.push('set-application-menu');
      },
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (
          handler: (win: unknown, permission: string, callback: (granted: boolean) => void) => void,
        ) => {
          permissionHandler = handler;
          calls.push('set-permission-request-handler');
        },
      },
    },
  };
});

/** 等 whenReady 链上的 then/catch 跑完（纯微任务）。 */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

const savedListeners = {
  uncaughtException: [] as unknown[],
  unhandledRejection: [] as unknown[],
};

beforeAll(() => {
  savedListeners.uncaughtException = process.listeners('uncaughtException');
  savedListeners.unhandledRejection = process.listeners('unhandledRejection');
  delete process.env['VITE_DEV_SERVER_URL'];
});

afterEach(() => {
  // main.ts 每被重新求值一次就多挂一对 process handler；不清会把假 handler 留给
  // 同 worker 的其它用例（真抛错时它们按 #71 的口径是要 exit 的）。
  for (const kind of ['uncaughtException', 'unhandledRejection'] as const) {
    process.removeAllListeners(kind);
    for (const listener of savedListeners[kind]) {
      process.on(kind, listener as (arg?: unknown) => void);
    }
  }
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  calls.length = 0;
  dialogs.length = 0;
  winHandlers.clear();
  ipcHandlers.clear();
  windowOpenHandler = undefined;
  loadFileArg = '';
  menuArg = 'setApplicationMenu-never-called';
  permissionHandler = undefined;
});

/** 装一份全新的 main.ts（假 electron + 独立 userData 目录）。 */
async function bootMain(): Promise<void> {
  userDataDir = mkdtempSync(join(tmpdir(), 'wendao-main-'));
  vi.resetModules();
  await import('../electron/main');
  await flush();
}

function logText(): string {
  return existsSync(join(userDataDir, 'wendao.log'))
    ? readFileSync(join(userDataDir, 'wendao.log'), 'utf8')
    : '';
}

describe('#71 · 启动接线', () => {
  it('打包态走 loadFile 分支（非 loadURL），日志落在 userData/wendao.log', async () => {
    await bootMain();
    expect(calls).toContain('single-instance-lock');
    expect(calls).toContain('load-file');
    expect(loadFileArg).toMatch(/[/\\]dist[/\\]index\.html$/);
    const text = logText();
    expect(text).toContain('[platform] adapter=mock');
    expect(text).toContain('[updater] placeholder');
  });

  it('项 3：应用菜单置空、权限与 window-open handler 齐备且先于窗口加载，全程无人开 DevTools', async () => {
    await bootMain();
    expect(menuArg).toBeNull();
    expect(calls).toContain('set-permission-request-handler');
    expect(calls).toContain('window-open-handler');
    expect(calls.indexOf('set-application-menu')).toBeLessThan(calls.indexOf('load-file'));
    expect(calls.indexOf('set-permission-request-handler')).toBeLessThan(
      calls.indexOf('load-file'),
    );
    expect(windowOpenHandler?.()).toEqual({ action: 'deny' });
    // 「DevTools 无打开接线」那句注释的钉子：假窗口上 openDevTools 一旦被动就现形。
    expect(calls).not.toContain('open-devtools');
  });
});

describe('#71 项 1 · will-navigate 判据已接到事件上', () => {
  it('拒 file:///C:/evil.html 与同目录另一份 html，放行自身 URL（票面三例）', async () => {
    await bootMain();
    const handler = winHandlers.get('will-navigate');
    expect(handler).toBeTypeOf('function');
    const selfUrl = pathToFileURL(loadFileArg).href;
    const other = pathToFileURL(join(loadFileArg, '..', 'other.html')).href;
    let prevented = 0;
    const event = {
      preventDefault: () => {
        prevented += 1;
      },
    };
    handler?.(event, 'file:///C:/evil.html');
    handler?.(event, other);
    expect(prevented).toBe(2);
    expect(logText()).toContain('navigation blocked: file:///C:/evil.html');

    handler?.(event, selfUrl);
    expect(prevented).toBe(2); // 自身不拦（放行面，防「全拒」也能过）
  });
});

describe('#71 项 5 · 权限一律拒', () => {
  it('clipboard-read / notifications / media 回调 false，且每笔出声', async () => {
    await bootMain();
    expect(permissionHandler).toBeTypeOf('function');
    const granted: boolean[] = [];
    for (const permission of ['clipboard-read', 'notifications', 'media']) {
      permissionHandler?.({}, permission, (ok) => granted.push(ok));
    }
    expect(granted).toEqual([false, false, false]);
    expect(logText()).toContain('permission denied: notifications');
  });
});

describe('#71 项 6 · 成就 id 的门在 IPC 口上', () => {
  it('畸形 id 被拒且只报形状不报原串；合法 id 正常入账', async () => {
    await bootMain();
    const report = ipcHandlers.get('wendao:ach-report');
    expect(report).toBeTypeOf('function');
    report?.({}, '../../evil');
    report?.({}, 'x'.repeat(129));
    expect(existsSync(join(userDataDir, 'achievements.json'))).toBe(false);
    expect(logText()).toContain('ach-report rejected (len=10)');
    expect(logText()).not.toContain('../../evil'); // 日志里不回显原串

    report?.({}, 'kill_100');
    const book = JSON.parse(
      readFileSync(join(userDataDir, 'achievements.json'), 'utf8'),
    ) as Record<string, { achievements?: Record<string, string> }>;
    expect(Object.keys(book.achievements ?? {})).toEqual(['kill_100']);
  });
});

describe('#71 项 4 · 崩溃兜底真的挂在 process 上', () => {
  it('uncaughtException：落 FATAL 日志 + 弹一次提示 + app.exit(1)', async () => {
    await bootMain();
    expect(process.listeners('uncaughtException').length).toBeGreaterThan(0);
    process.emit('uncaughtException', new Error('probe-crash'));
    const text = logText();
    expect(text).toContain('FATAL uncaughtException');
    expect(text).toContain('probe-crash');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]?.[0]).toContain('wendao-wiring-test');
    expect(calls).toContain('app.exit:1');
  });

  it('unhandledRejection：只记一行，不弹提示也不退出', async () => {
    await bootMain();
    process.emit('unhandledRejection', new Error('probe-rejection'), Promise.resolve());
    await flush();
    expect(logText()).toContain('unhandledRejection');
    expect(logText()).not.toContain('FATAL');
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });
});
