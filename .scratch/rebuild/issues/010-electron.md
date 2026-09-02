﻿# #10 · Electron 壳 + Steam（模拟模式）

**Blockers**: #5, #9
**User stories**: US-1 US-10 US-11 US-24

## 范围
- `packages/app-desktop`：Electron 主进程（窗口、关闭即保存、自动更新占位）
- steamworks.js 接入：**mock adapter 优先**（无 AppID 时成就本地记账/云存档指本地槽位），AppID 配置后无感切换真机
- SaveAdapter 新增：Steam Cloud（真机）/文件槽位（mock）
- 引擎事件流 → 成就上报管道（走 #9 的判定器）
- electron-builder 产出 Windows 双击安装包（NSIS）

## 验收
- [ ] `npm run build:desktop` → 产物双击安装、双击运行、自动保存关闭重开进度保留
- [ ] mock 模式：成就达成 → 本地记录；日志显示 adapter=mock
- [ ] 有 AppID 环境变量时：adapter=steam，成就上报调用真实接口（真机验证延后到账号就绪）


