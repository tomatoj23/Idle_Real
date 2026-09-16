# 版本漂移影响评估：AI 训练数据滞后 vs 本仓库工具链/文档现实

> 日期：2026-09-16 · 调研方式：仓库全量只读盘点（脚本批量扫描 + 关键文件人工复核）+ npm registry / 官方 release notes / 官方文档一手核实；所有版本数字均来自当日 `npm view` 命令输出、npm registry 元数据或官方页面，未凭记忆断言
> 状态：**调研留档，决策权在用户**。本报告不含任何仓库文件改动（仅新增本文件）；调研时仓库有在途未提交工作（journal 功能改造），全程只读未触碰。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 本仓库受「AI 训练数据版本滞后」影响的总体形态 | **方向与直觉相反**：多数工具不是"仓库落后于 AI 知识"，而是"AI 知识落后于仓库"——TypeScript 7.0.2 正好打在 npm latest（2026-07 GA 的 Go 原生编译器，绝大多数训练数据停留在 TS 5.x 世界），Vite 8 已是 Rolldown 内核（替代 esbuild+Rollup） |
| 风险点计数 | **高 1 / 中 6 / 低 3**（详见第 2 章）。唯一高风险：TS 7 原生编译器的知识代差（影响日常编码与配置决策） |
| 代码现状是否已"中招" | **没有**。现有代码与配置全部合法且保守：无已移除语法、ES 特性使用面远低于运行时矩阵底线、Electron API 面与 39–44 破坏性变更清单零交集、schema 关键字全部落在手写校验器支持集内。风险全部集中在**未来编辑/升级动作**上 |
| 文档是否有陈旧版本论断需修 | **基本没有**。AGENTS.md / CONTEXT.md / ADR / docs/agents / docs/audit 均未钉工具链版本号；代码注释里的版本性论断（preload 须 CJS、steamworks.js 0.4.0 接口形状、structuredClone lib 约束）逐条核实为**准确** |
| 对齐必要性 | 分层：(a) TypeScript / electron-builder / steamworks.js / fflate **已最新，零动作**；(b) Vite（差 1 个 minor）/ happy-dom（落后 2 个大版本、18.x 已停更 15 个月）**小步可对齐**；(c) Electron 38（落后 6 个大版本、已滑出官方支持窗口）**是唯一有安全补丁含义的实质决策**；(d) Vitest 5.0 GA 仅 13 天，**暂缓升级反而是对的**（新版训练数据覆盖同样差） |
| 一个反直觉要点 | 「升级到最新 = AI 知识覆盖更好」不总成立：Vitest 5.0.0（2026-09-03）比仓库在用的 4.1.11 更新鲜，AI 对它的认知覆盖≈0；而 Vite 8.0 GA 已半年、happy-dom 20 GA 已近一年，属"覆盖良好区" |

---

## 1. A 章：版本清单与运行时矩阵（事实盘点）

### 1.1 依赖版本全景

声明值来自 `package.json`（根 + 四包），锁定值来自 `package-lock.json`（lockfileVersion 3），最新值来自 2026-09-16 `npm view <pkg> version` / `dist-tags`。

