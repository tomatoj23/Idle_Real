# 参考源码快照库的价值评估与技术栈升级必要性裁决

> 日期：2026-09-29 · 调研方式：全程只读——`D:\My_Projects\Reference_Documents` 仅做 ls/grep/head 级盘点（**未改动其下任何文件**），版本现状以当日 `npm view … --registry=https://registry.npmjs.org` 官方源输出为唯一「最新版本」依据（本机默认 npmmirror 镜像，按二轮调研 §1.0 铁律显式换源），并复核本仓 node_modules 实装版本、`gh issue view` 只读查票、前身两份调研文档衔接；除本文件外零改动（未跑 npm install/update/audit fix，未动 package.json 与任何源码）
> 状态：**调研留档，决策权在用户**。所有「最新版本」数字均为 2026-09-29 当日 npm view 实跑输出（非 npm 生态的 cpython/pytest/pandoc 另注来源）；查询失败项在附录如实标注，无失败项。
> 说明：本调研回答两个被用户认定「有一些互斥」的问题——Q1 参考快照库有无帮助及如何实现、Q2 技术栈版本是否偏老有无必要升级；互斥/张力的专门分析见 §3.4，两问的合并裁决见 §4。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| Q1：13 个快照对本项目有无帮助？ | **有，但集中在 6 个库**：electron-main（高）、TypeScript-main（高）、vitest-main（高，专属 #68）、ajv-master（中）、node-main（中）、vite-main（中低）；pnpm/husky/react 系低或无；cpython/pytest/pandoc 与本工程（无 Python、无 React、无文档转换需求）**零交集**。全仓 grep 证明当前**没有任何在用用法**（`Reference_Documents` 零命中），全部为「可新增」 |
| Q1 如何实现？ | 三条纪律 + 四类场景：**纪律**=引用必标「快照名+快照内版本+取档日期」、快照/npm view/node_modules 三源三分工（上游在改什么 / 现在该用什么 / 我装的是什么）、升级票的「查 breaking-changes」步骤指向本地快照；**场景**=升级前瞻查证（#68 查 vitest-main 的 V5 迁移指南；Electron 45 转正前查 electron-main 的 breaking-changes 45.0 节）、行为争议溯源（#80 memory-eviction 分类查 electron-main shell/+chromium_src/）、schema 校验语义参照（ajv-master 对照手写校验器）、TS7 配置/类型行为裁定（TypeScript-main tsoptions+testdata） |
| Q2：技术栈「比较老」吗？ | **不老，方向仍与直觉相反**（与 2026-09-16 前身报告一致）：typescript 7.0.2 = npm latest、happy-dom 20.14.5 = latest、fflate/steamworks.js = latest；真正的「老」只有两处且都小——electron 44.4.1 落后**支持线内 4 个 patch**（44.4.5，2026-09-23）、vite 8.3.0 落后 1 个 patch（8.3.1，09-24）；vitest 4→5 是**主动观望**而非落后（#68 触发条件今日未到） |
| Q2：有必要升到最新吗？ | **分 case，不整包追**：Electron 跟 patch（安全驱动，44.4.5）；vite/electron-builder/@types/node 随下一次对齐票**捎带**（`npm update` 即可）；vitest 5 **继续暂缓**（GA 才 26 天，前身结论复核后仍成立）；TS/happy-dom/fflate/steamworks **零动作**。触发条件与巡检节奏见 §4 |
| 对用户假设「参考库都是最新」的校正 | **不成立，须三分**：①5 个快照是**超前于发布的开发线**（electron-main=46.0 开发线 vs npm 44.4.5；node-main=27.0.0-dev vs 发布线；TypeScript-main≈7.1-dev vs 7.0.2；pnpm-main=12.8.1 vs npm 12.6.0；cpython-main=3.16.0a0 vs Python 3.14.7）；②2 个快照取档早 3–6 个月（ajv 2026-04-24、husky 2026-03-20，只是「碰巧仍 latest」）；③其余（vite 8.3.1、vitest 5.0.2、react 19.3.0 等）与当日 npm latest 同步。「快照=最新」混淆了 **main 取档** 与 **npm 已发布 latest** 两个概念——这恰是 Q1/Q2 张力的根源（§3.4） |
| 两问的合并姿势 | **升级决策用 npm 数据定「何时/升到哪」，用快照定「升的时候会发生什么」**。快照的参考价值与是否升级正交（任何在用版本都能查源码），但若把快照 main 当升级目标会被未发布特性带偏（electron 46 已移除 safeStorage 同步 API、node 27 dev、TS 7.1 compiler API 形态未定） |
| 前身结论复核（2026-09-29） | 「升级到最新=AI 知识覆盖更好不总成立」**仍成立**（Vitest 5 GA 由 13 天→26 天，覆盖仍差）；「@types/node dist-tag latest=22.20.3 跟随 Node 22」**已过期**（今日 latest=26.6.3）——正好实证 ADR-018「时点数字不进 AGENTS.md、以调研文档为单一来源」的决策正确 |

