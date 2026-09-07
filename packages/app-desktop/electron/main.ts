/**
 * Electron 主进程（#10）：窗口生命周期 + 平台适配装配 + IPC 桥。
 *
 * - 平台装配先于窗口创建：preload 求值期即同步取 platform-info（sendSync），
 *   IPC handler 必须先注册（createWindow 之前）。
 * - 关闭即保存：周期自动保存（renderer attachAutoSave）+ renderer beforeunload
 *   的同步 flush（sendSync 保证退离前送达）；主进程侧无状态，只落平台槽位。
 * - 自动更新占位：见 updater.ts（票面「自动更新占位」，依赖待渠道定版）。
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errMsg, resolvePlatform, type Platform } from './platform.js';
import { initAutoUpdate } from './updater.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

let platform: Platform | undefined;
let log: (message: string) => void = () => {};

/** 主进程日志：stdout + userData/wendao.log（打包窗口态 stdout 不可见，验收可审计）。 */
function makeLogger(userDataDir: string): (message: string) => void {
  const logFile = join(userDataDir, 'wendao.log');
  return (message: string) => {
    console.log(message);
    try {
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
    if (slot && raw !== undefined) {
      try {
        platform?.writeSlot(slot, raw);
      } catch (err) {
        log(`[ipc] save-flush failed: ${errMsg(err)}`);
      }
    }
    event.returnValue = 'ok';
  });

  ipcMain.on('wendao:ach-report', (_event, id) => {
    const achievementId = asString(id);
    if (!achievementId) return;
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
  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(join(here, '../dist/index.html'));
  }
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

  void app.whenReady().then(() => {
    const userDataDir = app.getPath('userData');
    log = makeLogger(userDataDir);
    platform = resolvePlatform({ env: process.env, userDataDir, log });
    registerIpc();
    initAutoUpdate(log);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

process.on('uncaughtException', (err) => {
  log(`[main] uncaughtException: ${err.stack ?? err.message}`);
});
