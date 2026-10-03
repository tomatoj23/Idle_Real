# 机械门禁实施细则（层①）

> 上级索引：[compliance.md](compliance.md)。本文给**行为规格 + 验收标准**，实现可换等效方案；配置代码均为示意。

## 1. PreToolUse 钩子（三条，事故级 / 明令级）

钩子在工具调用前拦截，调用被 harness 否决——与模型服从无关。配置格式以本 harness 实际 hooks 配置为准（可查 `zcode-guide:diagnosing-hooks`）。

### 钩子 A：Reference_Documents 只读（用户明令）

- **拦截**：Write / Edit 目标路径落在 `D:\My_Projects\Reference_Documents\` 下；Bash 命令对该目录有写效应（重定向、`mv`/`cp` 进入、`rm`、`touch`、`sed -i`、git/npm 等落盘工具在其内执行）。
- **放行**：纯读命令（`ls` / `grep` / `cat` / `head` / `find` 等）。
- **拒绝文案**：注明「用户明令：该目录严禁改动，只许读」，让模型收到明确反馈而非裸报错。
- **验收**：对拦截面工具（四臂 Bash / Write / Edit / ApplyPatch + MCP `mcp__node_repl__js`，见「范围声明」）试写该目录下一文件 → 必被拒；试 `ls` → 必放行。

### 钩子 B：拦字面指向用户真档的写/删命令（2026-09-29 删档事故教训）

- **拦截**：工具调用命令文本 / 文件写路径**字面**命中用户真档落点（`app.getPath('userData')` 的运行时落点，Windows `%APPDATA%` 下本游戏目录；三形态共用一档）。重点拦 `rm -rf` / 覆盖写——09-29 事故即字面 rm 形态。
- **能力边界（勿高估）**：PreToolUse 只见工具调用文本，`npm test` 起的测试进程**内部**写盘不可见——「测试不动真档」的普遍保证由 P4 字面量断言 + 测试沙箱注入（`userDataDir: tempRoot()` 先例）承担，钩子只防事故形态。命令文本匹配亦可被计算路径绕过，属蓄意，交 review / CI。
- **豁免**：真实游戏进程的正常存档写入不在拦截面；误伤用显式白名单加注释放行，勿整体关掉。
- **验收**：模拟事故原命令（字面 rm 指向真档）→ 必被拒。

### 钩子 C：禁 `--no-verify`

- **拦截**：`git push --no-verify` / `git commit --no-verify`（含等价短选项）。
- **验收**：试推带 `--no-verify` → 必被拒；正常 push 走 pre-push 全量 check+test 不受影响。

### 通用要求

- **范围声明**（#85 校准，如实勿高估）：
  - **拦截面 = 四臂 + MCP**：Bash / Write / Edit / ApplyPatch 的工具调用文本；MCP 已扩 `mcp__node_repl__js`（**A/B 面**：code 按包装层文本判定——强字面量 + 写信号，不求完备）。其余工具（Read / Grep / Agent / NotebookEdit 等）不在拦截面。
  - **B/C 面是「主会话工具调用面」**：**子代理会话零 hookRunner，属结构性旁路**（配置层不可修）——**涉受保护路径的作业勿派子代理**；子代理旁路与人类终端同类，交 review / CI 兜底。A 规则另有 OS 级 ACL 保险盖住该旁路（§4）。
  - **人类自己终端**里的 `git push --no-verify` 拦不住，那个面由 CI 兜底。
  - **编码类绕过**（`powershell -EncodedCommand` 等 base64 载荷）与计算路径绕过、8.3 短名同类，**归计算路径豁免但写明**：文本面看不见，写明不等于支持，交 review / CI。
  - **C 规则范围 = push/commit 显式声明**：`git am / merge / rebase --no-verify` 属范围外（非交付门禁语义）；`git push -n` 是 dry-run 不是绕过。
- 拒绝时输出**可行动的反馈**（哪条规则、来源、正确做法，走 exit 2 + stderr 或 deny 决策），符合「hook 输出按用户反馈对待」。
- 三条之外不加钩子，除非再出事故或用户新明令（元规则 2）。

### 实现事实与已知坑（harness 钩子机制，2026-09-29 查证）

- 配置落点二选一：用户级 `~/.zcode/cli/config.json` 或工作区 `<repo>/.zcode/config.json`。配置文件钩子**默认不跑**，必须设 `hooks.enabled: true`。
- **Windows 下优先 `type: "process"`**（参数数组不经 shell）：`command` 型走 shell，POSIX 语法在 win32 直接挂。
- matcher 匹配工具名、大小写敏感（`Bash`≠`bash`）。语义**按形态二分**（#85 harness 源码核证）：matcher 串若为纯字符集 `[a-zA-Z0-9_|]`，按**精确表**处理（`split("|")` 后与工具名全等匹配，`Bash|Write|Edit|ApplyPatch` 即四名精确表）；含其余字符才落正则分支，**无效正则静默永不匹配**。`Write`/`Edit` 有 `ApplyPatch` 别名。
- 拦截靠 exit 2（PreToolUse 可返回 allow/ask/deny 决策）；`command` 型 `timeout` 单位是**秒**、`process` 型 `timeoutMs` 是毫秒。
- 钩子 stdin 为 Claude 兼容 JSON 单行（`tool_name`/`tool_input`/`cwd`/`hook_event_name`…，兼有 camelCase 同名字段）；放行 = exit 0 静默，拒绝 = exit 2 + stderr（stderr 文本即 deny 理由，回给模型）。

### 落地形态（#81 实施记录，2026-09-29）

- **落点（用户裁决）**：工作区 `<repo>/.zcode/config.json`，随仓库入库；单条 `PreToolUse` 钩子（matcher `Bash|Write|Edit|ApplyPatch|mcp__node_repl__js`，#85 起含 MCP 臂）调 `node ${ZCODE_PROJECT_DIR}/scripts/hooks/pretooluse-guard.mjs`（`${ZCODE_PROJECT_DIR}` 在执行时展开，配置可机器无关）。**钩子只落工作区级，严禁落用户全局 `~/.zcode/cli/config.json`（2026-09-29 用户明令）**——git 侧同理（`core.hooksPath` 属仓库级配置）。
- **脚本**：`scripts/hooks/pretooluse-guard.mjs`——规则 A（Reference_Documents 只读）/ B（用户真档 `%APPDATA%\问道长生` 等 userData 落点）/ C（git push/commit `--no-verify`：含短选项簇 `-n`、长选项前缀缩写 `--no-v*`、`core.hooksPath`/`alias.*`/`git config` 写形态配置旁路）。拒绝文案含规则来源与正确做法；运行时异常 fail-closed 保守拒。金丝雀自测：`node scripts/hooks/pretooluse-guard.mjs --self-test`（#85 /fh 复核后 176 项全绿；用例数量以自测输出为准，勿在散文里手工维护），已接线 pre-push + CI（#85 F1）。
- **工作区钩子的 trust 准入门（关键维护事实）**：工作区配置的钩子受授信态机管制——`pending_trust` 时**静默不跑**（正是「门禁空转」形态）；授信后 `trusted_persistent` 持久生效。**改动 `.zcode/config.json` 的钩子声明会使 digest 变化 → `stale_digest` 复锁，必须重新授信**（改脚本内容不影响授信）。命令：
  ```sh
  node "C:/Program Files/ZCode/resources/glm/zcode.cjs" hooks trust status --workspace . --json
  node "C:/Program Files/ZCode/resources/glm/zcode.cjs" hooks trust grant --workspace . --all-current --bundle-digest <sha256>
  ```
  （`zcode` CLI 隐藏命令面；也可用 UI 的 Workspace Hook review 弹层授信。）
- **会话宿主差异（现象记录，未留证）**：桌面/TUI（app-server 协议会话）会跑工作区钩子；无头 `zcode -p` 不装配工作区钩子（钩子进程根本不拉起，也无跳过诊断）——活体验收走 app-server/desktop 会话。（#85 复核：此条缺留存证据，按票面降级为「现象记录（未留证）」；复现留证随下次活体验收补。）
- **验收记录（2026-09-29）**：两轮活体实证（app-server 探针会话 + 用户新会话 `sess_1a82cdd8` 复验 8/8）——规则 A/B/C × Bash/Edit/Write 全臂实拦（含 09-29 事故原形态 `rm -rf "$APPDATA/问道长生"` 与票面「试写一文件」形态），放行面（ls/grep/正常 push/良性 Write）正常，拒绝文案含规则来源与正确做法；事后零残留、真档完好。
- **已知边界**（#85 复核后如实清单；/fh 对抗审计后补）：管道间接目标（`find … | xargs rm`）、计算路径绕过、编码类绕过（`-EncodedCommand` base64 载荷）、8.3 短名（`MY_PROJ~1\REFERE~1`，需文件系统查询才能归一）、测试进程内写盘均不在拦截面（前四者属蓄意豁免交 review/CI，最后者由 #82 P4 + 测试沙箱承担）；包装层（`powershell -Command` 等）与 heredoc 体、`mcp__node_repl__js` code 均按强字面量+写信号文本判定，非完备（node/python 包装里 `exec('rm …')` 字符串间接同归计算/间接豁免）；`bash -c` 尾随实参（`$1` 形态）仅在 -c 体含写信号时按写目标判，纯读体不判；转义引号字面形态（`rm -rf \"path\"`）按「反斜杠字面」政策不判——bash 语义下该形态本就打不中真路径；git 混合语义子命令（branch/remote/stash 的写形态）不进写面（写的是快照 .git 内部件，读写同名难分，粗判伤读快照）；`git config --unset core.hooksPath` 保守拒（断钩=旁路；修复正路是 `npm run setup` 钩子自愈，不走字面 config）；写信号的 `>` 重定向启发式对紧凑比较（`a>b`）仍有误伤残留；B/C 面不含子代理会话（结构性旁路，见「范围声明」）。