---

## 1. 快照库事实盘点（Q1 的地基）

### 1.1 13 个快照的形态、版本与「latest 关系」

快照全部为各仓库 main/master 分支取档、无 `.git` 历史，**精确 commit 日期不可考**；下表「取档时点」以目录 mtime 为代理（外层目录 mtime 与内部抽样文件 mtime 一致，2026-09-29 实测 `stat`）。「npm latest」列为 2026-09-29 `npm view <pkg> version --registry=https://registry.npmjs.org` 实跑输出（标 † 者为非 npm 生态，来源另行注明）。

| 快照（路径 `D:\My_Projects\Reference_Documents\<dir>`） | 形态 | 快照内版本证据（文件） | 取档时点（mtime） | 对应包 npm latest（09-29） | 关系判定 |
|---|---|---|---|---|---|
| electron-main | C++/Node 源码+全套 docs | `package.json`=`0.0.0-development`；`docs/breaking-changes.md` 首节「Breaking API Changes **(46.0)**」 | 2026-09-29 12:51 | 44.4.5 | **超前**：46.0 开发线（45 仅 alpha-13，未发 stable） |
| TypeScript-main | Go 原生编译器（根 `go.work` 用 `./tools ./tsc`；`tsc/go.mod`=microsoft/TypeScript/tsc） | `package.json`=`0.0.0` | 2026-09-29 12:25 | 7.0.2 | **超前**：main≈7.1-dev（npm next=`7.1.0-dev.20260928.1`） |
| node-main | C++ 运行时+`doc/api` 全量文档 | `src/node_version.h`：MAJOR 27 / MINOR 0 / PATCH 0 / **IS_RELEASE 0** | 2026-09-29 12:38 | （npm `node` 包 latest=22.23.3，跟 LTS 22 线） | **超前**：27.0.0-dev 主干（发布线为 22/24/25/26） |
| vite-main | TS monorepo | `packages/vite/package.json`=`8.3.1` | 2026-09-29 12:24 | 8.3.1 | 同步（==latest） |
| vitest-main | TS monorepo | `packages/vitest/package.json`=`5.0.2` | 2026-09-28 22:07 | 5.0.2 | 同步（==latest） |
| vite-plugin-react-main | TS monorepo | plugin-react `6.1.1` / plugin-react-swc `4.3.3` | 2026-09-28 15:33 | 6.1.1 / 4.3.3 | 同步 |
| react-main | Flow/TS monorepo | `ReactVersions.js`：`ReactVersion='19.3.0'` | 2026-09-23 01:26 | 19.3.0 | 同步 |
| pnpm-main | **Rust 化** monorepo（Cargo.toml） | `package.json`=`12.8.1` | 2026-09-29 08:49 | 12.6.0 | **超前**：main 12.8.1 尚未发布 |
| ajv-master | TS | `package.json`=`8.20.0` | **2026-04-24** | 8.20.0 | 同步，但**取档早 5 个月**（「碰巧仍 latest」） |
| husky-main | JS | `package.json`=`9.1.7` | **2026-03-20** | 9.1.7 | 同步，但**取档早 6 个月**（同上） |
| pytest-main | Python | `pyproject.toml` version=dynamic（setuptools_scm）；`changelog/` 为未发布 towncrier 碎片 | 2026-09-28 | PyPI **9.1.1** †（WebFetch pypi.org/pypi/pytest/json，09-29） | 主干（介于发布之间） |
| cpython-main | C | `Include/patchlevel.h`：3.**16**.0、`PY_RELEASE_LEVEL_ALPHA` | 2026-09-29 03:18 | Python **3.14.7** stable（3.15 pre-release）†（WebFetch python.org/downloads，09-29） | **超前**：3.16.0a0 dev 主干 |
| pandoc-main | Haskell | `pandoc.cabal` `version: 3.12`；`changelog.md`「pandoc 3.12 (2026-09-27)」 | 2026-09-29 08:36 | 3.12 †（GitHub releases/latest，发布 2026-09-29） | 同步（==latest release） |

**三点形态结论**：①取档时点参差（2026-03 至 2026-09），不是一次批量动作；②npm 生态 8 个里 5 个与当日 latest 同步、2 个超前（pnpm/TS 线）——同步是「取档新+上游发版慢」的碰巧，不是机制保证（ajv/husky 就是反例：早 5–6 个月取档，只是恰好没人发新版）；③node/cpython/electron 三个是**未来开发主干**，天然不等于任何可安装版本。

### 1.2 逐库价值矩阵（结合本项目真实形态：无 React、npm workspaces、裸 .githooks、无 Python、vite 配置零插件）

评级口径：**高**=现役技术栈的权威查证源、能直接改变即将发生的工程决策；**中**=特定场景有价值；**低**=边缘/远期；**无**=与本工程零交集。