| 包 | 声明 | 锁定安装 | 最新（latest） | 差距与时间线 |
|---|---|---|---|---|
| typescript | `^7.0.2`（根+全四包） | 7.0.2 | **7.0.2** | **零差距**。TS 7.0 GA = 2026-07-08（[官方发布公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)）；7.1-dev 每日构建中（dist-tag `next: 7.1.0-dev.20260916.1`） |
| vitest | `^4.1.11` | 4.1.11 | **5.0.1** | 落后 1 个大版本。V5 GA = 5.0.0 发布于 2026-09-03（仅 13 天）；V4 仍在维护：dist-tag `V4: 4.1.11`，4.x 末版发布于 2026-08-18（npm time 元数据） |
| vite | `^8.2.2`（editor/app-desktop） | 8.2.2 | **8.3.0** | 同大版本差 1 个 minor。8.0.0 GA = 2026-03-12；8.3.0 = 2026-09-10（npm time 元数据） |
| happy-dom | `^18.0.1`（editor/app-desktop） | 18.0.1 | **20.14.5** | 落后 2 个大版本。18.0.1 是 18.x 末版（2025-06-10 后停更）；19.0.0 = 2025-09-28；20.0.0 = 2025-10-09；20.x 活跃（20.14.5 = 2026-09-12）（npm time 元数据） |
| electron | `38.8.6`（精确 pin，app-desktop） | 38.8.6 | **44.4.1** | **落后 6 个大版本**。38.0.0 = 2025-09-02，38.8.6 = 2026-03-11（38.x 末版后停更）；44.0.0 = 2026-08-25，44.4.1 = 2026-09-16（npm time 元数据） |
| electron-builder | `^26.0.12`（app-desktop） | 26.15.3 | **26.15.3** | 零差距 |
| @types/node | `^24.3.0`（app-desktop） | 24.13.3（包内嵌套槽位） | dist-tag latest = **22.20.3** | 见 §2.9：@types/node 的 `latest` tag 跟随 Node 22 LTS 线而非最新 Node，24.x 系列持续在发（24.13.3 已装）；lockfile 同时存在根槽位 20.19.43 与 electron 内嵌 22.20.1 |
| steamworks.js | `^0.4.0`（optionalDependencies） | 0.4.0 | **0.4.0** | 零差距 |
| fflate | `^0.8.2`（editor） | 0.8.3 | **0.8.3** | 零差距 |
| @capacitor/* | **未安装**（移动端为规划路线，ADR-001） | — | 8.5.2（core/cli） | 无对齐问题；Capacitor 8 CLI 要求 `node >=22.0.0`（`npm view @capacitor/cli@8.5.2 engines`） |
| @vitest/*（expect/runner/utils/snapshot/mocker） | 传递依赖 | 4.1.11 | 随 vitest | V5 中 `@vitest/expect` 被捆绑、`@vitest/runner` 弃用（[Vitest 5 迁移指南](https://vitest.dev/guide/migration.html)） |

**缺失项**：所有 package.json 均无 `engines` 字段、无 `packageManager` 字段——Node 版本约束没有机器化表达（§2.10）。

### 1.2 TypeScript 编译配置

`tsconfig.base.json:3-17`：`target: ES2022`、`module: ESNext`、`moduleResolution: bundler`、`lib: [ES2022]`、`strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`noFallthroughCasesInSwitch`、`forceConsistentCasingInFileNames`、`esModuleInterop`、`skipLibCheck`、`isolatedModules`、`verbatimModuleSyntax`、`resolveJsonModule`。**无** `exactOptionalPropertyTypes`、无 `baseUrl`/`paths`、无装饰器。

各包覆盖（`packages/*/tsconfig*.json`）：

| 包 | 增量 | 效果 |
|---|---|---|
| engine / content | `composite` 构建，lib 仅 `ES2022`（**无 DOM/node 类型库**） | 引擎红线（零平台全局依赖）由类型库层面强制 |
| editor / app-desktop(渲染) | `noEmit`，lib `ES2022 + DOM + DOM.Iterable`，types `vite/client` | |
| app-desktop(主进程) | `tsconfig.electron.json`：types `["node"]`，outDir `dist-electron` | node 类型解析到 `packages/app-desktop/node_modules/@types/node`（24.13.3） |

### 1.3 运行时矩阵（代码真实执行的环境）

| 环境 | 版本 | 来源 | 语言特性底线（判断 ES 特性可用性的基础） |
|---|---|---|---|
| 开发机 Node（跑 tsc / vite / vitest / electron-builder / 钩子） | **v24.13.0**（本地 `node --version`） | 本机 | Active LTS「Krypton」（LTS 2025-10-28，2026-10-20 转维护，EOL 2028-04-30；[nodejs/Release schedule.json](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)）；ES2024 特性基本齐备 |
| Electron 主进程 | **Node 22.22.0** | [Electron 官方 releases.json](https://releases.electronjs.org/releases.json) 中 38.8.6 条目 | Node 22 线：ES2022 全量 + Object.groupBy / Promise.withResolvers / Array.fromAsync 等 ES2024 特性已落（Node 21–22 期间进入） |
| Electron 渲染进程 | **Chromium 140.0.7339.249** | 同上 | 2025-09 时代的 Chromium：ES2024+ 全量可用 |
| （对照）若升 Electron 44 | Node 24.21.0 + Chromium 152.0.7977.78 | 同上（44.4.1 条目） | 更高，仅作升级对照 |
| 测试环境 | vitest 4.1.11 + happy-dom 18.0.1，宿主 = 开发机 Node 24 | package.json + lockfile | JS 全量；**DOM 是 happy-dom 的不完整模拟**（与真实 Chromium 行为有已知差距，见 §2.5） |
| Capacitor 移动端（未来路线） | Android System WebView（随系统自动更新的 Chromium）/ iOS WKWebView（随 iOS 版本） | ADR-001（CONTEXT.md） | 未定版；按实际启用时点的 WebView 基线评估，**现在不存在可检验的版本事实** |

矩阵要点：**最老的真实运行环境 = Electron 38 内嵌的 Node 22.22 / Chromium 140**（2025-09 世代），而非某个"旧浏览器"。编译目标 ES2022 意味着代码不经 downlevel 直接原生执行，语言特性可用性由矩阵底线决定。

### 1.4 JSON Schema

- 16 个 `packages/content/src/schema/*.schema.json` 全部声明 `"http://json-schema.org/draft-07/schema#"`（各文件第 2 行）。JSON Schema 官方最新正式版仍为 **2020-12**（[json-schema.org/specification](https://json-schema.org/specification)："The current version is 2020-12!"）。
- 校验器为手写子集实现（`packages/content/src/schema/validate.ts:18-44` 的 `JsonSchema` 接口 + `keywords.ts` 的关键词支持矩阵），支持：type / required / properties / items / additionalProperties / patternProperties / enum / 数值与字符串边界 / pattern / minProperties / `$ref`（仅 `#/definitions/`）/ oneOf（含判别式分流）。
- 脚本统计全部 schema 文件实际使用的关键字：description×522、type×398、$ref×375、additionalProperties×112、properties×101、minimum×87、required×84、pattern×66、items×53、minLength×52、maxLength×45、minItems×32、exclusiveMinimum×32、title×26、minProperties×20、maximum×20、definitions×13、patternProperties×12、enum×9、exclusiveMaximum×2、oneOf×1——**全部落在校验器支持集内**，未使用 const / if-then-else / allOf / anyOf / format / `$defs` 等。

---

## 2. B 章：版本差异风险点（逐条评级）

> 评级口径：**高** = 若按训练数据的旧版知识去改，会改错代码或误判行为；**中** = 会写出误导性文档或次优修改；**低** = 表面性差异、无实际后果。
> 扫描方法见附录。每条给出位置、证据、评级。

### 2.1【高】TypeScript 7.0 原生编译器：语言层知识代差

- **位置**：`package.json:23`（`typescript: ^7.0.2`，根+全四包同版本）；`tsconfig.base.json`（全部编译项）；影响所有 137 个 `.ts` 文件的未来编辑。
- **事实**：仓库在 TS 7.0.2 = npm latest，即 2026-07-08 GA 的 **Go 原生重写编译器**（[Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)：8–12× 构建提速；无 JS 版 compiler API，API 预计 7.1；TS 6.0 已先行发布、经 `@typescript/typescript6` 包并行提供）。据官方发布说明，TS 7 相对 TS 5.x 时代知识的关键差异：
  - **编译项硬移除**：`target: es5`、`downlevelIteration`、`baseUrl`、`moduleResolution: "node"/"node10"/"classic"`、`module: amd/umd/systemjs/none` 全部成为硬错误；
  - **默认值翻转**：`strict: true`、`module: esnext`、`types: []`（不再自动纳入所有 `@types/*`）、`rootDir: "./"`、`noUncheckedSideEffectImports: true`；
  - **import attributes**：`assert { ... }` 语法已废，改 `with { ... }`；
  - **模板字面量类型**按 Unicode 码位处理（不再按 UTF-16 代理对拆分）；
  - **无编译器 API**：依赖 `ts` JS API 的工具链（ts-node、ts-loader、旧 typescript-eslint 集成方式）在 TS 7 下不存在。
- **漂移后果推演**（AI 按 TS 5.x 知识操作时）：给 tsconfig 加 `baseUrl`+`paths` 或把 resolution 改回 `"node"` → 编译硬错误；写 `import ... assert` → 语法错误；建议"装 ts-node 跑脚本"或"写个用 ts API 的 codemod" → 方案不可行；给某包新增依赖后以为 `@types/*` 会自动全局可见 → 在 TS 7 默认 `types: []` 下不会（对本仓库 engine 反而是红线增益）。
- **缓解现状**：`tsconfig.base.json` 已显式钉住全部关键编译项（与 TS 7 兼容，`bundler`/`ESNext`/`ES2022` 均为 TS 7 保留项）；`satisfies`（editor/src/llm/pipeline.ts:128）、`verbatimModuleSyntax` 等语法均为 TS 5.x 已稳定且 TS 7 保留的特性，**现有代码零违规**。
- **评级：高**——影响面是所有未来 TS 编码/配置决策，且错误形态包含"静默误判"（默认值翻转类）而非全部当场报错。

### 2.2【中】Vite 8 = Rolldown 内核：构建链知识代差（当前暴露面为零）

- **位置**：`packages/editor/vite.config.ts:1-5`、`packages/app-desktop/vite.config.ts`（各仅 `base: './'`，零插件零选项）。
- **事实**：Vite 8.0（2025-12-03 beta 宣布、2026-03-12 GA）以 **Rolldown**（Rust）全面替代 esbuild+Rollup 双管线，配置 API 与插件钩子保持不变，但"依赖特定 Rollup/esbuild 选项的配置可能需要调整"（[Announcing Vite 8 Beta](https://vite.dev/blog/announcing-vite8-beta)）。要求 Node `^20.19.0 || >=22.12.0`（`npm view vite@8.2.2 engines`）。
- **漂移后果推演**：AI 按 Vite 5/6 知识添加 `build.rollupOptions` 深度配置、esbuild 专属选项、或推荐 Rollup 生态插件时，可能次优或失效。**但当前两份配置各 5 行、无任何敏感面**（docs/audit/2026-09-03-round3-addendum.md:112 亦复核过"无插件/别名/内联常量"），风险纯属未来触发型。
- **评级：中**（知识层高危、现状零暴露，按"实际后果"降为中）。

### 2.3【中】Electron 38 已滑出官方支持窗口；39–44 破坏性变更带

- **位置**：`packages/app-desktop/package.json`（`electron: 38.8.6` 精确 pin）；`packages/app-desktop/electron/main.ts` / `preload.cjs` / `platform.ts`（全部 Electron API 使用面）。
- **事实**：
  - Electron 官方仅支持**最新 3 个大版本**；当前为 44/43/42，38.x 已出窗（38.x 末版 38.8.6 停在 2026-03-11；[releases.json](https://releases.electronjs.org/releases.json) + [官方破坏性变更页](https://www.electronjs.org/docs/latest/breaking-changes)）。
  - 逐项对照 39–44 破坏性变更清单与本仓库 API 面（`app` / `BrowserWindow` / `ipcMain` / `contextBridge` / `ipcRenderer.sendSync` / `setWindowOpenHandler` / `will-navigate` / `requestSingleInstanceLock` / `sandbox: true` + CJS preload）：**零直接命中**。44 的 renderer clipboard 移除（本仓库不用 clipboard）、43 的 dialog 默认目录/offscreen 渲染、42 的 macOS 通知签名要求/clearStorageData quotas、41 的 PDF/cookie、39 的 window.open resizable（本仓库 `setWindowOpenHandler` 直接 deny，`main.ts:119`）——均不触及。
  - 两条**非 API 的行为变化**需要留意：42 起 npm postinstall 不再下载二进制（改为首跑下载，影响安装/CI 流程假设）；44 起移除 Windows ia32 与 Linux armv7l 产物（本仓库只发 win x64 NSIS/portable，`electron-builder.yml` 不受影响）。
  - `preload.cjs:2-3` 注释「沙箱模式下 Electron preload 须为 CJS（ESM preload 需关沙箱）」与官方文档一致（[ESM 教程](https://www.electronjs.org/docs/latest/tutorial/esm)："Sandboxed preload scripts can't use ESM imports"；[沙箱教程](https://www.electronjs.org/docs/latest/tutorial/sandbox)：沙箱内 require 是受限 polyfill）。**注释准确，非陈旧论断。**
- **评级：中**——不是 API 误用风险，而是：安全补丁断供（内嵌 Chromium 140 停在 2025-09 世代）+ 未来升级时安装行为变化需重验打包流程。

### 2.4【中】Vitest 4→5 迁移钉：`--pool=vmThreads` 门禁注释 + mock 语义翻转

- **位置**：`.githooks/pre-push:5-6`（注释钉死「test 必须透传 `--pool=vmThreads`：threads/forks pool 复现 worker 状态注入损坏……必挂」）；48 个 `@vitest-environment happy-dom` 测试文件；`packages/app-desktop/tests/projection-shell.test.ts`（全仓库唯一 `vi.mock` 使用点）。
- **事实**（[Vitest 5 迁移指南](https://vitest.dev/guide/migration.html)）：V5 要求 Node `^22.12.0 || ^24.0.0 || >=26.0.0`（V4 为 `^20.0.0 || ^22.0.0 || >=24.0.0`；`npm view vitest engines`）；`clearMocks` 默认翻转为 `true`；`vi.mock` 必须顶层；`toThrow("")` 语义变化；JSON/JUnit reporter 默认写文件；移除一批子入口（`vitest/mocker` 等，lockfile 中仓库恰装有 `@vitest/mocker` 4.1.11）。
- **漂移后果推演**：① 升级 V5 时 `--pool=vmThreads` 这个钉在 V4 行为上的交付门禁必须重验（注释描述的"必挂"是否仍成立未验证）；② AI 按 V5 知识解读本仓库 V4 测试的 mock 行为（如以为 `clearMocks` 默认清历史）会误判测试语义——影响面小（全仓仅 1 处 `vi.mock`、无快照测试、未显式配置 `clearMocks`）。
- **评级：中**（升级触发型 + 语义误判面窄但存在）。

### 2.5【中→低】happy-dom 18 停更：测试保真度与 workaround 注释陈旧化

- **位置**：`packages/editor/package.json:18`、`packages/app-desktop/package.json:30`（`^18.0.1`）；4 处针对性 workaround 注释——`packages/engine/src/save.ts:65-67`（happy-dom 不校验 this → Illegal invocation 教训，AGENTS.md 红线出处 e93727e）、`packages/app-desktop/tests/bag-gear.test.ts:184`（rAF 去抖不即时）、`packages/app-desktop/tests/boss-fight.test.ts:158`（无 rAF）、`packages/editor/tests/state.test.ts:115`（confirm 非自有属性）。
- **事实**：18.0.1 是 18.x 末版（2025-06-10 后无 patch），19.0.0 = 2025-09-28、20.0.0 = 2025-10-09，20.x 活跃（20.14.5 = 2026-09-12）。19/20 的逐版本破坏性变更**未验证**（GitHub releases 仅翻到 20.12.x–20.14.x 页，可见条目均为 feature/patch、无 breaking 标注；更早页未逐页核对）。
- **漂移后果推演**：happy-dom 缺陷一旦在新版修复，上述 workaround 注释与手动触发代码会变成"过时但不致错"；反之测试环境 DOM 保真度差距是仓库已知且已被注释钉住的系统性盲区（AGENTS.md：「真实浏览器首跑是必要验收步骤」）。生产产物零影响（happy-dom 是测试专用依赖）。
- **评级：低**（有注释防线 + 测试环境专属），但因"依赖已停更 15 个月"在 A 章列为对齐候选，综合记 **中→低**。

### 2.6【中】JSON Schema draft-07 + 手写子集校验器：关键字扩展的静默失效面

- **位置**：`packages/content/src/schema/*.schema.json`（16 文件，全部 draft-07）；`packages/content/src/schema/validate.ts:17-44`；`packages/content/src/schema/keywords.ts:1-13`（关键词支持矩阵单点声明：「新增关键词 = 加一行（缺列由 KeywordRow 类型强制，编译器接管『三处同步』）」）。
- **事实**：draft-07 非最新（2020-12 才是，官方仍标注 current），但**版本本身不构成漂移**——真正敏感点在于：校验器是**子集实现**，任何新加进 schema 文件而校验器不消费的关键字（如 `const`、`if/then/else`、`format`、`$defs`）都会**静默不校验**。schema 文件用 `definitions`（draft-07 拼法）与校验器 `resolveRef` 只认 `#/definitions/`（`validate.ts:119`）一致——若 AI 按 2020-12 知识改用 `$defs`，引用会静默解析失败。
- **缓解现状**：A.4 统计证明现有 21 种关键字用法全部在支持集内；keywords.ts 头注释已把扩展纪律钉死。**评级：中**（按新 draft 知识动 schema 的静默失效是真实陷阱，但有矩阵+协议守卫测试两道既有防线）。

### 2.7【低】ES 运行时特性使用面：远低于矩阵底线，lib 配置保护有效

- **证据**（全仓扫描，含 engine）：实际使用的新特性 = 可选链 `?.`（603 处）/空值合并 `??`（452 处，ES2020）、`replaceAll`（`packages/engine/src/combat.ts:180,331-341`，ES2021）、`.at(-1)`（仅 9 处测试文件，ES2022）、`structuredClone`（仅 `packages/content/tests/fixtures.ts:103` 与 `packages/editor/src/core/state.ts:89`；`packages/engine/src/state.ts:848` 注释明言刻意避开：「避免依赖 structuredClone 的 lib 约束」——与 engine 的 `lib: [ES2022]` 无 DOM/node 类型一致，**注释准确**）。**零使用**：Object.groupBy / Map.groupBy / Promise.withResolvers / Array.fromAsync / 顶层 await / 正则 v、d 标志 / 新 Intl API / Object.hasOwn / toSorted 家族 / File System Access API。
- **对照矩阵**：使用面（≤ES2022）低于最老环境 Node 22.22 / Chromium 140 的支持线整整两个ES 年代以上。即便 AI 未来"手滑"写入 ES2023+ 特性，`lib: [ES2022]` 的类型层会先行报错拦截（除非同时改 lib——那是有意识的决策）。
- **评级：低**（现状健康；engine 的 globalThis 探测红线在 `save.ts` 与 `desktop.ts:30` 两处执行到位）。

### 2.8【低】Electron 主进程 Node API 使用面

- **位置**：`packages/app-desktop/electron/main.ts:11-13`、`platform.ts:18-20`。
- **证据**：仅用 `node:fs`（同步 API + `statSync(…, { throwIfNoEntry: false })`，Node 14.17+）、`node:path`、`node:url`（`fileURLToPath`）、`node:module`（`createRequire`）。全部为 Node 22 世代的稳定 API，且 `node:` 协议前缀写法本身是现代惯例。`steamworks.js` 0.4.0 接口形状注释（`platform.ts:26`、`platform.ts:188-190`：「init → Omit<Client,…>，achievement/cloud 挂 init() 返回值」）与安装的 `node_modules/steamworks.js/index.d.ts:1`（`export function init(appId?: number): Omit<Client, "init" | "runCallbacks">;`）逐字吻合，**非陈旧论断**。
- **评级：低**。

### 2.9【低】@types/node 三版本共存 + dist-tag 误导面

- **位置**：`package-lock.json`（根槽位 20.19.43 / `electron/node_modules` 22.20.1 / `packages/app-desktop/node_modules` 24.13.3）；`packages/app-desktop/package.json`（声明 `^24.3.0`）。
- **事实**：npm workspaces 遮蔽机制导致三版本并存是正常解析结果（electron 自身依赖 22.x、另一依赖拖入 20.x 到根槽位）；app-desktop 的 electron tsconfig `types: ["node"]` 解析到包内嵌套的 24.13.3。另注意 `npm view @types/node dist-tags` 的 `latest` = 22.20.3（**跟随 Node 22 LTS 线**，不代表 24.x 不存在）——AI 若把 "latest" 误读为"Node 24 类型不存在/不维护"会误判。
- **评级：低**（无实际错误，但易产生误判性对话）。

### 2.10【低】文档陈旧论断核查结果（含缺失项）

对钉了版本号或描述工具链行为的文档逐处核实：

| 文档 | 论断 | 核查结果 |
|---|---|---|
| AGENTS.md | 「vitest+happy-dom」「真实浏览器首跑是必要验收步骤」「e93727e 教训」 | 与仓库现实一致，无版本号钉死，**无须修** |
| CONTEXT.md / docs/adr/0017 | 工具链选型（Electron/Capacitor/TS+vite+workspace） | 无具体版本号，**无可陈旧内容** |
| docs/agents/*.md | （content.md 等） | 全部为游戏数值与流程约定，无工具链版本论断 |
| docs/audit/*.md | 「五份 package.json」「tsc -b / tsc --noEmit && vite build」「vite 配置各 5 行」 | 与现状一致（本轮复核），**无须修** |
| packages/app-desktop/electron/preload.cjs:2-3 | 沙箱 preload 须 CJS | 与官方 ESM/沙箱文档一致（§2.3），**准确** |
| packages/engine/src/state.ts:848、save.ts:65-67 | structuredClone lib 约束、happy-dom 不校验 this | 与 lib 配置/已知行为一致，**准确** |
| packages/app-desktop/electron/platform.ts:26 | steamworks.js 0.4.0 接口形状 | 与安装包 index.d.ts 逐字吻合，**准确** |
| docs/research/godot-idle-feasibility.md | 钉了 Godot 4.7.2 等外部版本 | **外部事实、带日期的调研留档**（2026-09-03），属留档性质非"现行文档"，按 docs/research 惯例不回改；是否仍为最新未验证（超出本仓库工具链范围） |

**缺失项**（非"论断陈旧"而是"约束缺位"）：无 `engines`/`packageManager` 字段（§1.1）——Node 版本底线目前只存在于人的记忆里。

---

## 3. C 章：对齐必要性分析（决策材料，决策权留给用户）

> 逐工具给出：当前 vs 最新（2026-09-16，npm registry）→ 破坏性变更（官方来源）→ 升级工作量与风险 → 不升级的后果（含"新版训练数据覆盖"维度）。分两类对齐：**(a) 工具链升级；(b) 文档修正**。

### 3.1 逐工具对齐材料

| 工具 | 当前 → 最新 | 破坏性变更要点（来源） | 工作量 / 风险 | 不升级后果 |
|---|---|---|---|---|
| **TypeScript** | 7.0.2 → 7.0.2 | 无（已最新） | 零 | 无。7.1（含新 compiler API）发布后再评估 |
| **Vite** | 8.2.2 → 8.3.0 | 无（minor，engines 不变） | 分钟级，`^8.2.2` 范围内自然吸收 | 无实质后果；8.3.0 发布仅 6 天，反而不急 |
| **electron-builder** | 26.15.3 → 26.15.3 | 无 | 零 | 无 |
| **steamworks.js / fflate** | 0.4.0 / 0.8.3 → 同 | 无 | 零 | 无 |
| **happy-dom** | 18.0.1（停更 15 个月）→ 20.14.5 | 19/20 逐版本 breaking 未验证（GitHub releases 只核对到 20.12+，可见条目无 breaking 标注） | 小时级：升版跑全量 67 个测试；风险 = 4 处 workaround 注释过时 + DOM 保真度变化导致的测试红绿翻转需人工判语义 | 测试环境 DOM 模拟停在 2025-06 保真度；依赖断供安全更新（测试专用，无生产面）；happy-dom 20 GA 已近一年，训练数据覆盖好 |
| **Vitest** | 4.1.11（V4 tag 仍在维护，末版 2026-08-18）→ 5.0.1（GA 仅 13 天） | [迁移指南](https://vitest.dev/guide/migration.html)：clearMocks 默认 true、Node ≥22.12、vi.mock 顶层强制、reporter 默认写文件、子入口移除等 | 半天内：升版 + 全量测试 + **重验 `.githooks/pre-push` 的 `--pool=vmThreads` 钉**（§2.4）；风险低（vi.mock 仅 1 处、无快照）但门禁注释必须同步改 | 短期无（V4 在维护）；**建议至少等 V5 稳定 2-3 个月再动**——V5 GA 才 13 天，AI 训练数据对它的覆盖≈0，现在升反而制造新的知识漂移 |
| **Electron** | 38.8.6（出支持窗口）→ 44.4.1 | [官方 39–44 清单](https://www.electronjs.org/docs/latest/breaking-changes)：本仓库 API 面零命中；非 API 变化 = 42 起安装期二进制下载方式改变（CI/打包流程需重验）、44 移除 ia32/armv7l（本仓库 win x64 不受影响） | 1-2 天：升版 + 真机首跑回归（AGENTS.md 红线）+ electron-builder 产物验证 + steamworks.js 原生模块 asar unpack 回归（26.15.3 与 Electron 44 的兼容矩阵**未验证**，需实跑） | **唯一有安全补丁含义的落后**：内嵌 Chromium 140（2025-09 世代）停收安全修复；跨度越拖越大（明年再升就是 38→48+）；Electron 44 GA 已 3 周、训练数据开始覆盖 44 线 |
| **@capacitor/***（未来路线） | 未安装 → 8.5.2 | 无对齐问题；启用时直接用最新即可 | — | — |
| **开发机 Node** | v24.13.0（Active LTS）→ 无需动 | 2026-10-20 转维护后可考虑 26 LTS（2026-10-28 LTS 化） | 零 | 无 |
| **JSON Schema** | draft-07 →（2020-12 仍为最新） | 迁移 = `definitions`→`$defs` 等纯 churn；校验器是自写子集，不依赖 draft 版本深水语义 | 建议不动；若未来框架对外发布，在协议文档里**声明"draft-07 子集 + 关键字支持矩阵见 keywords.ts"** | 无 |

**"新版训练数据覆盖"维度小结**：TS 7（已最新，覆盖问题反转为本仓库优势场景）、Electron 44（GA 3 周，覆盖开始建立）、Vite 8（GA 半年，覆盖好）、happy-dom 20（GA 近一年，覆盖好）、**Vitest 5（GA 13 天，覆盖差——等一等更优）**。

### 3.2 (b) 文档修正类对齐（与升级解耦，独立可做）

1. **新增一节"工具链版本事实表 + AI 知识校准提示"**（挂 AGENTS.md 或 CONTEXT.md）：钉死 TS 7 = 原生编译器（勿建议 baseUrl/ts-node/TS5 语法）、Vite 8 = Rolldown、Electron 38.8.6 = Node 22.22 + Chromium 140、JSON Schema = draft-07 **子集**（扩关键字先加 keywords.ts 矩阵行）、@types/node dist-tag latest≠最新 Node。这是对"训练数据滞后"性价比最高的单点防线（<1 小时，零代码风险）。
2. **给 package.json 补 `engines` 字段**（如 `"node": ">=22.12"`，对齐 vite/vitest 要求线）——把 §1.1 缺失项机器化。
3. `docs/research/` 既有文档均为带日期留档，按惯例不回改（godot 报告的 Godot 版本属外部事实留档）。

### 3.3 选项（带取舍，不做结论）

**选项一：只做文档修正（§3.2），工具链全部不动。**
- 取：零破坏风险、一小时级工作量、直接命中"AI 版本知识漂移"这一关切本体（写代码的 AI 每次都会读到校准提示）。
- 舍：Electron 安全补丁继续断供；happy-dom 停更依赖继续挂着；"文档说 38、现实终将更旧"的漂移会在 Electron 上重新累积。

**选项二：文档修正 + 小步升级（Vite 8.3 / happy-dom 20；Vitest 5 观望 2-3 个月；Electron 38 暂持）。**
- 取：把"落后但活跃且训练数据覆盖好"的工具拉平（happy-dom 20 GA 近一年最典型）；Electron 维持已验证的稳定 pin，不在 journal 在途工作收尾前叠加桌面壳变量；Vitest 5 等"AI 覆盖追上"再动，避免以旧知识迁入新大版本。
- 舍：Electron 支持窗口问题原样存在（每次发版仍内嵌 2025-09 的 Chromium）；两个月后 Vitest/Electron 各需一次决策，决策次数没减少只是延后。

**选项三：全面对齐（选项二 + Electron 44.4.1，Vitest 5 待其稳定后跟进）。**
- 取：安全补丁续供、运行时矩阵整体前移（Node 24.21 + Chromium 152）、未来一年内不再有大跨度升级；一次性吃掉 39–44 全部行为变化并真机回归。
- 舍：1-2 天工作量且含真机回归与打包产物验证（electron-builder 26.15.3 × Electron 44 兼容性未验证，steamworks.js 原生模块 asar unpack 需实跑）；Electron 42 起安装期下载行为变化可能波及打包流程；与在途 journal 工作叠加时，出问题定位面变大（建议等 journal 收口后再动）。

---

## 附录：调研方法

### 脚本与命令（全部只读；辅助脚本写于系统临时目录，未进仓库）

1. **版本盘点**：逐份读根/四包 `package.json`、全部 `tsconfig*.json`；`node -e` 解析 `package-lock.json` 提取锁定版本与嵌套槽位（`@types/node` 三槽位、`@vitest/*`）；本地 `node --version`（v24.13.0）/ `npm --version`（11.6.2）。
2. **联网核实**（npm registry，2026-09-16）：`npm view <pkg> version / dist-tags / engines / time --json` 覆盖 typescript、vitest、vite、happy-dom、electron、electron-builder、@types/node、steamworks.js、fflate、@capacitor/core、@capacitor/cli。
3. **联网核实**（官方一手来源）：Electron [releases.json](https://releases.electronjs.org/releases.json)（38.8.6/44.4.1 的内嵌 Chromium/Node）、[破坏性变更页 39–44](https://www.electronjs.org/docs/latest/breaking-changes)、[沙箱教程](https://www.electronjs.org/docs/latest/tutorial/sandbox)、[ESM 教程](https://www.electronjs.org/docs/latest/tutorial/esm)；Node.js [官方 release schedule.json](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)；[TS 7.0 发布公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)；[Vitest 5 迁移指南](https://vitest.dev/guide/migration.html)；[Vite 8 beta 公告](https://vite.dev/blog/announcing-vite8-beta)；[json-schema.org/specification](https://json-schema.org/specification)；happy-dom [GitHub releases](https://github.com/capricorn86/happy-dom/releases)。
4. **语法/特性批量扫描**（grep 全仓 137 个 .ts，排除 node_modules/dist）：`satisfies`/const 类型参数/`using`/装饰器/const enum/unique symbol（TS 敏感语法）；`?.`/`??`/`.at(`/`structuredClone`/`Object.groupBy`/`Promise.withResolvers`/`Array.fromAsync`/顶层 await/正则 v、d 标志/`replaceAll`/`Object.hasOwn`/toSorted 家族/Intl 新 API/`crypto.randomUUID`（ES 敏感特性）；import attributes（assert/with）；File System Access API；`node:` 协议导入；`globalThis` 使用点（7 文件）；schema 关键字频次统计（对 16 个 .schema.json 提取全部关键字并计数）。
5. **人工复核的关键文件**：`tsconfig.base.json` 及五份包级 tsconfig、`packages/engine/src/save.ts`（platformOf 先例）、`packages/engine/src/state.ts:848`（structuredClone 规避注释）、`packages/engine/src/combat.ts`（replaceAll 使用面）、`packages/content/src/schema/validate.ts` + `keywords.ts`（校验器支持集）、`packages/app-desktop/electron/main.ts`/`preload.cjs`/`platform.ts`/`updater.ts`（Electron API 面全量）、`packages/editor/src/io/files.ts`、`.githooks/pre-push`、`.gitignore`、`CONTEXT.md`、`docs/adr/0017`、`docs/agents/`、`docs/audit/`、`docs/research/` 既有两文、`node_modules/steamworks.js/index.d.ts`。
6. **git 状态确认**：`git log --oneline -3` + `git status --short`（确认在途 journal 工作：14 个已改文件 + 4 个未跟踪新文件），全程未执行任何写操作。

### 未验证项（如实声明）

- happy-dom 19.0.0–20.11 区间各版本的逐条破坏性变更（GitHub releases 未逐页翻全）。
- electron-builder 26.15.3 对 Electron 44 的官方兼容矩阵（未找到明确声明页，需实跑验证）。
- Vitest 5 下 `--pool=vmThreads` 行为（`.githooks/pre-push:5-6` 注释的"必挂"论断是否仍成立）——须实际升级后验证。
- docs/research/godot-idle-feasibility.md 中 Godot 4.7.2 是否仍为最新（外部事实、留档性质，超出本次范围）。
- Capacitor 8 在目标机型的 WebView 基线（移动端路线未启用，无可检验事实）。
