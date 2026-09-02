﻿# #12 · 打包分发 + Steam 上架预备

**Blockers**: #10, #11
**User stories**: US-1 US-25

## 范围
- 一键构建链：`npm run dist` = 构建 engine/content/editor 产物 + Electron 打包（NSIS 安装包 + portable）
- Steam depot 预备：按 Steamworks 文档整理 depot 目录结构、build 配置、成就/AppID 配置位
- `/wizard` 生成交互脚本：Steamworks 账号办理、AppID 创建、成就配置、首次上传的每一步人工操作
- 版本策略：游戏内显示版本号（content 包版本 + 引擎版本），存档带版本字段

## 验收
- [ ] 干净机器（无 Node 环境）双击安装包 → 完整可玩
- [ ] content 包版本变更 → 游戏内可见
- [ ] wizard 脚本可引导完成 Steamworks 侧配置（人工步骤清单）