| # | 快照 | 评级 | 用处与「如何实现」 | 区分：已用 vs 可新增 |
|---|---|---|---|---|
| 1 | **electron-main** | **高** | (a) `docs/breaking-changes.md` 是 Electron 破坏性变更的**权威全文**且含未来节（46.0/45.0 在档）——Electron 升级/45 转正前的行动清单（例：46.0 移除 `safeStorage` 同步 API、`utilityProcess.kill()` 行为变化，均为现役 44 之后的事，作前瞻储备）；(b) `docs/tutorial/fuses.md` + `asar-integrity.md` = **#65 fuses 票**的配置语义参考（runAsNode/asarIntegrity 等键的真实行为）；(c) 行为争议溯源：`shell/` + `chromium_src/` + `patches/chromium/` 源码层查证——**#80 / ADR-018 落地记录遗留的 `memory-eviction` 分类问题**（「需 Chromium 内存回收源码确证」）在快照内有直接锚点：`docs/api/structures/render-process-gone-details.md`、`docs/api/app.md`、`shell/common/gin_converters/base_converter.h` 均含 `memory-eviction`（09-29 grep 实证）；(d) `docs/api/*.md` 离线 API 全集（sandbox/preload/contextBridge 语义，前身 §2.3 引证过的官方文档同源） | 全部**可新增** |
| 2 | **TypeScript-main** | **高** | AGENTS.md「TS 7 硬错误/默认值翻转」纪律的**源头级查证**：(a) `tsc/internal/tsoptions/commandlineoption.go` 等 = 编译项合法性最终依据（baseUrl/moduleResolution node10 是否移除、默认值取什么，不再凭训练记忆）；(b) `tsc/testdata/tests` + `baselines` = 类型系统行为裁定性测试（遇到类型行为分歧查 fixtures，不猜）；(c) `tsc/CHANGES.md` = Strada(JS) vs Corsa(Go) 行为差异清单。注意：main 是 7.1-dev 形态，答「现役 7.0.2 行为」时须意识到可能含 7.1 变更；TS 7 无 JS compiler API，**不能**从快照抄 ts API 用法 | 全部**可新增** |
| 3 | **vitest-main** | **高**（专属 #68） | (a) `docs/guide/migration/index.md` = **「Migrating to Vitest 5.0」官方迁移指南**（快照 5.0.2==npm latest，正是 #68 目标线）——含 V5 要求 Vite ≥6.4.0 + Node ≥22.12.0、`clearMocks` 默认翻转等；还发现一条前身调研未提的迁移点：**vite 不再是 vitest 直接依赖、改 required peer dependency**（npm workspaces 下需确认 hoisting 行为）；(b) `packages/vitest` 源码回答文档没写的问题——**#68 前置必做项「vmThreads pool 在 V5 是否仍必挂」**（`.githooks/pre-push` 门禁钉的重验）可先在快照 pool 实现里预研，实跑验证时对照 | 全部**可新增**（#68 动手时） |
| 4 | **ajv-master** | **中** | 手写 JSON Schema 校验器（`packages/content/src/schema/validate.ts` + `keywords.ts`）的**语义参照实现**：draft-07 关键词扩展时（keywords.ts 加行纪律）对照 `lib/compile/`（rules.ts/validate）与 `lib/vocabularies/` 的实现裁决边界语义（oneOf 判别、exclusiveMinimum 的 draft-07 形态、`$ref`/`#/definitions/` 解析、additionalProperties×patternProperties 交互），替代凭记忆的「JSON Schema 语义」。注意：ajv 多 draft 并存（`lib/2019.ts`/`2020.ts` 是新 draft 入口），对照须锁定 draft-07 形态；**只作语义参照，不引 ajv 代码进仓库**（协议层手写子集是既定架构） | 全部**可新增** |
| 5 | **node-main** | **中** | (a) `doc/api/*.md` = Node API 离线全量文档——engine 红线相关（`save.ts` globalThis 探测/storage 语义、`platformOf()` 先例）与 electron 主进程 `node:fs/path/url/module` 用面（前身 §2.8）的语义查证；(b) `lib/` = 内置实现源码（行为分歧溯源）。注意：27.0.0-dev 主干含未发布行为，答「Node 22/24 行为」时须意识到版本偏移、关键结论换 node_modules 或官方文档 URL 补证 | 全部**可新增** |
| 6 | **vite-main** | **中低** | (a) `docs/config/` + `docs/changes/` = 配置项权威与变更清单（8.3→9 升级前查 breaking）；(b) `packages/vite` 源码答 Rolldown 管线行为问题（前身 §2.2 的知识代差面）。当前两份 vite.config 各约 5 行零插件零敏感面，暴露面小，故评中低 | 全部**可新增** |
| 7 | pnpm-main | 低 | 仅两类场景：评估「npm workspaces→pnpm 迁移」时的选型材料（当前 ADR 无此路线）；workspace/lockfile/catalog 设计对照（弱）。快照 12.8.1 未发布，看「pnpm 能干什么」可以，当版本依据不行 | 可新增（无计划） |
| 8 | husky-main | 低 | 裸 `.githooks` 是已决选型（AGENTS.md 明示非 husky）；唯一场景是未来若要跨端 hook 管理体验再评估。其 `index.js` 是几十行的「最小 hook 管理器」实现参照，可解释「为什么裸钩子够用」 | 可新增（无计划） |
| 9 | react-main | 低/无 | UI 是原生 TS+DOM（有意选型）；仅当 UI 框架路线重议时作选型材料。当下零消费场景 | 可新增（无计划） |
| 10 | vite-plugin-react-main | 无 | 仅与 React 配套（plugin-react 6.x × vite 8 兼容矩阵在未来上 React 时才有意义）；本仓 vite 零插件 | — |
| 11 | pytest-main | 无～极低 | 测试设计思想（fixture/parametrize）与 vitest 生态无直接迁移价值，不建议投入 | — |
| 12 | cpython-main | 无 | 无 Python（AGENTS.md 明示）；3.16.0a0 dev 主干连「最新 Python」都不是 | — |
| 13 | pandoc-main | 无 | 文档转换工具（Haskell），与工程无交集 | — |

