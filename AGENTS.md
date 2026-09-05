# SmallRpg（《问道长生》）

放置游戏引擎框架 + 游戏《问道长生》（双端路线：桌面 Electron / 移动 Capacitor），工程为 npm workspaces + TypeScript + vite：`packages/engine`（零内容感知的机制核心）、`packages/content`（content 协议层：schema/类型/校验器在 `src/schema/`；题材包在 `src/packs/`，修仙包见 `packages/content/src/packs/xiuxian.json`，框架不含缺省题材包——壳层显式装配，ADR-017）、`packages/editor`（内容编辑器）、`packages/app-desktop`（游戏壳）。旧版 `js/`、`index.html` 仅作设计参考，不再维护（ADR-003/008）。

## Agent skills

### Issue tracker

GitHub Issues，用 `gh` CLI 读写。远端：`tomatoj23/Idle_Real`（main）。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五标签：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

single-context 布局：根目录 `CONTEXT.md` + `docs/adr/`（按需懒创建，不存在时静默跳过）。见 `docs/agents/domain.md`。
`CONTEXT.md` 开头的**硬原则不可违反**；改动引擎-内容边界、schema 形态或引入新内容类型前，必读 `CONTEXT.md` 全文（硬原则+词汇表+边界示例+ADR 简表）。

## 工程红线（engine/跨端编码纪律）

- engine 源码禁引用平台全局名（localStorage/document/window/setInterval 等），环境能力走 globalThis 运行时探测（先例 `save.ts` 的 `platformOf()`），缺失时降级，勿为省事给 engine 加 DOM/node lib。
- 凡从 globalThis/window 解构原生方法（定时器/storage/console 等），必须 bind 宿主再存函数值，否则真机抛 Illegal invocation；happy-dom 不校验 this，测试全绿完全遮蔽（e93727e 教训）。
- 真实浏览器首跑是必要验收步骤，UI 冒烟（vitest+happy-dom）不能替代。