## 2. policy 脚本（显式两处接线：pre-push + CI，#82 已实施）

建议 `scripts/policy-check.mjs`（命名可换）。**接线必须显式两处**：`.githooks/pre-push` 与 `.github/workflows/ci.yml` 各加一步——两处现跑 `npm run check --workspaces --if-present`，走的是各 workspace 自己的 check、**不经根 package.json 的 check**，挂根脚本不会生效（2026-09-29 复核实证）。断言清单初稿：

| # | 断言 | 检测思路（示意） |
|---|---|---|
| P1 | engine 源码无平台全局**直接引用** | 识别裸标识符 / 成员访问；排除注释、字符串字面量、属性键（`g['setInterval']`）、声明名——基线实证：禁词词面在 engine/src 的命中全是合规用法（`localStorageSaveAdapter` 标识符、接口形状、save.ts 注释），裸词表必误报；命中计数随代码漂移，复核以 policy 金丝雀为准勿写死。只对源码、不对测试 |
| P2 | 从 globalThis/window 解构原生方法处有 bind | 弱检测即可（如匹配「解构后存函数值」模式），无法判定的交 review，勿追求完备 |
| P3 | schema 无 `$defs` | 扫 `packages/content/src/schema/**` 与 packs JSON |
| P4 | 测试代码不含真档路径字面量 | 模式 = 真实绝对路径 / `%APPDATA%` 写形态；**勿扫裸 `userData`**（`userDataDir: tempRoot()` 这类无害沙箱注入遍地是）；真档落点经 `app.getPath('userData')` 运行时解析，此断言防呆不防恶 |
| P5 | docs/research 引用快照带取档标注 | 抽查含 `Reference_Documents` 的文档须同时出现取档日期字样 |
| P6 | AGENTS.md 无时点版本数字 | 粗粒度正则即可，命中转 review 不硬失败亦可 |

