// @vitest-environment node
/**
 * #71 · 主进程接线活体（在假 electron 下执行真正的 main.ts）。
 *
 * 判据本身另有 navGuard / fatal 两个单测覆盖；本文件量的是**接线**：空菜单是否真
 * 被置、权限 handler 是否真的一律回调 false、will-navigate 是否把判据接成了
 * preventDefault、成就 id 的门是否真在 IPC 口上、崩溃与加载失败两条兜底是否真接上。
 * 这些没有第二种观测手段——真机窗口不归 CI 管，而 main.ts 在本仓从未被任何用例执行
 * 过（electron 目录里此前只有零依赖的 platform.ts 进过 vitest，主进程入口没有）。
 *
 * 假面的形状按 electron.d.ts 对齐（穷举复审的变异矩阵抓到过两处双盲：
 * will-navigate 的位参已 @deprecated、setPermissionRequestHandler 实为四参），
 * 并且**记下 BrowserWindow 的构造参数**——webPreferences 三件套不记就等于没钉。
 * 形状不写死版本号（#67 升 44 复核过：两处仍然成立），升 Electron 时按新 d.ts
 * 过一遍即可。
 *
 * #76：VITE_DEV_SERVER_URL 死分支已删（用户裁决）——main.ts 恒走 loadFile，
 * 假面不再提供 loadURL（缺面即抛）。反向钉见「设 env 仍恒 loadFile」例——
 * 光看 loadFile 断言是空转（env 未设时旧分支也走打包态），必须喂 env 才钉得住。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ---------- 假 electron：只立 main.ts 用到的面（缺面即抛，比默默可用更接近真相） ---------- */

/**
 * webContents.on 的登记面（#71 三轮放宽）：will-navigate 是单参 NavEvent 形，
 * render-process-gone 是 (event, details) 两参形——统一收成 unknown 链、按事件名
 * 取用后再窄化，别为此把两个事件塞进同一个键（同名第二个 handler 会静默覆盖，
 * 已记 #76；本批新增的事件名均不与既有重名）。
 */
type WinHandler = (event: unknown, ...args: unknown[]) => void;

const calls: string[] = [];
const ipcHandlers = new Map<string, (event: { returnValue?: unknown }, ...a: unknown[]) => void>();
const winHandlers = new Map<string, WinHandler>();
const windowHandlers = new Map<string, WinHandler>();
const appHandlers = new Map<string, (...a: unknown[]) => void>();
const dialogs: Array<[string, string]> = [];
let menuArg: unknown = 'setApplicationMenu-never-called';
let permissionHandler:
  | ((win: unknown, permission: string, callback: (granted: boolean) => void, details: unknown) => void)
  | undefined;
let windowOpenHandler: (() => unknown) | undefined;
let windowOptions: Record<string, unknown> = {};
let loadFileArg = '';
let userDataDir = '';
let loadFileRejects = false;
let initialLoad: { promise: Promise<void>; reject: (reason: unknown) => void } | undefined;
let rendererCrashed = false;
let getPathThrows = false;
let windowDestroyed = false;
let windowVisible = true;
let reloadCount = 0;
const monotonicClock = vi.hoisted(() => ({ value: 0 }));

vi.mock('node:perf_hooks', () => ({
  performance: {
    now: () => monotonicClock.value,
  },
}));