### 1.3 使用机制：已用现状 + 可新增的落地方式

**已用现状 = 零**。全仓（排除 node_modules）grep `Reference_Documents` 零命中——快照库目前尚未被任何文档、代码、ADR 引证；前身两份调研引用的是官方文档 URL 与 node_modules 安装包（先例：steamworks.js `index.d.ts` 逐字引证），不是快照。故 §1.2 全部是**可新增**用法。

**可新增的三条使用纪律**（建议写进下次对齐票或 ADR-018 巡检条目，而非 AGENTS.md——时点性内容按 ADR-018 决策不进 AGENTS.md）：

1. **引用标注纪律**：引用快照必标「快照名 + 快照内版本 + 取档日期（mtime）」；对**现役版本行为**的论断优先引 node_modules 安装版源码或官方文档 URL，快照只作深挖与前瞻。理由：快照无 .git、行号/形态会漂移（前身报告已有 `state.ts:848→856` 漂移先例），且 main 可能已偏离现役版本。
2. **三源三分工纪律**：「上游在改什么/将来会怎样」→ 快照；「现在该用什么版本」→ `npm view --registry=https://registry.npmjs.org`；「我实际装的是什么行为」→ node_modules。三者不可互相替代（§3.4 的张力正由此而来）。
3. **升级票前置查证**：ADR-018 巡检/升级票的「查 breaking-changes」步骤可先翻本地快照（electron-main/docs/breaking-changes.md、vitest-main/docs/guide/migration/、vite-main/docs/changes/），省去翻 GitHub releases 的时间；但快照取档 mtime 早于目标版本发布日时必须换线上源（如今天想查 electron 44.4.2–44.4.5 的 patch 内容，快照里反而没有——快照是 46 主干）。

**四类具体使用场景（何时打开哪个目录）**：

| 场景 | 触发 | 打开 | 产出 |
|---|---|---|---|
| A 升级前瞻 | #68 Vitest 5 动手；Electron 45 stable 转正 | vitest-main/docs/guide/migration/index.md + packages/vitest（vmThreads 预研）；electron-main/docs/breaking-changes.md 45.0 节 | 迁移清单、门禁重验假设 |
| B 行为争议溯源 | #80 rendererRecovery 清零洞 + memory-eviction 分类处置（ADR-018 落地记录标注的「强推断待确证」） | electron-main：docs/api/structures/render-process-gone-details.md、shell/、chromium_src/、patches/chromium/ | 「reload→再 evict 循环」推断的确证/证伪 |
| C schema 语义 | keywords.ts 扩关键词、schema 边界语义存疑 | ajv-master/lib/compile + lib/vocabularies（锁 draft-07 形态） | 关键词语义矩阵行的准确描述 |
| D TS 配置/类型行为 | tsconfig 编译项合法性、类型行为分歧 | TypeScript-main/tsc/internal/tsoptions + testdata | AGENTS.md TS7 红线的源头级证据 |

**明确不建议的用法**：把快照 main 当「升级目标/最新版本」依据；从快照抄未发布 API 进代码；用快照替代 node_modules 做日常引证；为「以后可能有用」通读 cpython/pytest/pandoc。

---

## 2. 版本现状一手核实（Q2 的地基，2026-09-29 官方源）

### 2.1 现役依赖：声明 / 安装 / 最新 / GA 时间线 / 差距性质

安装列 = 09-29 本仓 node_modules 实测（与 09-29 背景盘点一致，逐包 `require(…/package.json).version` 复核）；最新与 GA 日期 = 当日 `npm view <pkg> version dist-tags / time --registry=https://registry.npmjs.org` 实跑。

