# 参考源码库使用法：三层递进的实现

> 对象：`D:\My_Projects\Reference_Documents` 下的官方源码快照（**整目录严禁改动，只许读**——钩子 A 兜底，见 [compliance-mechanical-gates.md](compliance-mechanical-gates.md)）。
> 背书：`docs/research/reference-snapshots-value-and-upgrade-necessity.md`（价值矩阵与升级裁决）。锚点卡：[reference-snapshots-anchors.md](reference-snapshots-anchors.md)。
> 递进逻辑：第一层让查阅**便宜**，第二层让查阅**必然发生**，第三层让查阅**变成产出**。

## 第一层：预制锚点（把散查变成查阅便宜）

**锚点卡**（[reference-snapshots-anchors.md](reference-snapshots-anchors.md)）：每个高价值快照一张、一页以内，含——快照名 / 取档日期 / 版本标识 / 目录地图 / 高频锚点（路径级）/ 版本偏移警告 / 适用场景编号。任何会话按卡直奔目标文件，不再重新踩点。

**场景触发表**——"什么时候打开哪个库"，是本层的核心交付：

| 场景 | 触发 | 打开（锚点卡有细目） | 产出 |
|---|---|---|---|
| A 升级前瞻 | #68 Vitest 5 动手；Electron 45 stable 转正 | vitest-main migration 指南 + pool 源码；electron-main breaking-changes | 迁移清单、门禁重验假设 |
| B 行为争议溯源 | #80 rendererRecovery / memory-eviction 确证 | electron-main render-process-gone-details + shell/ + chromium_src/ | 推断的确证 / 证伪 |
| C schema 语义 | keywords.ts 扩行、边界语义存疑 | ajv-master docs/（先）+ lib/（后），锁 draft-07 形态 | 语义矩阵行的准确描述 |
| D TS 配置 / 类型行为 | 编译项合法性、类型行为分歧 | TypeScript-main tsoptions + testdata/baselines | 源头级证据（不猜） |
| E 壳加固 | 壳加固票（#69-#78 批）动手 | electron-main security.md 19 条清单 | gap 对照表 → 票验收清单 |
| F CI / 自动化测试 | CI+lint 裁决后续、UI 冒烟工程化 | electron-main automated-testing.md + testing-on-headless-ci.md | 自动化路线选型 |
| G 崩溃 / 进程模型 | 崩溃分类、进程边界问题 | electron-main crash-reporting.md + process-model.md | 分类口径 |
| H 测试写法借鉴 | 测试质量 / 性能 / 排障 | vitest-main docs/guide（snapshot/parallelism/profiling/common-errors） | 测试改进清单 |
| I Node API 语义 | engine 红线（globalThis 探测 / storage）争议 | node-main doc/api/ + lib/ | 语义查证 |
| J 选型材料 | 仅当 UI 框架 / 包管理器路线重议 | react 系 / pnpm-main / husky-main | 选型对比（当前无触发） |

## 第二层：流程制度化（让查阅必然发生）

三纪律 + 三个落点。机制细节见 [compliance-mechanical-gates.md](compliance-mechanical-gates.md) 与 [compliance-soft-layers.md](compliance-soft-layers.md)（本层只管"何时查、查完如何标注"）。

**三纪律**：

1. **引用标注**：引用快照必标「快照名 + 内部版本 + 取档日期」；论断**现役版本行为**优先引 node_modules 或官方文档 URL，快照只作深挖与前瞻。
2. **三源三分工**：「上游在改什么 / 将来怎样」→ 快照；「现在该用什么版本」→ `npm view --registry=https://registry.npmjs.org`；「我实际装的是什么行为」→ node_modules。三者不可互替。
3. **升级票前置查证**：升级 / 对齐票的「查 breaking-changes」步骤先翻本地快照；但快照取档早于目标版本发布日时必须换线上源。

**三个落点**：

- **票模板「查证锚点」栏**（升级票必填勾项）→ 查阅发生在开票时，而非出错后。
- **ADR-018 巡检条目**加一步「按场景表过一遍新触发」→ 查阅周期性发生。
- **policy 断言 P5**（docs/research 引用标注格式）→ 标注被机器盯着。

## 第三层：深用产出（让查阅变成产出）

深用 = 一次有界分析，产出物直接喂**在册票**，不写泛泛的"学习笔记"：

| # | 深用项 | 方法（步骤） | 产出 | 绑定 |
|---|---|---|---|---|
| 1 | **壳加固 gap 分析**（样板） | ① 读 security.md 19 条 → ② 逐条对照壳层现状（main/preload/config/权限处理）打分：符合 / 不适用 / 缺口 → ③ 缺口项写成加固动作 + 验收标准 | 19 条对照表 + 拆票建议 | #69-#78 批壳加固票 |
| 2 | memory-eviction 确证 | 按场景 B 锚点读 render-process-gone-details + shell 实现，证伪 / 确证「reload→再 evict 循环」推断 | 结论进票评 / ADR-018 落地记录 | #80 |
| 3 | vmThreads 门禁预研 | 读 vitest-main pool 实现，列出「V5 是否仍必挂」的证据点，等实跑验证 | 迁移清单一节 | #68（2026-12 复评） |
| 4 | schema 语义矩阵储备 | keywords.ts 扩行时按场景 C 读 ajv docs→lib，裁决 oneOf / exclusiveMinimum 等边界 | keywords.ts 矩阵行 | 扩行票随票 |

样板（深用 1）的可复制模式：**官方清单 × 本仓现状 = 逐条打分表 = 票的验收标准**。任何"官方有清单类材料"的场景都照此办。

## 边界与维护

- **不抄代码进仓**（ajv 等只作语义参照；手写校验器是既定架构）；**main ≠ latest**，快照不作版本依据；**零交集库不通读**（cpython/pytest/pandoc）。
- 快照是时点资产：取档日期参差（ajv/husky 早 3-6 个月），引用必标注，重大决策查证后线上复核；快照刷新时同步更新 [锚点卡](reference-snapshots-anchors.md) 的取档日期与路径。
- 锚点卡一页封顶；场景表按新触发增行（改本文档），不新开平行文档。