- **原则**：宁可漏报不误报——误报会诱使后人加豁免，比漏报更伤。每条断言配一条「如何变红」的自测说明（金丝雀用）。
- **分批落地**：P1/P3/P4 先上（确定性高），P2/P5/P6 随后——已按此落地：P1/P3/P4 硬性，P2/P5/P6 review 级（只提示不阻塞），见下。

### 落地形态（#82 实施记录，2026-09-29）

- **脚本**：`scripts/policy-check.mjs`（零依赖纯 node）。P1/P3/P4 命中 = 硬失败（exit 1）；P2/P5/P6 命中 = review 级提示（不阻塞，即「命不准转 review」）。断言精度按上表落地，三处细化：
  - P1 五类排除（注释/字符串/属性键/声明名/接口·类型块）之外补「成员访问属性位」判定：**探测根**（globalThis/window/self/global）上的属性访问仍算直接引用（`globalThis.setTimeout` 形态），**本地对象**上的同名成员（`timer.setInterval` 绑后调用）放行。词表刻意不含 location/history/alert 等短词（与领域词撞名，宁可漏报）、console（双端标准对象，解构面归 P2）、fetch/crypto 等双端共有对象。
  - P3 扫 `packages/content/src/schema/**` 与 `packages/content/src/packs/**` 全部文件（含 .ts——TS 里拼出的 schema 字符串同样是使用面）；.ts 掩蔽注释（「勿用 $defs」的提醒不误伤），JSON 全文扫（键即字符串）。
  - P4 只认真档落点族（`%APPDATA%` 族 / `AppData\Roaming` 绝对形态 / Roaming\<游戏目录> / macOS/Linux userData 落点 / `process.env.APPDATA`），分隔符取 `[\\/]+`（JS 源码转义双反斜杠形态不漏）；**不扫裸 `userData`**。
