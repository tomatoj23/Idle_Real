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

## 工具链校准（防训练数据滞后，ADR-018）

- 动工具链/编译项/依赖用法前，先读 package.json 与 tsconfig 的**实际版本**，勿按训练数据旧知识建议（现役 TS 7 = Go 原生编译器：`baseUrl`、`moduleResolution: node10`、`import assert`、ts-node 均为硬错误或不存在）。
- 新增依赖先查维护状态与 GA 时长，停更线不进 package.json；对齐策略（事件驱动+巡检，反对随时对齐）见 `docs/adr/0018-toolchain-alignment-policy.md`。
- 查「最新版本」必须显式官方源 `npm view <pkg> … --registry=https://registry.npmjs.org`（本机默认 npmmirror 镜像，可能滞后）。
- JSON Schema 为 draft-07 子集：校验器只认 `#/definitions/`（勿按 2020-12 习惯用 `$defs`）；扩关键字先加 `packages/content/src/schema/keywords.ts` 矩阵行。

## Git 钩子（交付门禁）

- **钩子自愈**：根 `prepare` 脚本在 `npm install` 时自动 `git config core.hooksPath .githooks`（`npm run setup` 是同一条命令的显式入口，手动跑一次也可）。core.hooksPath 属本地 git 配置、不入库，此前换克隆须重跑——现由 install 兜住。
- **pre-push = 全量 check + test**（vitest 默认池，#72 已证伪旧 vmThreads 硬约束）；push 被钩子拦下时**修复后再推，禁 `--no-verify` 绕过**。
- **CI（`.github/workflows/ci.yml`）= 第二环境回归网**：windows-latest 跑与钩子相同的 check + test，另挂 oxlint 观察步。它不拦钩子的绕过，价值在钩子覆盖不到的三处：`--no-verify`、未跑过 install 的新克隆、多会话并行下 main 的跨机漂移。
- **CI 绿不等于验收**：最硬的一关仍是真实浏览器首跑（见工程红线），CI 与钩子都覆盖不到。
- **lint 处于观察期**：`npm run lint`（oxlint correctness 最小集）当前零命中，尚未串进 check/pre-push；格式化（prettier 类）已裁为缓做，理由见 #78 票评。