| 包 | 声明（package.json） | 安装 | npm latest | 关键 GA 时间线（npm time） | 差距性质 |
|---|---|---|---|---|---|
| typescript | `^7.0.2`（根+四包） | 7.0.2 | **7.0.2** | 7.0.2=2026-07-08（7.0 线 GA 日）；next=`7.1.0-dev.20260928.1` 每日滚动 | **零差距** |
| vite | `^8.3.0`（editor/app-desktop） | 8.3.0 | **8.3.1** | 8.0.0=2026-03-12；8.3.0=09-10；8.3.1=09-24 | **patch 差 1**（`^8.3.0` 范围内可吸收） |
| vitest | `^4.1.11`（根+四包） | 4.1.11 | **5.0.2**（V4 tag=4.1.11 仍在） | 4.1.11=2026-08-18；5.0.0=09-03；5.0.1=09-15；5.0.2=09-25 | **major 差 1 = 主动观望**（V5 GA 26 天；5.0.x 仅 patch 修复、V5.1 未发布） |
| electron | `44.4.1`（精确 pin） | 44.4.1 | **44.4.5** | 44.4.1=09-16；44.4.2=09-18；44.4.3=09-18；44.4.4=09-22；44.4.5=09-23 | **patch 差 4**（支持线内；Electron patch 线惯例含 Chromium/Node 安全 backport） |
| electron-builder | `^26.0.12` | 26.15.3 | latest tag=**26.15.3**，但 `v26` tag=**26.17.0** | 26.15.3=2026-06-09；26.16.0=09-02；26.16.1=09-07；26.17.0=09-26 | **minor 滞后 2**（`^26.0.12` 范围内；**dist-tag 异常**：latest 停在 26.15.3，26.17.0 实存未标 deprecated，见 2.2-b） |
| happy-dom | `^20.14.5`（editor/app-desktop） | 20.14.5 | **20.14.5** | 20.14.5=2026-09-12 | **零差距** |
| oxlint | `^1.83.0`（根） | 1.83.0 | **1.86.0** | 1.83.0=09-14；1.84.0=09-21；1.85.0=09-21；1.86.0=09-28 | **minor 差 3**（2 周内，oxlint 发版快；lint 处于观察期未串门禁） |
| @types/node | `^24.3.0`（engine/content/app-desktop） | 24.13.5 | **26.6.3**（`old-version` tag=24.19.0） | 24.13.5=09-15；24.13.6=09-19；24.19.0=09-25；26.6.3=09-25 | 线内 patch/minor 可吸收（24.13.6/24.19.0）；latest 已翻 **26 线**（跟 Node 26） |
| fflate | `^0.8.2`（editor） | 0.8.3 | **0.8.3** | 0.8.3=2026-05-16 | **零差距** |
| steamworks.js | `^0.4.0`（optional） | 0.4.0 | **0.4.0** | 0.4.0=2024-08-06（此后 **25 个月+**无版） | 零差距（**上游停更**，二轮调研 §2.3 已记档） |

对照开发机：Node v24.13.0（Active LTS，2026-10-20 转维护——前身报告引 nodejs/Release schedule.json）；根 `engines: node >=22.12`（满足 vite 8 与 Vite/Vitest 5 线要求）。

### 2.2 「参考库都是最新」假设的校正 + 两个 registry 细节

**(a) 快照三分**（数据见 §1.1）：超前于发布（electron-main 46 线 / node-main 27.0.0-dev / TypeScript-main≈7.1-dev / pnpm-main 12.8.1>12.6.0 / cpython-main 3.16.0a0>3.14.7）｜取档陈旧但碰巧同步（ajv 早 5 个月、husky 早 6 个月）｜真同步（vite/vitest/react/plugin-react/pandoc）。**「快照=最新」把 main 取档与 npm 已发布 latest 混为一谈**——快照里含大量未发布特性（electron 46 的 safeStorage 同步 API 移除、TS 7.1、pnpm Rust 化新版），照着它们升级/写代码会被带偏。

**(b) registry 的两个「latest≠最新」细节**（方法论素材）：
- `electron-builder` 的 latest tag 停在 26.15.3（2026-06-09），而 `v26` tag 已到 26.17.0（09-26）且无 deprecated 标记——`npm view <pkg> version`（取 latest tag）与「最高已发布版本」可能不一致，升级决策要看 `dist-tags` 全表 + `time`，不能只看一行。此异常的成因未查（附录未验证项）。
- `@types/node` 的 latest tag **会移动**：前身报告（09-16）记「latest=22.20.3 跟随 Node 22 LTS」，今日实测 latest=26.6.3（24.19.0 被标为 `old-version`）。规律（latest 跟随 Node 现行线）仍在，但具体数字 13 天即过期——实证 ADR-018「时点事实以调研文档与票为单一来源、不复制进 AGENTS.md」的决策正确。

### 2.3 前身结论复核（2026-09-16 → 2026-09-29）

