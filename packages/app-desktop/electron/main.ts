/**
 * Electron 主进程（#10）：窗口生命周期 + 平台适配装配 + IPC 桥。
 *
 * - 平台装配先于窗口创建：preload 求值期即同步取 platform-info（sendSync），
 *   IPC handler 必须先注册（createWindow 之前）。
 * - 关闭即保存：周期自动保存（renderer attachAutoSave）+ renderer beforeunload
 *   的同步 flush（sendSync 保证退离前送达）；主进程侧无状态，只落平台槽位。
 * - 自动更新占位：见 updater.ts（票面「自动更新占位」，依赖待渠道定版）。
 * - 安全纵深（#71）：导航精确同源 + 空应用菜单 + 权限 deny 兜底 + 崩溃兜底。
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import { appendFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { errMsg, isSafeId, resolvePlatform, type Platform } from './platform.js';
import { isSelfNavigation } from './navGuard.js';
import { createFatalHandler } from './fatal.js';
import { initAutoUpdate } from './updater.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

/**
 * 启动早期日志出口（#71 项 4）：`log` 在 whenReady 前曾是纯 noop，崩在启动路径上
 * （单例锁、IPC 注册）零痕迹。stderr 直写不依赖任何异步初始化；write 必须 bind
 * 宿主再存函数值（AGENTS.md 红线）。打包态 Windows 无控制台时这里看不见东西，
 * 那一侧的出声由 fatal 的 dialog 负责。process.stderr 本身可能不存在
 * （stdio 被忽略的启动方式），故取可选值。
 */
const stderr = process.stderr;
const writeStderr = stderr ? stderr.write.bind(stderr) : undefined;
let log: (message: string) => void = (message) => {
  try {
    writeStderr?.(`${message}\n`);
  } catch {
    // stderr 写不动：当行丢得干脆，正式日志器在 whenReady 后接管。
  }
};

/** 致命故障兜底（决策与文案见 fatal.ts）。 */
const fatal = createFatalHandler({
  // 取值器而非函数值：`log` 在 whenReady 后被整体替换，直接传 log 会把早期的
  // stderr 出口冻进闭包里，兜底就永远写不到 wendao.log 了。
  log: (message) => log(message),
  showError: (title, content) => dialog.showErrorBox(`${app.name} · ${title}`, content),
  exit: (code) => app.exit(code),
});

let platform: Platform | undefined;

/** 日志上限：放置游戏长跑防 wendao.log 无界增长吃满磁盘（超限整体截断重写）。 */
const LOG_MAX_BYTES = 1024 * 1024;

/** 主进程日志：stdout + userData/wendao.log（打包窗口态 stdout 不可见，验收可审计）。 */
function makeLogger(userDataDir: string): (message: string) => void {
  const logFile = join(userDataDir, 'wendao.log');
  return (message: string) => {
    console.log(message);
    try {
      // throwIfNoEntry：无日志文件 = 未超限，缺文件不算错误。
      if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > LOG_MAX_BYTES) {
        writeFileSync(logFile, '', 'utf8');
      }
      appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch {
      // 日志写失败不致命（磁盘满/权限）：游戏继续。
    }
  };
}

