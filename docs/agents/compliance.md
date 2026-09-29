# Agent 合规体系（索引与总纲）

> 目标：让任何 LLM / agent / 人在本仓开发时遵循工程红线与使用纪律，**且不依赖自觉**。
> 状态：机械层①三道 PreToolUse 钩子**已实施**（#81，2026-09-29）；policy 脚本（#82）待实施。实施时允许换等效机制，以行为验收为准（§4）。
> 背书：`docs/research/reference-snapshots-value-and-upgrade-necessity.md`（调研留档）。

## 0. 元规则（写规则的规则）

1. **能机器检查的绝不写成散文**：新规则落地时先写「断言 + 触发命令」；只有无法机器判定的才允许退化为文档清单。
2. **按事故等级配约束强度**：出过事故 / 用户明令 → 机械门禁；只造成返工 → 文档清单；纯风格 → review。
3. **软硬分工**：文档与记忆负责「知道为什么」，钩子与门禁负责「不可能再犯」。教训在记忆复发 ≥2 次或酿成事故 ≥1 次，必须升级为机械门禁（记忆硬化管道，见 [compliance-soft-layers.md](compliance-soft-layers.md) §3）。

## 1. 三层合规架构

| 层 | 载体 | 保证强度 | 覆盖面 |
|---|---|---|---|
| ① 机械门禁 | PreToolUse 钩子、policy 脚本（串进 `check`）、守卫测试、CI、可选 OS ACL | **保证**（与模型服从无关） | 任何 agent / 人 |
| ② 载荷知识 | AGENTS.md（宪法）、docs/agents/（流程）、ADR（决策）、票 / PR 模板（清单） | 高概率 | **跨 LLM 唯一软载体** |
| ③ 记忆 | 各 harness 记忆（.zcode memory、.codebuddy/memory 等） | 概率性、单 harness | 仅本 harness 跨会话 |

保证强度自上而下递减；②的覆盖面最广——**所有"每个 LLM 都必须知道"的内容必须落仓库文档**，记忆只存指针与用户偏好。

- ① 细则 → [compliance-mechanical-gates.md](compliance-mechanical-gates.md)
- ②③ 细则 → [compliance-soft-layers.md](compliance-soft-layers.md)

## 2. 规则落位总表

| 规则（来源） | 机制 | 层 | 状态 |
|---|---|---|---|
| Reference_Documents 只读（用户明令） | PreToolUse 钩子拒写；可选 OS ACL 保险 | ① | **已实施**（#81 钩子 A） |
| 测试严禁动用户真档（2026-09-29 事故） | 钩子拦字面写/删命令（事故形态）+ policy 查真路径字面量 + 测试沙箱注入 | ① | **已实施**（#81 钩子 B；policy P4 + 沙箱注入随 #82） |
| 禁 `--no-verify`（AGENTS.md） | 钩子 + CI 双网 | ① | **已实施**（#81 钩子 C + CI 双网） |
| engine 禁平台全局 / bind 宿主（AGENTS.md 红线） | policy 脚本 / 守卫测试 | ① | 待实施 |
| schema 只认 `#/definitions/`（AGENTS.md） | policy 查 `$defs` | ① | 待实施 |
| npm 查最新须显式官方源（AGENTS.md） | 包装脚本（把对的事变容易）+ 文档 | ①/② | 待实施 |
| 快照引用三纪律 / 取档标注 | 票模板「查证锚点」栏 + policy 查 docs/research 引用格式 | ①+② | 待实施 |
| 快照查阅直达纪律（防带跑，2026-09-29） | usage 直达五条 + 票面卡外检索简报行 + review 清单「直达痕迹」项 + 巡检抽查（复发信号源） | ② | 已成文（91ba2c1）；模板/巡检面随 #83 |
| 真实浏览器首跑（AGENTS.md 红线） | 票模板验收清单 + 冒烟脚本（半硬） | ② | 清单待加 |
| 时点数字不进 AGENTS.md（ADR-018） | review 清单项 | ② | 已成文 |
| 票认领纪律（多会话并行） | gh assign 惯例 + 交付清单 | ② | 已成文 |

## 3. 文档集索引

1. **compliance.md**（本文）—— 元规则、三层架构、规则落位总表
2. **[compliance-mechanical-gates.md](compliance-mechanical-gates.md)** —— ① 机械门禁实施细则（钩子 / policy / CI / ACL / 金丝雀）
3. **[compliance-soft-layers.md](compliance-soft-layers.md)** —— ②③ 软约束与记忆（文档落位 / 模板 / review 清单 / 记忆硬化）
4. **[reference-snapshots-usage.md](reference-snapshots-usage.md)** —— 参考源码库三层递进用法（预制锚点 → 流程制度化 → 深用产出）
5. **[reference-snapshots-anchors.md](reference-snapshots-anchors.md)** —— 高价值快照锚点卡（查阅入口）
6. 调研背书：`docs/research/reference-snapshots-value-and-upgrade-necessity.md`

## 4. 实施原则（保留灵活性）

- 本文档集约束**行为与验收标准**，不锁死实现：钩子配置格式、脚本命名与归属、检测手段均可换等效方案，以「验收行为」为准；文内代码均为示意。
- **钩子贵在少而准**：只上事故级 / 用户明令级（当前恰好三条：只读目录、用户真档、--no-verify），避免拖慢常规调用、误伤正常操作。
- 门禁自身会腐烂（先例：#72 vmThreads 注释被证伪）——保留「金丝雀」巡检项：随机抽一条红线，验证门禁真的会红。
