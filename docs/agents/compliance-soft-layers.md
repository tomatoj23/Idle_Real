# 软约束与记忆实施细则（层②③）

> 上级索引：[compliance.md](compliance.md)。层②覆盖所有 LLM（都读仓库文档）；层③只覆盖单 harness 的跨会话。

## 1. 文档落位原则（层②）

| 载体 | 放什么 | 不放什么 |
|---|---|---|
| AGENTS.md | 短、硬、少的原则（红线）；各流程文档的指针 | 时点版本数字（ADR-018）、流程细节 |
| docs/agents/*.md | 流程、纪律、清单（如本文档集） | 决策依据（进 ADR） |
| docs/adr/ | 不可逆决策 + 理由 | 时点数字 |
| 票 / PR 模板 | 可勾选 checklist | 散文 |

- **清单优于散文**：规则尽量写成 checkbox；LLM 对 checklist 的遵循率显著高于段落。
- **规则可执行化**是 AGENTS.md 里值得保留的一条元规则：落新规则先问「机器能不能查」，能查的走 [compliance-mechanical-gates.md](compliance-mechanical-gates.md)。

## 2. 票 / PR 模板与 review 清单

**票模板与 agent 开票面**（#83 已实施）：web UI 使用 [.github/ISSUE_TEMPLATE/engineering-task.yml](../../.github/ISSUE_TEMPLATE/engineering-task.yml)，`gh issue create` 不校验模板，必须按 [issue-tracker.md](issue-tracker.md) 的两栏骨架开票。以下为两处文案的单一规则来源：

- `查证锚点`：本票涉及升级/行为争议时，先翻的本地快照路径（见 [reference-snapshots-anchors.md](reference-snapshots-anchors.md)）；卡内直达注明锚点名；引用标注「快照名 + 内部版本 + 取档日期」；升级票必填「breaking-changes / migration 已查」勾项。**卡外查阅附一行检索简报**（问题 / 入口 / 停止条件，见 [reference-snapshots-usage.md](reference-snapshots-usage.md) 直达纪律）。
- `验收清单`：含「真实浏览器首跑」固定项（红线），交付附环境 / 操作 / 结果。开票时保持待办，不适用须写理由；纯文档票可不跑游戏，涉 UI / 运行时改动不可用 happy-dom / CI 替代。

**code-review 清单**（implement 收尾复核时逐项对照）：

- [ ] AGENTS.md 红线全项：engine 无平台全局直接引用、globalThis 解构已 bind 宿主、验收含真实浏览器首跑记录
- [ ] 时点版本数字未进 AGENTS.md / CONTEXT.md / ADR（进票评或 docs/research）
- [ ] 引用本地快照处带「快照名 + 内部版本 + 取档日期」标注
- [ ] 涉快照决策带直达痕迹：卡内注明锚点名，卡外带检索简报（问题 / 入口 / 停止条件）
- [ ] 测试只写沙箱（tempRoot 类注入），无真档路径写入
- [ ] 票面「查证锚点 / 验收清单」栏已填（web UI 表单要求非空，gh CLI 按骨架主动填写；非空不等于内容合规，仍须 review）

## 3. 记忆硬化管道（层③ → 层①的转化）

记忆是**待转化的中间态**，不是终点：

1. 教训进记忆（记「为什么 + 怎么避」，含事故复盘指针）。
2. **复发 ≥2 次或酿成事故 ≥1 次 → 必须升级为机械门禁**（钩子 / policy 断言），记忆条目改为指向门禁并注明「已硬化」。
3. 硬化后记忆保留价值：门禁只知道「拦什么」，记忆保存「为什么拦」，供后人裁决是否放宽。

**分工纪律**：所有「每个 LLM 都要知道」的内容必须落仓库文档（层②），记忆只存指针 + 用户偏好 + harness 私有坑。依据：各 harness 记忆互不相通（.zcode memory 与 .codebuddy/memory 并存的现状即证明）。

### 巡检留痕与复发计数

[ADR-018](../adr/0018-toolchain-alignment-policy.md) 巡检三步的结果写进巡检票评或产出物：`规则 / 样本链接 / 事件或产出日期 / 预期 / 实得 / 累计偏离次数 / 处置`。缺直达痕迹只证明留痕缺失，不据此推断搜索过程曾漫游；没有适用样本不算通过，也不计偏离。同一事件在多次抽查中出现只计一次，两个独立事件才算「复发 ≥2」；已有纠正保留原事件与处置链接，计数不得因修文而失去来源。达到阈值按本节管道升级；过程语义不可机械判定的边界仍按 §5 处理，不自行新增第四条钩子。

### 已发生教训 → 现有硬化 / 候选清单（#83）

以下逐项区分事实、现有落点与候选，不把「事故 ≥1 / 复发 ≥2」阈值当作发生次数的证明。门禁覆盖面以 [机械细则](compliance-mechanical-gates.md) 为准；本票只补清单，不新增钩子或扩大 policy 检测面。

| 教训 / 明令与事实依据 | 现有硬化 / 可行候选 | 状态与边界 |
|---|---|---|
| 2026-09-29 把 userData 当测试目录删档（[#81 事故形态验收](https://github.com/tomatoj23/Idle_Real/issues/81#issuecomment-5888665376)，机械细则 §1 B） | 钩子 B 拦工具文本中的真档写/删；P4 查测试真路径字面量；测试注入 `userDataDir: tempRoot()` | **已硬化事故字面形态**（#81 / #82）。测试进程内部写盘、运行时解析与计算路径仍靠沙箱设计与 review，不能称钩子保证所有测试不动真档 |
| 原生方法失去 `this`，happy-dom 全绿遮住 Chromium `Illegal invocation`（AGENTS.md 工程红线，`e93727e` / `packages/engine/src/save.ts`） | 已有 `.bind(g)` 修复 + P2 弱检测；候选：严格校验接收者的定时器替身回归 | **具体修复已落，P2 仅 review 级；严格接收者测试为候选**。P2 不阻塞，探测别名等形态仍须 review，真机首跑不可替代 |
| vmThreads 强制理由失真并进入钩子 / 文档 / 记忆（[#72 三池证伪核销](https://github.com/tomatoj23/Idle_Real/issues/72#issuecomment-5702314082)） | 已取消强制池透传；巡检用违规正对照确认门禁真会红，复评假设须有现役实跑证据 | **历史修复已实施，持续巡检为维护落点**。不把旧 V5 假设当现役事实，不重新钉死 vmThreads |
| 挂根 check / 只有自测脚本不等于接线（[#82 接线修订](https://github.com/tomatoj23/Idle_Real/issues/82#issuecomment-5887107174)，[#85 自测欠账](https://github.com/tomatoj23/Idle_Real/issues/85#issuecomment-5894090575)） | policy 扫描与守卫自测在 pre-push / CI 各显式接线；候选：policy 自身 `--self-test` 也自动接入两网 | **现有接线已实施；policy 自测自动接线为候选**。`scripts/` 非 workspace，不能说 npm test 自动包含这两类自测 |
| 守卫漏检 / 误伤，授信复锁可使门禁空转（[#82 对抗复核](https://github.com/tomatoj23/Idle_Real/issues/82#issuecomment-5891281244)，[#85 补遗](https://github.com/tomatoj23/Idle_Real/issues/85#issuecomment-5895411581)，机械细则 §1 trust） | DENY / ALLOW 双向金丝雀、守卫运行时异常拒绝；配置声明改动后由用户重授信，再留实际执行证据 | **既有缺陷修复与守卫回归已实施**。脚本自测不证明主会话已装配钩子；子代理无 hookRunner 是已声明边界，无头差异仍为未留证现象 |
| 参考库只读为用户明令（compliance.md §2，[#85 核销](https://github.com/tomatoj23/Idle_Real/issues/85#issuecomment-5894312543)），不是已发生写坏事故 | 钩子 A + 工作区 matcher；OS ACL 补子代理 / 裸进程旁路 | **已实施，ACL 为历史观测已启用**。不把文本钩子称为任意工具 / 计算路径的完整拦截器，本票未重验实际 ACL |
| 禁 `--no-verify` 为明令；缩写与配置旁路曾在审计中打穿（[#85](https://github.com/tomatoj23/Idle_Real/issues/85)，AGENTS.md Git 钩子节） | 钩子 C 拦 push / commit 显式选项、短簇及配置旁路；CI 作第二环境回归 | **已实施主会话工具文本面**。不推断发生过真实违规交付；CI 不阻止人类终端绕过，也不能撤回已经发生的 push |
| 直达过程不能机械判定，缺痕迹须成为可观察信号（[#83 直达纪律](https://github.com/tomatoj23/Idle_Real/issues/83#issuecomment-5889327051)，[抽查补全](https://github.com/tomatoj23/Idle_Real/issues/83#issuecomment-5889385583)） | web UI 固定栏 + gh 开票骨架 + review + ADR-018 抽查；卡内锚点名 / 卡外检索简报 | **半硬落点已实施（#83）**。未证实复发两次；P5 仅粗查日期，不验完整三元标注或直达过程 |
| 只读审查代理清理共享 `.scratch/`，删掉其他会话截图证据（[#79 二轮复审](https://github.com/tomatoj23/Idle_Real/issues/79#issuecomment-5740747274)） | 候选：会话私有临时根 + 清理入口断言目标属于本会话创建的目录；共享目录删除保护另行裁决 | **待候选，未硬化**。现有 A/B/C 不含此项；不是用户存档事故，也不泛化成跟踪文件丢失 |

## 4. 交叉验证（防软约束漂移）

- 复发性偏离（agent 反复违反同一条软规则）是「该机械化了」的信号，按 §3 升级。
- 事故复盘必须回答一句：「这条规则当时为什么只有软约束？」——答案写进复盘，供元规则迭代。

## 5. 诚实的限度

- 文档与记忆的遵循率高但**永远不是 100%**：模型漂移、上下文压缩、不同模型服从度差异都真实存在。
- 因此约束强度必须与事故等级匹配（元规则 2）；无法机械化又重要的规则（如真机首跑），用「模板固定项 + 交付核销」半硬兜底。
