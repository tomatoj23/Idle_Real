/**
 * #10 预加载桥：沙箱模式下 Electron preload 须为 CJS（ESM preload 需关沙箱），
 * 故本文件手写 JS 不走 tsc 编译；renderer 侧形状防御见 src/desktop.ts。
 *
 * 暴露面（window.wendao）：
 * - mode：平台模式（'mock' | 'steam'），preload 求值期同步取得；
 * - loadSave/flushSave：同步 IPC（启动一次性读档 / 关闭即保存兜底）；
 * - saveSave / reportAchievement：异步 send（周期自动保存 / 成就上报管道）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wendao', {
  mode: ipcRenderer.sendSync('wendao:platform-info'),
  loadSave: (key) => ipcRenderer.sendSync('wendao:save-load', key),
  writeSave: (key, json) => ipcRenderer.send('wendao:save-save', key, json),
  flushSave: (key, json) => ipcRenderer.sendSync('wendao:save-flush', key, json),
  reportAchievement: (id) => ipcRenderer.send('wendao:ach-report', id),
});