vi.mock('electron', () => {
  class FakeBrowserWindow {
    static getAllWindows(): unknown[] {
      return [];
    }
    /** 记下构造参数：否则 `sandbox:false` 这类回退在此文件里无声通过。 */
    constructor(options: Record<string, unknown>) {
      windowOptions = options;
    }
    readonly webContents = {
      setWindowOpenHandler: (handler: () => unknown) => {
        windowOpenHandler = handler;
        calls.push('window-open-handler');
      },
      on: (event: string, handler: WinHandler) => {
        winHandlers.set(event, handler);
      },
      openDevTools: () => calls.push('open-devtools'),
      isCrashed: () => {
        calls.push('webContents.isCrashed');
        if (windowDestroyed) throw new Error('Object has been destroyed');
        return rendererCrashed;
      },
      reload: () => {
        rendererCrashed = false;
        reloadCount += 1;
      },
    };
    on(event: string, handler: WinHandler): void {
      windowHandlers.set(event, handler);
    }
    isVisible(): boolean {
      calls.push('window.isVisible');
      if (windowDestroyed) throw new Error('Object has been destroyed');
      return windowVisible;
    }
    isDestroyed(): boolean {
      return windowDestroyed;
    }
    loadFile(path: string): Promise<void> {
      loadFileArg = path;
      calls.push('load-file');
      return initialLoad?.promise ?? (loadFileRejects
        ? Promise.reject(new Error('ERR_FILE_NOT_FOUND'))
        : Promise.resolve());
    }
  }
  return {
    app: {
      name: 'wendao-wiring-test',
      requestSingleInstanceLock: () => {
        calls.push('single-instance-lock');
        return true;
      },
      on: (event: string, handler: (...a: unknown[]) => void) => {
        appHandlers.set(event, handler);
        calls.push(`app.on:${event}`);
      },
      quit: () => calls.push('app.quit'),
      exit: (code: number) => calls.push(`app.exit:${code}`),
      getPath: (name: string) => {
        if (name !== 'userData') throw new Error(`unexpected getPath(${name})`);
        if (getPathThrows) throw new Error('userData 不可得（启动链上抛的替身）');
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
          handler: (
            win: unknown,
            permission: string,
            callback: (granted: boolean) => void,
            details: unknown,
          ) => void,
        ) => {
          permissionHandler = handler;
          calls.push('set-permission-request-handler');
        },
      },
    },
  };
});

const savedListeners: {
  uncaughtException: unknown[];
  unhandledRejection: unknown[];
} = { uncaughtException: [], unhandledRejection: [] };

beforeAll(() => {
  savedListeners.uncaughtException = process.listeners('uncaughtException');
  savedListeners.unhandledRejection = process.listeners('unhandledRejection');
});

afterEach(() => {
  // main.ts 每被重新求值一次就多挂一对 process handler；不清会把假 handler 留给
  // 同 worker 的其它用例（真抛错时它们按 #71 的口径是要 exit 的）。
  // 清空后按基线原序装回（removeListener 的重载不接受这个联合 kind）。
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
  windowHandlers.clear();
  appHandlers.clear();
  ipcHandlers.clear();
  windowOpenHandler = undefined;
  windowOptions = {};
  loadFileArg = '';
  menuArg = 'setApplicationMenu-never-called';
  permissionHandler = undefined;
  loadFileRejects = false;
  initialLoad = undefined;
  rendererCrashed = false;
  getPathThrows = false;
  windowDestroyed = false;
  windowVisible = true;
  monotonicClock.value = 0;
  reloadCount = 0;
});

/** 装一份全新的 main.ts（假 electron + 独立 userData 目录）。 */
async function bootMain(): Promise<void> {
  userDataDir = mkdtempSync(join(tmpdir(), 'wendao-main-'));
  vi.resetModules();
  await import('../electron/main');
  // 等真实信号而不是猜微任务数：装配走完的标志是 loadFile 被登记。
  // （穷举复审抓到过 flush(n) 这种写法在并发负载下把已装好的面读成未装好。）
  await vi.waitFor(() => expect(calls).toContain('load-file'), { timeout: 2000 });
}