- **接线（显式两处，缺一即门禁空转）**：`.githooks/pre-push`（policy → 守卫金丝雀 → check → test，policy 先行快失败）；`.github/workflows/ci.yml`（checkout 后、Install 前各一步——零依赖，违规不必等装依赖才变红）。根 `package.json` 的 `npm run policy` 只是人手便捷入口，两网不依赖它。
- **豁免纪律**：文件内注释 `policy-allow: P<n> <理由>`（理由必填；**只认注释形态**，字符串/模板里的 policy-allow 不算豁免；无理由的豁免行被忽略并提示）。首个豁免：`scripts/hooks/pretooluse-guard.test.mjs`（#81 金丝雀的真档路径字样=模拟用例数据，非写盘）。
- **金丝雀**：`node scripts/policy-check.mjs --self-test`（70 项：deny 35 + allow 29 + e2e 4 + pragma 2，2026-09-29 对抗审计后扩编）；e2e 在 `os.tmpdir()` 临时 fixture 树上跑 `runCheck`（违规树必红、干净树必零报），不改真源码。
- **对抗审计加固记录（2026-09-29 /fh 全维度复核）**：自查+对抗子代理实锤 3 个硬 bug 已修——①词法失步：正则字面量内的引号被当字符串开界（`/['"]/`），误报（字符串内容当代码报）+漏报（其后代码整段被抹）双向；修法=正则字面量态（除法歧义偏「正则」方向）+ 字符串/正则行尾恢复。②声明名误报：类/对象方法、访问器、无类型形参、catch 绑定、解构默认值全类排除（定义位判据 = `W(…)` 后跟 `{`/`:`；形参绑定判据 = 形参表模式位）；连带补上 `f(a, document, b)` 逗号位的既有漏报（原简写规则过宽误豁免）。③type 跳过区逃逸：`type Alias = number`（无 `;` 的 ASI）曾跨界吞掉后续语句的花括号块藏违规；修法=块首扫描遇语句界（空行/语句关键字）即停。另补：三元值位/case 值位/展开运算符/模板 `${…}`/`globalThis?.X` 的引用位识别、P4/P5/P6 大小写与 IP 边界（`127.0.0.1` 不是版本号）、同文件同规则同行合并单条。
- **如何变红（巡检抽测用）**：
  - P1：往 `packages/engine/src` 加 `setTimeout(() => {}, 0);` → 硬失败；
  - P3：往 `packages/content/src/schema/*.json` 加 `"$defs": {}` → 硬失败；
  - P4：往任一 `tests/*.test.ts` 加含 `%APPDATA%\问道长生` 的字面量 → 硬失败；
  - P2：往 `packages/*/src` 加 `const { setTimeout } = window;`（不 bind）→ review 提示出现；
  - P5：新建 `docs/research/*.md` 写 `Reference_Documents` 引用但不带日期 → review 提示出现；
  - P6：往 AGENTS.md 写 `vite 8.3.0` → review 提示出现；
  - 反向（误伤面）：金丝雀 ALLOW 组 = 基线合规形状清单（`g['setInterval']` 探测、接口方法签名、属性键、解构重命名、`timer.setInterval`、裸 `userDataDir: tempRoot()`、`file:///C:/…` URL 夹具、`moduleResolution: node10` 等），跑翻红 = 检测面变宽误伤，比失效更伤；DENY 组翻绿 = 门禁失效（同 #81 金丝雀协议）。
