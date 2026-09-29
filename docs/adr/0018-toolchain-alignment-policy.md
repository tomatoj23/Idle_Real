# ADR-018: 工具链版本对齐策略与 Electron 38 暂持的风险接受

日期：2026-09-16
状态：已接受（grilling 十问裁决；证据与对抗复审：`docs/research/version-drift-impact.md` + `version-drift-impact-round2.md`）

## 背景

2026-09-16 两轮版本漂移调研钉死三件事实：①本仓受 AI 训练数据滞后影响的方向与直觉相反——TS 7.0（Go 原生编译器）已是 npm latest，风险在「AI 按 5.x 旧知识改代码」而非仓库落后；②`npm audit` 1 critical（happy-dom 18）+ 2 high 全落现行 pin；③git 钉龄考古证明 electron 38 / happy-dom 18 两条停更线都是 2026-09 上旬「新鲜选型时刻」入伙的——伤害发生在选型瞬间，不在落后过程中。

## 决策

1. **当期对齐 = 小步**：happy-dom 18→20 + Vite 8.3.0（#64）、Electron fuses 加固（#65）、app-desktop 测试入 tsc 查型（#66）；Electron 38.8.6 暂持 → 升 44.4.1 = #67（触发：对外发版前硬门槛；无发布计划则 UX 批 #34–#38 收口后立即）；Vitest 5 观望 = #68。
2. **持续策略 = 事件驱动 + 周期巡检，反对「随时对齐」**：
   - 选型时：新依赖先查维护状态与 GA 时长（`npm view <pkg> time --registry=https://registry.npmjs.org`），停更线不进 package.json；
   - 巡检：每特性批收口（或季度）跑 `npm outdated` + `npm audit` + Electron 支持窗口核对；
   - 插队触发：现行 pin 出 critical/high 通报、或滑出 Electron 官方三版本支持窗口 → 升级票插到对齐档位；
   - 大版本观望：非安全驱动的大版本等 GA 满 2–3 个月（或 .1 patch）。
3. AGENTS.md 增工具链校准节，**只写不随版本腐坏的纪律**；时点事实（版本数字、audit 基线）以调研文档与票为单一来源，不在 AGENTS.md 复制。

## 理由

训练数据滞后使「最新」反而覆盖最差（Vitest 5 GA 13 天覆盖≈0），甜点区是「GA 2–3 个月 + 活跃维护」；「随时对齐」会制造它要防的知识漂移，且 Electron 每 minor 都是新版 Chromium 测试面、升级打断特性工作。

## 后果

- ~~Electron 38.8.6 暂持 = **有意识接受** 19 条 GHSA 在案（最高 8.1，context isolation 绕过 7.5 与本仓 contextBridge+沙箱形态相关；缓解：本地 file:// 内容、无远程加载、window.open 全 deny）。复评触发 = #67，不得无票延长。~~ **已解除（2026-09-29，#67 交付）**：升级即清账，19 条 GHSA 归零；上述缓解措施（本地内容、window.open 全 deny）在升级后仍然有效，不因清账而撤。
- ~~永久残留：extract-zip 两条 8.1（range=`*` 无修复版，安装/打包期影响面），升 Electron 亦不消除——audit 非绿不阻断验收。~~ **勘误（2026-09-29，#67 交付实证）：此条被证伪。** electron 44.x 起不再依赖 `extract-zip`，改用自带的 `@electron-internal/extract-zip`（活跃维护）——升级后 extract-zip 整体退场，`npm audit` 归零（0 vulnerabilities），连「预留残留」都不必留。凡断言「无修复版的永久残留」，先确认该依赖是否仍是升级后依赖树的成员。
- happy-dom 18→20 落地后 4 处 workaround 注释需同步复核（#64 验收项）。

## 落地记录

- **#67 已交付（2026-09-29）**：Electron 38.8.6 → **44.4.1**（精确 pin），暂持解除，19 条 GHSA 清账（`npm audit` = 0 vulnerabilities，比票面预期更彻底——连 extract-zip 预留残留也没了，见上勘误）。票面六项验收逐条实证：
  1. **真机首跑回归**：NSIS 实装版与 portable 版双路 CDP 冒烟全通——`window.wendao` 桥五面齐（mode/loadSave/writeSave/flushSave/reportAchievement）、`sandbox: true` 真实生效、UI 起台（`#page-root` 在、正文非空）、内嵌 Chromium 152 实证（真机 UA）。
  2. **electron-builder × Electron 44 端到端出包并实装**：NSIS（oneClick）+ portable 两 target 出包成功，NSIS 静默实装到 `%LOCALAPPDATA%\Programs\`（注册表 DisplayIcon 指向装好的 exe）后实跑冒烟；portable 自解压到 `%TEMP%\<随机目录>` 后实跑冒烟（清进程按解包目录+CDP 端口匹配，收工复核余 0）。`@electron/rebuild` 对 steamworks.js 干净通过。
  3. **steamworks.js 加载冒烟**：原生模块在 Electron 44（ABI 149）下**成功加载**——真机 `init()` 抛的是 steamworks 自有错误「Cannot create IPC pipe to Steam client process. Steam is probably not running.」（缺 Steam 客户端），不是模块装载错，反证 N-API 按平台 prebuild 免重编译的推断成立。成就上报与云存档走 mock 回落路径实证：成就落本地账本 `achievements.json`、存档槽位写读回环 ack=`ok`，回落有日志可审计（`adapter=mock (steam init failed…)`）。
  4. **42 起 postinstall 不再下载二进制**：install 后 `node_modules/electron/` 无 `dist/`、无 `path.txt`（且 44.x 的 package 无 postinstall 脚本）；首跑 `npx electron --version` 打印「Downloading Electron binary...」并生成**新的** cache 条目=真走网络而非吃本地缓存，随后 `dist/` + `path.txt` 落位。**对 CI/装机流程的含义：装完依赖不等于装好 Electron，必须留一步首跑。**
  5. **audit**：electron 19 条 GHSA 全清；extract-zip 预留残留也一并消失（超出预期）。
  6. **fuses 随包复验**：不适用——#65 尚未合入（见下）。

  **升级唯一类型漂移**：`render-process-gone` 的 reason 新增 `memory-eviction`，`GoneReason` 并集补员（tsc 在 `decide(details.reason)` 装配点报错兜住，非人眼）。分类裁决为**走重载**（内存回收摘掉渲染进程不是应用过错，白窗永挂正是 rendererRecovery 要消灭的病；吃同一份 RELOAD_LIMIT 预算），已用测试钉住并做变异验红。
- **#65 fuses 未随行**：本票按票面范围只做版本升级；fuses 是独立票（`electronFuses` 关 runAsNode + 开 asarIntegrity），仍待实施。