| 前身结论 | 今日复核 |
|---|---|
| 「升级到最新=AI 知识覆盖更好」不总成立；Vitest 5 GA 仅 13 天暂缓 | **仍成立且更清晰**：V5 GA 满 26 天（09-03→09-29），5.0.1/5.0.2 为 patch 修复期，训练数据覆盖仍差；「甜点区=GA 2–3 个月+活跃维护」的 ADR-018 规则未到兑现点 |
| happy-dom 18 停更 / Electron 38 出支持窗口，需对齐 | **已解决**（#64 happy-dom 20.14.5+vite 8.3.0、#67 Electron 44.4.1 均已交付）；今日 happy-dom 已=latest |
| extract-zip「无修复版永久残留」 | **已被 #67 交付实证证伪**（ADR-018 落地记录勘误：44.x 改用 @electron-internal/extract-zip，audit 归零）——沿袭 ADR 口径 |
| 「@types/node dist-tag latest=22.20.3」 | **数字已过期**（今日 26.6.3），规律描述保留、数字以当日 npm view 为准（§2.2-b） |
| V5 迁移要点（clearMocks 翻转、vi.mock 顶层、子入口移除等） | 与 vitest-main 快照 `docs/guide/migration/index.md` 在档内容一致（09-29 打开复核），另**补 1 条**：vite 改 required peer dependency（§1.2-3） |

---

## 3. 升级必要性分 case 裁决（Q2）

> 遵 ADR-018 精神：安全/支持窗口驱动必须跟、大版本非安全不动、时点数字以本调研为单一来源。每 case 给结论 + 触发条件。

### 3.1 Case A｜安全/支持窗口驱动必须跟：Electron 44.4.1 → 44.4.5（跟 patch）

- **事实**：pin 44.4.1（09-16）落后支持线内 4 个 patch（44.4.2–44.4.5，09-18～09-23）；44 仍是支持线最前（45 最新仅 `45.0.0-alpha.13`，dist-tags `alpha-45-x-y`，未发 stable；42.11.8/43.7.5/44.4.5 三条线 09-23 仍在同步发版 = 官方三版本支持窗口现状）。Electron 的 patch 线惯例承载 Chromium/Node 安全 backport。
- **裁决**：**跟**（同 major 内 patch，pin 改 44.4.5）。#67 的「npm audit 归零」是 09-16 时点状态，新 advisory 与 backport 是动态的；精确 pin 意味着不会自动吸收，把 patch 跟随纳入巡检是 ADR-018「插队触发」的前置预防。工作量：改 pin + 常规回归（真机首跑红线 + 打包产物）；同 major 内预期无 API 变化（未逐条核对 44.4.2–44.4.5 changelog，见附录）。
- **触发条件**：每次巡检对比 `npm view electron` 的 44.x 行 + `npm audit`；出现 GHSA 直接插队。

### 3.2 Case B｜已最新零动作：typescript、happy-dom、fflate、steamworks.js

- **事实**：四个包安装版 = npm latest（§2.1）。
- **裁决**：**零动作**。唯二备注：①TS 7.1（含 compiler API 回归）发布后按「大版本后 2–3 个月/.1」规则评估，届时 TypeScript-main 快照可作迁移预研；②steamworks.js 上游 25 个月+无版（二轮 §2.3 已记），风险是「停更」而非「落后」，维持 mock 回落防线，不作升级动作（无可升版本）。
- **触发条件**：TS 7.1 GA；steamworks 替代品生态变化（无迹象）。

### 3.3 Case C｜patch/minor 滞后随事件捎带：vite 8.3.1、electron-builder 26.17.0、@types/node（24.x 线内）

- **事实**：三者都在声明 semver 范围内（`^8.3.0` / `^26.0.12` / `^24.3.0`），`npm update` 可自然吸收；均为 devDep/类型包，无生产运行时面。
- **裁决**：**不单开票、不立即动**，随下一次任何对齐票/特性批收口**捎带** `npm update`（例：#65 fuses 改 electron-builder.yml 时顺手吸收 electron-builder 26.17.0 与 vite 8.3.1 最合理——fuses 验收本就要出包重验）。@types/node 线内 24.13.6/24.19.0 同理；是否上 26.x 线属 Case E 的「按需」（与开发机 Node 版本策略联动，见 §3.5）。
- **触发条件**：任一票触碰 npm install/update 时；巡检 `npm outdated` 非空时。

### 3.4 Case D｜major 滞后但双侧活跃 → 暂缓：vitest 4 → 5

- **事实**：V5 GA 26 天（5.0.2 为 09-25 patch），**#68 的两个触发（GA 满 2–3 个月 ≈ 2026-12 上旬，或 V5.1 发布）今日均未到**；V4 线（4.1.11）仍在维护 tag 上。重验面小（vi.mock 仅 1 处、无快照测试）但 `.githooks/pre-push` 的 `--pool=vmThreads` 门禁钉必须实跑重验。
- **裁决**：**维持 #68 观望**——前身「暂缓反而对」的结论在 2026-09-29 复核后**原样成立**。Vitest 5 的「新」在此时是负资产（训练数据覆盖差），而 4.1.11 知识覆盖好、V4 在维护，等待成本≈0。
- **触发条件**：2026-12-03 起复评，或 V5.1 发布，或 V4 出安全通报（插队）；动手第一步=vmThreads 门禁实跑（可用 vitest-main 快照预研 pool 实现），清单用快照 `docs/guide/migration/index.md`（注意 vite→peer dependency 新增点）。