- **已知边界（如实声明）**：P2 只认静态解构/成员抽取形态，探测别名（`g['名']`）与 bind 后使用不进检测面；P4 防呆不防恶（`app.getPath('userData')` 运行时解析、拼接构造的路径都看不见）；P5/P6 粗正则只提示，P5 仍只粗检日期（#83 将完整「快照名 + 内部版本 + 取档日期」标注落入票模板，由 review 核对，不扩大本规则检测面）；AGENTS.md「现役 TS 7」是 P6 的常驻 review 提示（时点数字的已知在案形态，处置随 review）。P1 残余（宁可漏报方向）：同名遮蔽引用不识别（局部变量叫 `document` 的引用面照报——engine 命名纪律兜底，勿用禁词做局部名）；CR-only 行结束符的注释掩蔽不识别（本仓 CRLF/LF 不受影响）。

## 3. 守卫测试（可选替身）

若不想引入脚本层，同一批断言可用 vitest 写成「守卫测试」（读文件断言，失败即测试红）。与既有「协议守卫」同类。二选一即可，勿双份维护。

## 4. OS 级 ACL（A 规则最强保险，#85 裁决 2 已启用）

`icacls` 对 `D:\My_Projects\Reference_Documents` deny-write——连钩子被绕过、裸进程直写、**子代理会话旁路**都拦。代价：将来新增快照要临时改权限。**状态：已启用**（2026-09-29 观测现状两条 deny：`Everyone:(OI)(CI)(DENY)(W,D,WDAC,WO)` + 容器级 `Everyone:(CI)(DENY)(S,DC)`）。**icacls 属系统级变更，agent 严禁代跑，执行归用户**。放权/收权标准命令（各一行）：

- 放权（新增快照时临时）：`icacls "D:\My_Projects\Reference_Documents" /remove:d Everyone /t`
- 收权（入库后收回，**两条 deny ACE 一条命令全重建**，ACE 参数带引号——PowerShell 下括号逗号是元字符，不加引号报「参数列表中缺少参量」）：`icacls "D:\My_Projects\Reference_Documents" /deny "Everyone:(OI)(CI)(W,D,WDAC,WO)" "Everyone:(CI)(S,DC)"`（收权后用 `icacls "D:\My_Projects\Reference_Documents"` 核对恢复观测现状两条）

## 5. CI 与金丝雀

- CI（windows-latest）与 pre-push 跑同一组门禁（#85 起：policy + 守卫金丝雀 + check + test）：policy 与守卫金丝雀都是**显式两处接线**（pre-push 与 workflow 各一步），不是「挂根 check 自动双网」——两网的 check 走 `--workspaces` 不经根脚本（#82 复核实证）；`scripts/` 非 workspace、npm test 结构上够不到，守卫金丝雀不接线则失效静默（#85 F1，#81 过程发现 4 的欠账）。CI 是第二环境执行面，两处执行痕迹可观察（pre-push 输出 + workflow 步骤日志）。
- **金丝雀巡检**（并入 ADR-018 巡检条目）：每次巡检从 P1 / P3 / P4 硬性红线中随机抽 1 条，在临时沙箱构造违规确认 policy 断言会红；P2 / P5 / P6 若另行抽测只验提示，不误要求硬失败。钩子活体验收另行安排，脚本自测不证明主会话已装配钩子；门禁连续 2 次巡检未被抽测视为欠账。
