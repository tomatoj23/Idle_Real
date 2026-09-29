# 快照锚点卡（查阅入口）

> 用法见 [reference-snapshots-usage.md](reference-snapshots-usage.md)。每卡一页封顶；快照刷新时同步更新取档日期与路径。
> 全部**只读**（用户明令 + 钩子 A 兜底）。通用三源分工：现役行为引 node_modules、版本决策跑 npm view、**将来/上游才翻这里**。
> 低价值快照（pnpm/husky/react 系/cpython/pytest/pandoc）不设卡：仅选型材料，价值矩阵见调研文档。

## electron-main（electron/electron，开发线 46.0，取档 2026-09-29）——场景 A/B/E/F/G

| 用途 | 锚点 |
|---|---|
| 破坏性变更全集（37.0–46.0 含未来节） | `docs/breaking-changes.md` |
| fuses（#65 权威材料） | `docs/tutorial/fuses.md`、`asar-integrity.md`、`asar-archives.md` |
| 壳加固 19 条官方清单（场景 E 样板素材） | `docs/tutorial/security.md`（Checklist 节） |
| 自动化测试 / headless CI | `docs/tutorial/automated-testing.md`、`testing-on-headless-ci.md` |
| 崩溃 / 进程模型 | `docs/tutorial/crash-reporting.md`、`process-model.md`、`docs/api/structures/render-process-gone-details.md` |
| memory-eviction 锚点（#80） | `docs/api/app.md`、`shell/common/gin_converters/base_converter.h` |
| API 离线全集 / 行为溯源 | `docs/api/`（81 篇）、`shell/`、`chromium_src/`、`patches/chromium/` |

⚠️ main 含未发布变更；答「现役 44.x 行为」以 node_modules / 线上 44.x 文档为准。

## TypeScript-main（microsoft/TypeScript，7.1-dev Go 形态，取档 2026-09-29）——场景 D

| 用途 | 锚点 |
|---|---|
| 编译项合法性最终依据 | `tsc/internal/tsoptions/commandlineoption.go` |
| 类型行为裁定性测试 | `tsc/testdata/tests` + `tsc/testdata/baselines`（遇分歧查 fixtures，不猜） |
| Strada(JS) vs Corsa(Go) 行为差异 | `tsc/CHANGES.md` |

⚠️ main 是 7.1-dev，答「现役 7.0.2 行为」须剔除 7.1 变更；TS 7 无 JS compiler API，**勿从快照抄 ts API 用法**。

## vitest-main（vitest-dev/vitest，5.0.2，取档 2026-09-29）——场景 A/H（#68 专属）

| 用途 | 锚点 |
|---|---|
| V5 官方迁移指南（#68 目标线） | `docs/guide/migration/index.md`（含 vite 改 required peer dependency 新点） |
| vmThreads 预研（门禁重验） | `packages/vitest` pool 实现 |
| 测试方法论借鉴 | `docs/guide/`：snapshot / parallelism / mocking / coverage / profiling-test-performance / common-errors |

## ajv-master（ajv-validator/ajv，8.20.0，取档早约 3-6 个月）——场景 C

| 用途 | 锚点 |
|---|---|
| draft-07 关键词语义（文档层，**先读**） | `docs/keywords.md`、`docs/json-schema.md`、`docs/strict-mode.md` |
| 实现层裁决（存疑再下钻） | `lib/compile/`（rules.ts/validate）、`lib/vocabularies/` |

⚠️ ajv 多 draft 并存（`lib/2019.ts`/`2020.ts` 是新 draft 入口）——对照**必须锁定 draft-07 形态**；只作语义参照，代码不进仓。

## node-main（nodejs/node，27.0.0-dev，取档 2026-09-29）——场景 I

| 用途 | 锚点 |
|---|---|
| Node API 离线全量文档（70 篇） | `doc/api/` |
| 内置实现溯源（storage/定时器语义） | `lib/` |

⚠️ 27.0.0-dev 含未发布行为，答「Node 22/24 行为」须用 node_modules / 官方文档补证。

## vite-main（vitejs/vite，packages/vite=8.3.1，取档 2026-09-29）——低频

| 用途 | 锚点 |
|---|---|
| 配置项权威 / 变更清单（8.3→9 前查 breaking） | `docs/config/`、`docs/changes/` |
| Rolldown 管线行为 | `packages/vite` |

⚠️ 当前两份 vite.config 均零插件，暴露面小；升级票捎带（#65）时再翻。
