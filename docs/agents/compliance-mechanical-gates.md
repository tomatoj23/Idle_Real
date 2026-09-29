# 机械门禁实施细则（层①）

> 上级索引：[compliance.md](compliance.md)。本文给**行为规格 + 验收标准**，实现可换等效方案；配置代码均为示意。

## 1. PreToolUse 钩子（三条，事故级 / 明令级）

钩子在工具调用前拦截，调用被 harness 否决——与模型服从无关。配置格式以本 harness 实际 hooks 配置为准（可查 `zcode-guide:diagnosing-hooks`）。

### 钩子 A：Reference_Documents 只读（用户明令）

- **拦截**：Write / Edit 目标路径落在 `D:\My_Projects\Reference_Documents\` 下；Bash 命令对该目录有写效应（重定向、`mv`/`cp` 进入、`rm`、`touch`、`sed -i`、git/npm 等落盘工具在其内执行）。
- **放行**：纯读命令（`ls` / `grep` / `cat` / `head` / `find` 等）。
- **拒绝文案**：注明「用户明令：该目录严禁改动，只许读」，让模型收到明确反馈而非裸报错。
- **验收**：对任意工具试写该目录下一文件 → 必被拒；试 `ls` → 必放行。

### 钩子 B：测试 / 脚本禁写用户真档（2026-09-29 删档事故教训）

- **拦截**：命令或文件写路径命中用户真档落点（Windows `%APPDATA%` 下本游戏 userData 目录；三形态共用一档，见存档世界分布记忆）。重点拦 `rm -rf` / 覆盖写。
- **豁免**：真实游戏进程的正常存档写入不在拦截面（只拦「开发 / 测试 / 调研会话中的工具调用」）；若误伤，用显式白名单命令加注释放行，勿整体关掉。
- **验收**：模拟事故原命令（rm 指向 userData）→ 必被拒。

### 钩子 C：禁 `--no-verify`

- **拦截**：`git push --no-verify` / `git commit --no-verify`（含等价短选项）。
- **验收**：试推带 `--no-verify` → 必被拒；正常 push 走 pre-push 全量 check+test 不受影响。

### 通用要求

- 拒绝时输出**可行动的反馈**（哪条规则、来源、正确做法），符合「hook 输出按用户反馈对待」。
- 三条之外不加钩子，除非再出事故或用户新明令（元规则 2）。

## 2. policy 脚本（串进 `check`，一次接入三网）

建议 `scripts/policy-check.mjs`（命名可换），挂进根 `check` 之后即自动获得 **pre-push 钩子 + CI** 双执行面（现有链路零改动）。断言清单初稿：

| # | 断言 | 检测思路（示意） |
|---|---|---|
| P1 | engine 源码无平台全局名 | 扫 `packages/engine/src/**` 禁词表（localStorage/document/window/setInterval…），注意只对源码、不对测试 |
| P2 | 从 globalThis/window 解构原生方法处有 bind | 弱检测即可（如匹配「解构后存函数值」模式），无法判定的交 review，勿追求完备 |
| P3 | schema 无 `$defs` | 扫 `packages/content/src/schema/**` 与 packs JSON |
| P4 | 测试代码不含用户真档路径字面量 | 扫 `**/*.test.*` / 测试 helper 禁词（APPDATA、userData 真实落点） |
| P5 | docs/research 引用快照带取档标注 | 抽查含 `Reference_Documents` 的文档须同时出现取档日期字样 |
| P6 | AGENTS.md 无时点版本数字 | 粗粒度正则即可，命中转 review 不硬失败亦可 |

- **原则**：宁可漏报不误报——误报会诱使后人加豁免，比漏报更伤。每条断言配一条「如何变红」的自测说明（金丝雀用）。
- **分批落地**：P1/P3/P4 先上（确定性高），P2/P5/P6 随后。

## 3. 守卫测试（可选替身）

若不想引入脚本层，同一批断言可用 vitest 写成「守卫测试」（读文件断言，失败即测试红）。与既有「协议守卫」同类。二选一即可，勿双份维护。

## 4. OS 级 ACL（可选最强保险）

`icacls` 对 `D:\My_Projects\Reference_Documents` deny-write——连钩子被绕过、裸进程直写都拦。代价：将来新增快照要临时改权限。仅在「钩子被绕过过一次」或用户要求时启用。

## 5. CI 与金丝雀

- CI（windows-latest）已跑与 pre-push 相同的 check+test：policy 进 check 后自动成为第二环境回归网，无需改 workflow。
- **金丝雀巡检**（并入 ADR-018 巡检条目）：每次巡检随机抽 1 条红线，人为构造违规确认门禁会红；门禁连续 2 次巡检未被抽测视为欠账。
