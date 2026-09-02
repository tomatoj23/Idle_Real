# 001 · workspace 脚手架 + TS 环境

**Blockers**: 无
**User stories**: #21 #23 #24 #25

## 范围
- npm workspaces monorepo：`packages/engine`、`packages/content`、`packages/editor`、`packages/app-desktop`
- TypeScript + vite（editor/desktop 前端）+ vitest（engine 测试）；tsconfig 分包引用
- engine 包最小 API 骨架：`createGame({ content, save?, clock? })` → `{ tick(dt), dispatch(action), events, snapshot }`（本票只立类型与空实现）
- content 包：`validateContent(json, schema)` 校验器骨架 + 首个 schema（skills 最小样例）
- 根 `package.json` 脚本：`npm run dev / test / build`（全部项目内依赖，零全局）

## 验收（engine 接缝）
- [ ] `npm test` 通过：createGame 注入最小 content + 假时钟，tick 后事件流产出一条 tick 事件
- [ ] `validateContent` 对合法样例通过、对缺字段样例报字段级错误
- [ ] 未全局安装任何包；`node_modules` 全部位于项目内