### 3.5 Case E｜纯 devDep 低风险按需：oxlint；附 Node/@types/node 26 线时点

- **oxlint**（1.83.0→1.86.0，2 周差 3 minor）：lint 处于观察期（AGENTS.md：未串 check/pre-push），升级无任何行为风险也无紧迫性——**按需**（下次动 lint 配置时顺手 `npm i -D oxlint@latest` 即可）。
- **Node 线时点**：开发机 v24.13.0 于 2026-10-20 转维护期；Node 26 预计 2026-10-28 LTS 化（前身报告引 nodejs/Release schedule.json）——届时可评估开发机 Node 26 + @types/node 26 线对齐（`@types/node` latest=26.6.3 已是 26 线）。node-main 快照（27.0.0-dev）**不是**升级目标。
- **触发条件**：2026-10 月末 Node 26 LTS 化时点巡检。

### 3.6 两问「互斥/张力」的专门分析

1. **正交性（互斥感的第一半）**：Q1 的价值与「是否升级」无关——任何在用版本都能查源码（node_modules 就有安装版源码），快照的增量价值在**前瞻文档**（breaking-changes/migration）与**安装包里没有的实现深水区**（Electron C++/Chromium、TS Go 编译器、Node C++）。不升级（如 vitest 留在 4）时快照照样有用（预研 V5）；升级后快照照样有用（查下一个版本）。
2. **张力（互斥感的第二半）**：快照 main = **未发布开发线**，若把「参考库都是最新」当真、以快照定升级目标，会被带偏——electron 46 移除了现役 44 仍可用的 safeStorage 同步 API、node 27.0.0-dev 无发布版、pnpm main 12.8.1 未发布、TS 7.1-dev 的 compiler API 形态未定。**「现在该用什么版本」只能由 npm view 官方源回答**；快照回答的是「上游在改什么」。
3. **合并裁决**：**升级决策用 npm 数据定「何时/升到哪」，用快照定「升的时候会发生什么」**。快照的时效参差（ajv/husky 早 3–6 个月）进一步说明引用必须带日期、关键决策后用线上源复核。
4. **反向价值**：正因快照超前，它是「训练数据覆盖差区」的唯一本地补偿——AI 对 electron 46/TS 7.1/Vitest 5 的知识≈0，而快照有全文（例：#68 的 CopyPrompt 条目甚至就是上游为 AI 迁移准备的）。这与前身报告「知识代差是最大风险」的判断闭环。

---

## 4. 可执行结论

### 4.1 该做（按优先级）

| # | 动作 | 衔接 | 时机 |
|---|---|---|---|
| 1 | Electron **44.4.1 → 44.4.5**（pin + 常规回归：真机首跑 + 打包产物） | #67 的 patch 跟随收尾；归入巡检「插队触发」的预防面 | 下次对齐批（或巡检发现 audit/advisory 时插队） |
| 2 | **#65 fuses 票**（OPEN）落地时：electron-main/docs/tutorial/fuses.md + asar-integrity.md 作语义参考；同票**捎带** `npm update`（electron-builder 26.17.0、vite 8.3.1） | #65 票面「runAsNode=disable + enableNodeCliInspectArguments=disable + asarIntegrity=enable」起点不变 | #65 动手时 |
| 3 | **#68 维持观望**，2026-12-03 起复评（或 V5.1/安全事件提前）；动手第一步 vmThreads 门禁实跑 + vitest-main migration 清单（含 vite→peer 依赖新点） | #68 触发条件今日未到（本调研复核） | 2026-12 上旬 |
| 4 | 快照使用三纪律（§1.3）以一句话并入下次巡检条目/对齐票模板；`Reference_Documents` 现状零引用，从场景 A–D 按需启用 | ADR-018「事件驱动+巡检」节奏不变 | 随 #65/#68 票 |
| 5 | 2026-10 月末 Node 26 LTS 化时点：评估开发机 Node 26 + @types/node 26 线 | Case E | 2026-10-28 后巡检 |

### 4.2 明确不做

- **不整包追最新**：vitest 5（观望）、TS 7.1-dev、electron 45/46（alpha/开发线）、node-main 27 dev、pnpm-main 12.8.1（未发布）——快照里的「比最新还新」一律不作升级依据。
- **不动**：typescript / happy-dom / fflate / steamworks.js（已最新）；oxlint 无紧迫性（按需）。
- **不迁移**：npm workspaces→pnpm、裸钩子→husky、原生 DOM→React——三个快照（pnpm/husky/react 系）对应的都是已决选型的反面，无重议触发。
- **不投入**：cpython/pytest/pandoc 快照（零交集）。
- **不引代码进仓**：ajv 等快照只作语义参照，schema 校验器维持手写子集（协议层既定架构）。

### 4.3 下次巡检触发条件（汇总）