function deferredLoad(): { promise: Promise<void>; reject: (reason: unknown) => void } {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

async function finishDeferredLoad(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function logText(): string {
  return existsSync(join(userDataDir, 'wendao.log'))
    ? readFileSync(join(userDataDir, 'wendao.log'), 'utf8')
    : '';
}

describe('#71 · 启动接线', () => {
  it('恒走 loadFile 加载打包产物（#76 删 dev-server 分支后的唯一路径），日志落在 userData/wendao.log', async () => {
    await bootMain();
    expect(calls).toContain('single-instance-lock');
    expect(calls).toContain('load-file');
    expect(loadFileArg).toMatch(/[/\\]dist[/\\]index\.html$/);
    const text = logText();
    expect(text).toContain('[platform] adapter=mock');
    expect(text).toContain('[updater] placeholder');
  });

  it('#76 反向钉：设 VITE_DEV_SERVER_URL 也恒走 loadFile（谁加回 dev 分支谁先红）', async () => {
    // 旧分支的三元判据只在 env 有值时走 loadURL——env 不喂，本例之前全是空转钉。
    process.env['VITE_DEV_SERVER_URL'] = 'http://localhost:5173';
    try {
      await bootMain();
      expect(calls).toContain('load-file');
      expect(calls).not.toContain('load-url:http://localhost:5173');
      expect(loadFileArg).toMatch(/[/\\]dist[/\\]index\.html$/);
      expect(dialogs).toHaveLength(0);
    } finally {
      delete process.env['VITE_DEV_SERVER_URL'];
    }
  });

  it('webPreferences 三件套 + preload 在位（假窗口记构造参数，否则这项等于没测）', async () => {
    await bootMain();
    const wp = windowOptions['webPreferences'] as Record<string, unknown>;
    expect(wp['contextIsolation']).toBe(true);
    expect(wp['nodeIntegration']).toBe(false);
    expect(wp['sandbox']).toBe(true);
    expect(String(wp['preload'])).toMatch(/preload\.cjs$/);
    expect(windowOptions['autoHideMenuBar']).toBe(true);
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
    const fire = (url: string): void =>
      handler?.({ url, preventDefault: () => void (prevented += 1) });
    fire('file:///C:/evil.html');
    fire(other);
    expect(prevented).toBe(2);
    expect(logText()).toContain('navigation blocked: file:///C:/evil.html');

    fire(selfUrl);
    expect(prevented).toBe(2); // 自身不拦（放行面，防「全拒」也能过）
  });

  it('被拒 URL 里的换行不另起一行：伪造条目被并回本行', async () => {
    await bootMain();
    const handler = winHandlers.get('will-navigate');
    handler?.({
      url: 'file:///C:/evil.html\n[fake] 这是伪造的第二行',
      preventDefault: () => {},
    });
    const line = logText()
      .split('\n')
      .find((l) => l.includes('这是伪造的第二行'));
    // 正对照：剥换行失效时，这段文字会自成一列、行首不含 navigation blocked。
    expect(line ?? '').toContain('navigation blocked');
  });
});

describe('#71 项 5 · 权限一律拒', () => {
  it('clipboard-read / notifications / media 回调 false，且每笔出声', async () => {
    await bootMain();
    expect(permissionHandler).toBeTypeOf('function');
    const granted: boolean[] = [];
    for (const permission of ['clipboard-read', 'notifications', 'media']) {
      // 第四参 details 按真签名喂足（setPermissionRequestHandler 实为四参）：
      // 日后按 permission 加白名单要用它，缺这一参就是本文件与产品代码的双盲。
      permissionHandler?.({}, permission, (ok) => granted.push(ok), {
        requestingUrl: 'file:///app/index.html',
        isMainFrame: true,
      });
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
    // 比基线多一个而不是「大于 0」：vitest 自己就挂着处理器，>0 恒真（审计抓的空断言）。
    expect(process.listeners('uncaughtException').length).toBe(
      savedListeners.uncaughtException.length + 1,
    );
    expect(process.listeners('unhandledRejection').length).toBe(
      savedListeners.unhandledRejection.length + 1,
    );
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
    expect(logText()).toContain('unhandledRejection');
    expect(logText()).not.toContain('FATAL');
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });

  it('loadFile reject：接上 onLoadFailure（弹窗点名 URL 并退出）', async () => {
    loadFileRejects = true;
    userDataDir = mkdtempSync(join(tmpdir(), 'wendao-main-'));
    vi.resetModules();
    await import('../electron/main');
    await vi.waitFor(() => expect(dialogs.length).toBe(1), { timeout: 2000 });
    expect(logText()).toContain('FATAL load failed');
    expect(logText()).toContain('ERR_FILE_NOT_FOUND');
    expect(dialogs[0]?.[1]).toContain('ERR_FILE_NOT_FOUND');
    expect(calls).toContain('app.exit:1');
  });

  it('whenReady 链上抛：走 startup 兜底，且早期 stderr 出口确实把消息送了出去', async () => {
    const seen: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    // 必须在 import 之前换掉：main.ts 在模块求值期就 bind 走 stderr.write。
    process.stderr.write = ((chunk: string) => {
      seen.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    getPathThrows = true;
    userDataDir = mkdtempSync(join(tmpdir(), 'wendao-main-'));
    try {
      vi.resetModules();
      await import('../electron/main');
      await vi.waitFor(() => expect(dialogs.length).toBe(1), { timeout: 2000 });
    } finally {
      process.stderr.write = realWrite;
    }
    // whenReady 前没有文件日志器可写——这一行就是「启动早期崩溃零痕迹」的对照组。
    expect(seen.join('')).toContain('FATAL startup failed');
    expect(dialogs[0]?.[1]).toContain('userData 不可得');
    expect(calls).toContain('app.exit:1');
  });
});

describe('#71 三轮 · 渲染进程崩溃恢复真的接上了', () => {
  it('crashed：reload 1 次、落一行 renderer gone、无弹窗无退出', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    expect(gone).toBeTypeOf('function');
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    expect(reloadCount).toBe(1);
    expect(logText()).toContain('renderer gone (reason=crashed, exitCode=1) → reload 1/3');
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });

  it('崩环界：连报 4 次（中间无 dom-ready）→ reload 共 3 次，第 4 次弹窗点名存档 + app.exit(1)', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    expect(gone).toBeTypeOf('function');
    for (let i = 0; i < 4; i += 1) gone?.({}, { reason: 'crashed', exitCode: 1 });
    expect(reloadCount).toBe(3);
    expect(logText()).toContain('renderer gone (reason=crashed, exitCode=1) → escalate');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]?.[1]).toContain('存档');
    expect(calls).toContain('app.exit:1');
  });

  it('dom-ready 后秒崩仍受上限：每轮 reload 后立即 dom-ready，第 4 次弹窗并退出', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const loaded = winHandlers.get('dom-ready');
    expect(gone).toBeTypeOf('function');
    expect(loaded).toBeTypeOf('function');
    for (let i = 0; i < 4; i += 1) {
      gone?.({}, { reason: 'crashed', exitCode: 1 });
      loaded?.({});
    }
    expect(reloadCount).toBe(3);
    expect(dialogs).toHaveLength(1);
    expect(calls).toContain('app.exit:1');
  });

  it('dom-ready 短时不清零：崩溃→重载成功→再崩溃仍累计预算', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const loaded = winHandlers.get('dom-ready');
    expect(gone).toBeTypeOf('function');
    expect(loaded).toBeTypeOf('function');
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    loaded?.({});
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    expect(reloadCount).toBe(2);
    expect(dialogs).toHaveLength(0);
    const reloadLines = logText()
      .split('\n')
      .filter((line) => line.includes('→ reload'));
    expect(reloadLines).toHaveLength(2);
    expect(reloadLines[0]).toContain('reload 1/3');
    expect(reloadLines[1]).toContain('reload 2/3');
  });

  it('memory-eviction：可见窗口立即 reload，不可见窗口延迟到 show/restore 且重复事件只排一次', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const show = windowHandlers.get('show');
    const restore = windowHandlers.get('restore');
    expect(gone).toBeTypeOf('function');
    expect(show).toBeTypeOf('function');
    expect(restore).toBeTypeOf('function');

    gone?.({}, { reason: 'memory-eviction', exitCode: 9 });
    expect(reloadCount).toBe(1);

    windowVisible = false;
    gone?.({}, { reason: 'memory-eviction', exitCode: 10 });
    gone?.({}, { reason: 'memory-eviction', exitCode: 11 });
    expect(reloadCount).toBe(1);

    show?.({});
    expect(reloadCount).toBe(1);
    windowVisible = true;
    restore?.({});
    expect(reloadCount).toBe(2);
    show?.({});
    expect(reloadCount).toBe(2);
  });

  it('memory-eviction 隐藏等待跨稳定窗口仍沿用连续预算', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const loaded = winHandlers.get('dom-ready');
    const show = windowHandlers.get('show');
    expect(gone).toBeTypeOf('function');
    expect(loaded).toBeTypeOf('function');
    expect(show).toBeTypeOf('function');

    gone?.({}, { reason: 'crashed', exitCode: 1 });
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    monotonicClock.value = 100;
    loaded?.({});

    windowVisible = false;
    gone?.({}, { reason: 'memory-eviction', exitCode: 2 });
    monotonicClock.value = 100 + 3000;
    windowVisible = true;
    show?.({});
    expect(reloadCount).toBe(3);
    expect(logText()).toContain('renderer gone (reason=memory-eviction, exitCode=2) → reload 3/3');
  });

  it.each(['show', 'restore'])('隐藏回收前已稳定：%s 后不是误升级 fatal', async (event) => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const loaded = winHandlers.get('dom-ready');
    const resume = windowHandlers.get(event);
    expect(gone).toBeTypeOf('function');
    expect(loaded).toBeTypeOf('function');
    expect(resume).toBeTypeOf('function');
    for (let i = 0; i < 3; i += 1) gone?.({}, { reason: 'crashed', exitCode: 1 });
    monotonicClock.value = 10000;
    loaded?.({});
    monotonicClock.value += 3000;
    windowVisible = false;
    gone?.({}, { reason: 'memory-eviction', exitCode: 2 });
    monotonicClock.value += 6000;
    windowVisible = true;
    resume?.({});
    expect(reloadCount).toBe(4);
    expect(logText()).toContain('reason=memory-eviction, exitCode=2) → reload 1/3');
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });

  it.each([2999, 3000])('真实接线按非零 dom-ready 起点计算 %dms 稳定期', async (elapsed) => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const loaded = winHandlers.get('dom-ready');
    expect(gone).toBeTypeOf('function');
    expect(loaded).toBeTypeOf('function');
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    monotonicClock.value = 10000;
    loaded?.({});
    monotonicClock.value += elapsed;
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    const reloadLines = logText().split('\n').filter((line) => line.includes('→ reload'));
    expect(reloadLines.at(-1)).toContain(`reload ${elapsed === 3000 ? 1 : 2}/3`);
  });

  it.each(['promise-first', 'gone-first'])('首次加载中崩溃：%s 不绕过恢复预算', async (order) => {
    const deferred = deferredLoad();
    initialLoad = { promise: deferred.promise, reject: deferred.reject };
    await bootMain();
    const loaded = winHandlers.get('dom-ready');
    const gone = winHandlers.get('render-process-gone');
    expect(loaded).toBeTypeOf('function');
    expect(gone).toBeTypeOf('function');
    loaded?.({});
    rendererCrashed = true;
    if (order === 'promise-first') {
      deferred.reject(new Error('ERR_FAILED (-2)'));
      await finishDeferredLoad();
    }
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    if (order === 'gone-first') deferred.reject(new Error('ERR_ABORTED (-3)'));
    await finishDeferredLoad();
    expect(reloadCount).toBe(1);
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });

  it.each(['quitting', 'destroyed'])('首次加载期间正常 %s 不报致命加载失败', async (state) => {
    const deferred = deferredLoad();
    initialLoad = { promise: deferred.promise, reject: deferred.reject };
    await bootMain();
    if (state === 'quitting') appHandlers.get('before-quit')?.();
    else windowDestroyed = true;
    deferred.reject(new Error('ERR_FAILED (-2)'));
    const nativeReads = calls.filter((call) => call === 'webContents.isCrashed').length;
    await finishDeferredLoad();
    expect(calls.filter((call) => call === 'webContents.isCrashed')).toHaveLength(nativeReads);
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });

  it('首次 Promise 拒绝微任务早于崩溃标志：延后一轮不误退出', async () => {
    const deferred = deferredLoad();
    initialLoad = { promise: deferred.promise, reject: deferred.reject };
    await bootMain();
    deferred.reject(new Error('ERR_FAILED (-2)'));
    await Promise.resolve();
    expect(dialogs).toHaveLength(0);
    rendererCrashed = true;
    await finishDeferredLoad();
    const gone = winHandlers.get('render-process-gone');
    expect(gone).toBeTypeOf('function');
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    expect(reloadCount).toBe(1);
    expect(dialogs).toHaveLength(0);
  });

  it.each([-2, -6])('恢复后主框架真实加载失败 %d 仍 fatal，旧 Promise 不再报第二次', async (code) => {
    const deferred = deferredLoad();
    initialLoad = { promise: deferred.promise, reject: deferred.reject };
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const failed = winHandlers.get('did-fail-load');
    expect(gone).toBeTypeOf('function');
    expect(failed).toBeTypeOf('function');
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    failed?.({}, code, '', 'file:///app/dist/index.html', true, 1, 1);
    deferred.reject(new Error('ERR_ABORTED (-3)'));
    await finishDeferredLoad();
    expect(dialogs).toHaveLength(1);
    expect(logText()).toContain(`(${code})`);
    expect(calls.filter((call) => call === 'app.exit:1')).toHaveLength(1);
  });

  it.each(['subframe', 'aborted', 'quitting', 'destroyed'])('加载事件 %s 不误报 fatal', async (kind) => {
    await bootMain();
    const failed = winHandlers.get('did-fail-load');
    expect(failed).toBeTypeOf('function');
    if (kind === 'quitting') appHandlers.get('before-quit')?.();
    if (kind === 'destroyed') windowDestroyed = true;
    failed?.({}, kind === 'aborted' ? -3 : -6, 'probe', 'file:///app/dist/index.html', kind !== 'subframe', 1, 1);
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });

  it('主框架失败重复通知与 Promise 拒绝只收尾一次', async () => {
    const deferred = deferredLoad();
    initialLoad = deferred;
    await bootMain();
    const failed = winHandlers.get('did-fail-load');
    expect(failed).toBeTypeOf('function');
    failed?.({}, -6, 'ERR_FILE_NOT_FOUND', 'file:///app/dist/index.html', true, 1, 1);
    failed?.({}, -6, 'ERR_FILE_NOT_FOUND', 'file:///app/dist/index.html', true, 1, 1);
    deferred.reject(new Error('ERR_FILE_NOT_FOUND'));
    await finishDeferredLoad();
    expect(dialogs).toHaveLength(1);
    expect(calls.filter((call) => call === 'app.exit:1')).toHaveLength(1);
    expect(logText().split('\n').filter((line) => line.includes('FATAL load failed'))).toHaveLength(1);
  });

  it.each(['quitting', 'destroyed'])('gone 处理前先筛 %s，不查询窗口可见性', async (state) => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const beforeQuit = appHandlers.get('before-quit');
    expect(gone).toBeTypeOf('function');
    expect(beforeQuit).toBeTypeOf('function');
    if (state === 'quitting') beforeQuit?.();
    else windowDestroyed = true;
    const reads = calls.filter((call) => call === 'window.isVisible').length;
    expect(() => gone?.({}, { reason: 'memory-eviction', exitCode: 9 })).not.toThrow();
    expect(calls.filter((call) => call === 'window.isVisible')).toHaveLength(reads);
    expect(logText()).not.toContain('defer until visible');
    expect(reloadCount).toBe(0);
    expect(dialogs).toHaveLength(0);
  });

  it('memory-eviction 待处理后退出不复活窗口', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const show = windowHandlers.get('show');
    expect(gone).toBeTypeOf('function');
    expect(show).toBeTypeOf('function');
    windowVisible = false;
    gone?.({}, { reason: 'memory-eviction', exitCode: 9 });
    appHandlers.get('before-quit')?.();
    windowVisible = true;
    const reads = calls.filter((call) => call === 'window.isVisible').length;
    show?.({});
    expect(calls.filter((call) => call === 'window.isVisible')).toHaveLength(reads);
    expect(reloadCount).toBe(0);
  });

  it('memory-eviction 待处理后窗口销毁不复活', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const show = windowHandlers.get('show');
    expect(gone).toBeTypeOf('function');
    expect(show).toBeTypeOf('function');
    windowVisible = false;
    gone?.({}, { reason: 'memory-eviction', exitCode: 10 });
    windowDestroyed = true;
    windowVisible = true;
    expect(() => show?.({})).not.toThrow();
    expect(reloadCount).toBe(0);
  });

  it('still-running：接线层不 reload、不弹窗、不退出', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    expect(gone).toBeTypeOf('function');
    gone?.({}, { reason: 'still-running', exitCode: 0 });
    expect(reloadCount).toBe(0);
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });

  it('对照例：clean-exit 零重载（僵尸窗口那个回归）', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    expect(gone).toBeTypeOf('function'); // 无实现时 `gone?.()` 空转也会让下面全绿，先钉 handler 在场
    gone?.({}, { reason: 'clean-exit', exitCode: 0 });
    expect(reloadCount).toBe(0);
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
  });

  it('unresponsive 只记不杀：一行日志，零 reload 零弹窗零退出；responsive 同事件对也接上', async () => {
    await bootMain();
    const unresponsive = winHandlers.get('unresponsive');
    expect(unresponsive).toBeTypeOf('function');
    unresponsive?.({});
    expect(logText()).toContain('renderer unresponsive');
    expect(reloadCount).toBe(0);
    expect(dialogs).toHaveLength(0);
    expect(calls).not.toContain('app.exit:1');
    winHandlers.get('responsive')?.({});
    expect(logText()).toContain('renderer responsive');
  });
});
