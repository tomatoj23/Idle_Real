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
 * 假面的形状按 electron.d.ts 38.8.6 对齐（穷举复审的变异矩阵抓到过两处双盲：
 * will-navigate 的位参已 @deprecated、setPermissionRequestHandler 实为四参），
 * 并且**记下 BrowserWindow 的构造参数**——webPreferences 三件套不记就等于没钉。
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
let getPathThrows = false;
let windowDestroyed = false;
let reloadCount = 0;

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
      reload: () => {
        reloadCount += 1;
      },
    };
    isDestroyed(): boolean {
      return windowDestroyed;
    }
    loadFile(path: string): Promise<void> {
      loadFileArg = path;
      calls.push('load-file');
      return loadFileRejects
        ? Promise.reject(new Error('ERR_FILE_NOT_FOUND'))
        : Promise.resolve();
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
  delete process.env['VITE_DEV_SERVER_URL'];
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
  ipcHandlers.clear();
  windowOpenHandler = undefined;
  windowOptions = {};
  loadFileArg = '';
  menuArg = 'setApplicationMenu-never-called';
  permissionHandler = undefined;
  loadFileRejects = false;
  getPathThrows = false;
  windowDestroyed = false;
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
    expect(calls).not.toContain('load-url:http://localhost:5173');
    expect(loadFileArg).toMatch(/[/\\]dist[/\\]index\.html$/);
    const text = logText();
    expect(text).toContain('[platform] adapter=mock');
    expect(text).toContain('[updater] placeholder');
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
      // 第四参 details 按真签名喂足（electron.d.ts 38.8.6 为四参）：
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
    for (let i = 0; i < 4; i += 1) gone?.({}, { reason: 'crashed', exitCode: 1 });
    expect(reloadCount).toBe(3);
    expect(logText()).toContain('renderer gone (reason=crashed, exitCode=1) → escalate');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]?.[1]).toContain('存档');
    expect(calls).toContain('app.exit:1');
  });

  it('dom-ready 清零：崩溃→重载成功→再崩溃仍是 reload 1/3（承重例的接线半边）', async () => {
    await bootMain();
    const gone = winHandlers.get('render-process-gone');
    const loaded = winHandlers.get('dom-ready');
    expect(loaded).toBeTypeOf('function');
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    loaded?.({});
    gone?.({}, { reason: 'crashed', exitCode: 1 });
    expect(reloadCount).toBe(2);
    expect(dialogs).toHaveLength(0);
    // 两行都得是 1/3：按行数出来，防「第一行残留」造成的假对照。
    const reloadLines = logText()
      .split('\n')
      .filter((line) => line.includes('→ reload'));
    expect(reloadLines).toHaveLength(2);
    expect(reloadLines.every((line) => line.includes('reload 1/3'))).toBe(true);
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
