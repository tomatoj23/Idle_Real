# 问道长生（SmallRpg）

放置修仙游戏 + 零内容感知的放置游戏引擎框架。npm workspaces + TypeScript + Vite 单仓多包：

| 包 | 说明 |
| --- | --- |
| `packages/engine` | 机制核心，不含任何题材内容 |
| `packages/content` | 内容协议层（schema / 校验器 / 题材包） |
| `packages/editor` | 内容编辑器（浏览器） |
| `packages/app-desktop` | 游戏壳（Electron 桌面端） |

## 环境要求

- Node.js **>= 22.12**（见根 `package.json` `engines`）
- npm（workspaces，仓库根统一安装）

## Quickstart

```bash
npm install        # 安装依赖；prepare 脚本自动配置 git 钩子（core.hooksPath .githooks）
npm run dev        # 启动桌面游戏（渲染端 dev server）
npm run test       # 全仓测试（vitest）
npm run check      # 全仓类型检查（含各包 tests/）
```

**换克隆 / 钩子失效时**：`npm install` 会自动重配钩子；也可手动 `npm run setup`（等价于 `git config core.hooksPath .githooks`）。钩子没配上，push 门禁（policy 断言 + check + test）就不会跑。

## 打包桌面版

```bash
npm run dist       # 全仓 build + electron-builder 出包（release/ 下）
```

## 验收红线

**CI 与钩子全绿 ≠ 验收通过。** `npm run test` 跑在 happy-dom 上，不校验真实浏览器行为（先例：原生方法未 bind 宿主，测试全绿但真机抛 Illegal invocation）。凡动引擎运行时、渲染或壳层，合并前必须在真实浏览器 / Electron 真机首跑冒烟。

## 其它常用入口

| 命令 | 用途 |
| --- | --- |
| `npm run dev:editor` | 内容编辑器 dev server |
| `npm run audit` | 依赖安全审计（显式走 npmjs 官方源，npmmirror 不支持 audit endpoint） |
| `npm run lint` | oxlint（观察期，命中不阻塞） |
| `npm run policy` | 工程红线断言脚本 |

## 文档

- `CONTEXT.md` — 领域词汇表、引擎-内容边界硬原则（改边界/schema 前必读）
- `docs/adr/` — 架构决策记录
- `AGENTS.md` — agent / 贡献者工程纪律（工具链校准、Git 钩子、红线清单）