/** IPC 桥（全部入参形状校验：renderer 侧被攻破也不给主进程喂脏数据）。 */
function registerIpc(): void {
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;

  ipcMain.on('wendao:platform-info', (event) => {
    event.returnValue = platform?.mode ?? 'mock';
  });

  ipcMain.on('wendao:save-load', (event, key) => {
    const slot = asString(key);
    if (!slot) {
      event.returnValue = null;
      return;
    }
    try {
      event.returnValue = platform?.loadSlot(slot) ?? null;
    } catch (err) {
      log(`[ipc] save-load failed: ${errMsg(err)}`);
      event.returnValue = null;
    }
  });

  ipcMain.on('wendao:save-save', (_event, key, json) => {
    const slot = asString(key);
    const raw = asString(json);
    if (!slot || raw === undefined) return;
    try {
      platform?.writeSlot(slot, raw);
    } catch (err) {
      log(`[ipc] save-save failed: ${errMsg(err)}`);
    }
  });

  // 关闭即保存的关键路径：同步返回，确保 renderer beforeunload 阻塞等待落盘完成。
  ipcMain.on('wendao:save-flush', (event, key, json) => {
    const slot = asString(key);
    const raw = asString(json);
    let written = false;
    if (slot && raw !== undefined) {
      try {
        written = platform?.writeSlot(slot, raw) ?? false;
      } catch (err) {
        log(`[ipc] save-flush failed: ${errMsg(err)}`);
      }
    }
    // ack 说实话：'not-written' = 这次一字未落盘（槽位被保槽钉住 / 云端拒写 /
    // 入参不合），'ok' 才是存储确认收到。renderer 目前不读它，但把「没写」回执成
    // 「已落盘」正是下一个丢档故事的种子（#69 复审补）。
    event.returnValue = written ? 'ok' : 'not-written';
  });

  ipcMain.on('wendao:ach-report', (_event, id) => {
    const achievementId = asString(id);
    // 格式门（#71 项 6）：id 直传 Steam achievement.activate，并被 mock 侧当成本地
    // 账本的键写文件——不加校验 = 任意形状的串（超长键、含分隔符的键）都能进。
    // 刻意不用「内容包 id 白名单」：那要让主进程感知内容包（违 ADR-017 划界），
    // 而白名单真正能挡的是「伪造合法 id 刷成就」，本门只挡畸形 id——两码事，
    // 前者另议（见票面遗留段）。
    if (!achievementId) return;
    if (!isSafeId(achievementId)) {
      // 只报形状不报原串：id 由 renderer 供给，含换行就能往日志里伪造条目。
      log(`[ipc] ach-report rejected (len=${achievementId.length})`);
      return;
    }
    try {
      platform?.unlockAchievement(achievementId);
    } catch (err) {
      log(`[ipc] ach-report failed: ${errMsg(err)}`);
    }
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 导航加固（壳为单页应用，无外跳需求）：window.open 一律拒绝；跨文档导航只放行
  // 解析后与自身精确同源的那一个（判据与两处旧绕过见 navGuard.ts）。
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const indexPath = join(here, '../dist/index.html');
  const selfUrl = DEV_SERVER_URL ?? pathToFileURL(indexPath).href;
  win.webContents.on('will-navigate', (event, url) => {
    if (isSelfNavigation(url, selfUrl)) return;
    // 原串入日志前剥换行：`\n` 在 URL 里合法（WHATWG 解析时静默删掉，不影响拒判），
    // 直接入日志就等于允许伪造日志条目。
    log(`[main] navigation blocked: ${url.replace(/[\r\n]+/g, ' ')}`);
    event.preventDefault();
  });
  // 加载失败不许静默（#71 项 4）：reject 的是窗口内容本身，留着窗口 = 一块白板
  // 挂在玩家屏幕上。旧写法 `void load…()` 把这条 rejection 丢进了虚空。
  const load = DEV_SERVER_URL ? win.loadURL(DEV_SERVER_URL) : win.loadFile(indexPath);
  void load.catch((err: unknown) => fatal.onLoadFailure(err, selfUrl));
}

/**
 * 权限兜底（#71 项 5）：不注册时 clipboard-read / notifications / media 等
 * 走 Electron 的默认放行面。壳一项都不需要（零剪贴板调用、零通知、零媒体），
 * 故全拒。日后要放开按 permission 逐键加白名单，不放开通配。
 */
function registerPermissionDeny(): void {
  session.defaultSession.setPermissionRequestHandler((_win, permission, callback) => {
    log(`[main] permission denied: ${permission}`);
    callback(false);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 二开即聚焦已有窗口（放置游戏多开无意义）。
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app
    .whenReady()
    .then(() => {
      const userDataDir = app.getPath('userData');
      log = makeLogger(userDataDir);
      // 菜单面（#71 项 3）：autoHideMenuBar 只藏不禁——Alt 仍唤出默认菜单，里面的
      // DevTools / Reload / 缩放加速键打包版照样可达。置空才是不可达；此后 DevTools
      // 无任何打开接线（无菜单项、本壳不注册加速键也不调 openDevTools）。
      // 代价：mac 下连系统菜单一起没（Cmd+Q 无从按）。当前打包目标只有 win
      // （electron-builder.yml），日后出 mac 版须按 process.platform 留一份最小菜单。
      Menu.setApplicationMenu(null);
      registerPermissionDeny();
      platform = resolvePlatform({ env: process.env, userDataDir, log });
      registerIpc();
      initAutoUpdate(log);
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    // 启动链任一步上抛 = 窗口从未出现、进程却还在。旧写法既不 catch，也没有任何
    // unhandledRejection 处理器，只能落在 Node 的默认行为上（打一行栈到 stderr，
    // 打包态无人可见）；现在与其余致命故障同律：落盘 + 出声 + 结束（#71 项 4 同族补口）。
    .catch((err: unknown) => fatal.onStartupFailure(err));

  app.on('window-all-closed', () => {
    app.quit();
  });
}

process.on('uncaughtException', (err) => fatal.onUncaughtException(err));
process.on('unhandledRejection', (reason) => fatal.onUnhandledRejection(reason));