1. **节奏**（ADR-018 既有）：每特性批收口或季度——`npm outdated` + `npm audit`（官方源）+ `npm view electron`（44.x patch 行）+ Electron 支持窗口（45 是否 stable、42 是否退窗）。
2. **时点**：2026-10-28（Node 26 LTS）→ Case E；2026-12-03（V5 GA 满 3 个月）或 V5.1 发布 → #68；TS 7.1 GA → Case B 备注；Electron 45 stable → 用快照 breaking-changes 45.0 节做升级预案。
3. **插队**：现行 pin 出 critical/high 通报、或 electron 滑出三版本窗口 → 升级票插到对齐档位（ADR-018 原文）。
4. **快照维护**：`Reference_Documents` 为仓外资产；若继续作查证源，取档日期参差（ajv/husky 早 3–6 个月）在引用时标注，重大决策查证后以线上源复核。

---

## 附录 A：调研方法与命令（全部只读；未动 Reference_Documents、未跑 install/update/audit fix）

1. **快照盘点**：13 目录 `ls`；版本证据 `grep`/`head` 于各快照 manifest 与版本文件（electron-main/docs/breaking-changes.md 章节标题、TypeScript-main/go.work + tsc/go.mod + tsc/CHANGES.md、node-main/src/node_version.h、vite-main/packages/vite/package.json、vitest-main/packages/vitest/package.json + docs/guide/migration/index.md、pnpm-main/package.json、ajv-master/package.json + lib/ 结构、react-main/ReactVersions.js、vite-plugin-react-main/packages/*/package.json、pytest-main/pyproject.toml + changelog/、cpython-main/Include/patchlevel.h、pandoc-main/pandoc.cabal + changelog.md）；取档时点 `stat -c '%y'`（外层目录 + 抽样内层文件交叉）。
2. **版本核实**（2026-09-29，全部显式 `--registry=https://registry.npmjs.org`）：`npm view <pkg> version dist-tags` 覆盖 typescript/vite/vitest/electron/electron-builder/happy-dom/oxlint/fflate/steamworks.js/@types/node/ajv/husky/pnpm/react/react-dom/@vitejs/plugin-react/@vitejs/plugin-react-swc/node；`npm view <pkg> time --json`（grep 版本键）取 GA 日期，覆盖 typescript/vite/vitest/electron（44.x 全行）/electron-builder/oxlint/@types/node/fflate/steamworks.js。dist-tag 异常项（electron-builder 26.17.0）二次核实：`npm view electron-builder@26.17.0 version`（实存）+ `deprecated`（空）。
3. **安装实测**：`node -e require(…/package.json).version` 于根 node_modules（typescript/vite/vitest/happy-dom/oxlint/electron/electron-builder/@types/node/fflate/steamworks.js）——与声明/锁定口径核对。
4. **票面**（`gh issue view` 只读）：#65（OPEN，fuses）、#66（**CLOSED**，app-desktop 测试入 tsc 查型——已交付，无后续动作）、#68（OPEN，Vitest 5 观望）。
5. **衔接**：`docs/research/version-drift-impact.md` + `version-drift-impact-round2.md` + `docs/adr/0018-toolchain-alignment-policy.md`（含 2026-09-29 落地记录与 extract-zip 勘误）全文复读，结论复核见 §2.3。
6. **非 npm 生态 latest**（来源标注于 §1.1）：WebFetch pypi.org/pypi/pytest/json（pytest 9.1.1）、python.org/downloads（3.14.7）、api.github.com/repos/jgm/pandoc/releases/latest（3.12，2026-09-29 发布）。
7. **已用现状核查**：全仓（排除 node_modules）grep `Reference_Documents` = 零命中。

## 附录 B：未验证项（如实声明）

- electron **44.4.2–44.4.5** 各 patch 的 changelog/GHSA 明细未逐条核对（本调研按「Electron patch 线惯例含安全 backport」的行业常态作裁决输入；动手升级票时应逐条过 [releases](https://www.electronjs.org/releases) 与 `npm audit`）。
- electron-builder latest tag 停在 26.15.3 而 v26=26.17.0 的**成因**未查（仅记录现象；对「^26 范围内可吸收 26.17.0」的裁决无影响）。
- 快照精确 commit/取档日期不可考（无 .git），mtime 为代理；快照内文件与各自 main 分支当日状态的偏差无法排除。
- cpython/pytest/pandoc 的「最新」为 WebFetch 三方源（python.org/PyPI/GitHub API），非 npm view（非 npm 生态）；pytest 快照自身的「相对 9.1.1 的新旧」因 dynamic version 不可精确定位。
- 沿袭前身未验证项（不在本调研范围）：Vitest 5 下 `--pool=vmThreads`「必挂」论断（#68 前置实跑）、happy-dom 19–20.x 逐版本 breaking、steamworks.js 内嵌 Steamworks SDK 版本。
- 本调研未跑 `npm audit`（约定的只读命令清单不含）；「#67 后 audit 归零」引自 ADR-018 落地记录，09-29 当日的 audit 状态未复测。
