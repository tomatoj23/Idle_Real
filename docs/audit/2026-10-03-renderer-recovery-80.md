# #80 rendererRecovery 实施与对抗复核

日期：2026-10-03
范围：本会话 `fbcc29f`、`8de657d` 及其后续修复；GitHub [#80](https://github.com/tomatoj23/Idle_Real/issues/80) 的 body 与全部三条原始票评。没有升级依赖、改变 engine/content 边界或扩展 preload 协议。

## 结论

原清零洞、隐藏回收分流、运行时 `still-running` 分类已实现。本轮继续修复了两个实证产品逻辑问题及测试保护缺口。最终工作树的聚焦测试 61/61、全仓 83 文件 / 1066 用例、四包查型均通过；真实 Electron 沙箱 8/8 场景通过；27 个独立变异均被实际 Vitest 断言击杀。此结论不等于所有可能事件序列已经穷尽。

原票的真实验收方法需要校准：普通 JS 初始化异常由 `src/main.ts` 的启动 catch 捕获，不等于 renderer 进程死亡。本次用真正的 `forcefullyCrashRenderer()` 验证 `dom-ready` 后进程死亡、实际 `render-process-gone`、三次重载预算和真实进程退出，未构造或修改用户坏档。

`dialog.showErrorBox` 在沙箱中被记录器替代，以免无人值守的原生模态阻塞。fatal API 调用、内容、日志与真实 `app.exit(1)` 已验证；**没有声称人工看到原生模态框**。因此原票字面上的“坏档抛错 + fatal 原生弹窗”未按原方法执行，不凭借等价自动化测试擅自勾选该项。

## 查证锚点

- 现役版本：`packages/app-desktop/package.json`、`node_modules/electron/package.json`、`electron.d.ts`、真实运行 `process.versions`，Electron 44.4.1 / Chromium 152.0.7977.78 / 内嵌 Node 24.21.0。验收 runner 使用 Node 24.13.0；Vitest 4.1.11；Vite 8.3.0。
- 本地快照：`D:/My_Projects/Reference_Documents/electron-main`，开发线 46.0，取档 2026-09-29，仅只读。它不是现役 44.4.1 的版本证据。
- 卡内锚点：`reference-snapshots-anchors.md` 的“崩溃 / 进程模型”“memory-eviction 锚点（#80）”“API 离线全集 / 行为溯源”。
- 卡外检索简报：问题为首次加载 Promise 与 renderer 死亡通知的先后顺序、Windows 窗口可见性和退出筛；入口为 `shell/browser/api/electron_api_web_contents.cc`、`lib/browser/api/web-contents.ts`、窗口原生实现与 Chromium `content/browser`；停止条件为定位实际拒绝、状态置位与通知链。早期本会话确实进行了宽搜索且未事先落盘简报，属流程偏离，不能用本条追记冒充事前留痕；后续现役结论改用精确官方版本源码与实测补证。
- breaking-changes / migration：不适用，没有升级依赖。

现役官方源码依据：

- [Electron v44.4.1 加载 Promise](https://github.com/electron/electron/blob/v44.4.1/lib/browser/api/web-contents.ts#L282-L373)。`did-stop-loading` 可以合成 Promise 层 `ERR_FAILED (-2)`；不意味着因此发出 `did-fail-load(-2)`。
- [死亡通知与加载停止](https://github.com/electron/electron/blob/v44.4.1/shell/browser/api/electron_api_web_contents.cc#L2241-L2262)。gone 异步发出，handler 内同步 reload 是受支持的用法。
- [真实加载失败入口](https://github.com/electron/electron/blob/v44.4.1/shell/browser/api/electron_api_web_contents.cc#L2326-L2369)及[导航终止分流](https://github.com/electron/electron/blob/v44.4.1/shell/browser/api/electron_api_web_contents.cc#L2571-L2585)。不能为了 crash 而全局忽略 `did-fail-load(-2)`。
- [Electron 的 libuv 调度](https://github.com/electron/electron/blob/v44.4.1/shell/common/node_bindings.cc#L1136-L1177)。`setImmediate` 跨过同步死亡通知栈，不要求它必晚于 Chromium gone task。
- [Chromium WebContents 状态置位](https://github.com/chromium/chromium/blob/152.0.7977.78/content/browser/web_contents/web_contents_impl.cc#L9998-L10011)。RenderProcessHost 与 WebContents 的死亡状态并非同一字段。
- [Windows 可见性](https://github.com/electron/electron/blob/v44.4.1/shell/browser/native_window_views.cc#L671)、[系统会话结束](https://github.com/electron/electron/blob/v44.4.1/shell/browser/native_window_views_win.cc#L407-L437)。最小化窗口 `isVisible()` 为 false；系统会话结束与正常 `app.quit()` 不是同一生命周期。

## 问题与处置

### 产品逻辑

1. **原 #80 清零洞**：每轮 `dom-ready` 无条件归零，使快速崩溃无限重载。现改为以 `dom-ready` 起算的 3000ms 稳定窗口；无 DOM 或短稳定期仍累计，前 3 次 reload、第 4 次 escalate。
2. **隐藏等待被误算稳定期**：隐藏回收 deferred 期间沿用旧 `loadedAt`，死后等待跨窗可洗回预算。`8de657d` 引入 `markUnstable()` 停止计时。
3. **`8de657d` 的反向回归**：只清 `loadedAt` 又抹掉了死亡前已经稳定满窗的事实；即使几次回收相隔数天也会终身累计、第四次误退。现将 `settleStability()` 用于 `decide()` 与 `markUnstable()`：先结算截至失效时已完成的稳定期，再清起点。死前满窗可恢复预算，死后等待不可。
4. **首次加载与恢复竞争**：`loadFile()` 的 Promise 可因 renderer 加载中死亡或 reload 引起的导航被中断，旧 catch 无条件 fatal，会绕过恢复预算。现标记 `initialLoadInterrupted`，Promise 兜底 `setImmediate` 后重新检查退出、销毁、已中断与 `isCrashed()`；真实主框架 `did-fail-load` 另走幂等 `failLoad`，仅排除子框架与 `ERR_ABORTED (-3)`，仍处理 `-2/-6` 等真实失败。
5. `still-running` 是运行时 converter 的额外值，显式 ignore 且不吃预算；真实 gone 路径的可达性仍未证实。隐藏 `memory-eviction` 幂等入队，窗口 show/restore 且可见时才消费。退出/销毁筛在原生可见性查询之前。

### 测试与申报

- 原新增接线用例在 `dom-ready` 后再次 crashed，已经清空起点，所以删除 `markUnstable()` 接线也能绿。已改为“crashed 两次，再 loaded，再隐藏回收”，独立变异能钉住接线。
- 非零 DOM 起点、3000ms 相等边界、死亡前稳定与死亡后等待两侧、独立回收不终身累计均有对照。
- handler 缺失空转断言、销毁后仍允许 native 查询的宽松假面已补强。
- 拒绝后同步登记等待 `setImmediate` 可能早于被测 catch 入队。统一 `finishDeferredLoad()` 先让 Promise 微任务入队，再等待延迟回调；修正跨用例回调污染，重新变异验证。
- 幂等不仅断言弹窗一次，还断言日志与 exit 一次；fatal 自身抑制第二个 dialog 不再遮蔽重复收尾。
- 上轮全仓数量申报 1043 有误，原始日志实际为 `465 + 268 + 61 + 250 = 1044`。本轮最终为 `465 + 268 + 61 + 272 = 1066`。
- 原失败的 `Audit recovery logic deeply` 本轮完整重派并返回，不以其他代理的重叠结论替代。验收代理的额度/runner 引号/fixture 抢跑失败如实记录；没有把未实际 crash 的 fixture 失败当产品失败。

## 验证

### 修复前后

命令：`npm run test -w @wendao/app-desktop -- tests/rendererRecovery.test.ts tests/main-wiring.test.ts`。

修复前实际 Vitest：51 用例中 9 失败 / 42 通过，捕获死前稳定期丢失、promise-first/gone-first 抢先 fatal、加载中退出/销毁误报。修复与补强后 61/61 通过。

原始验红日志：`C:/Users/023/.zcode/cli/exec/sess_5d429c3b-5270-40da-97e4-737c0472cacf/call_2BLVhN1SgCZ4Qm6yro8rol3E-stdout.log`。

### 最终门禁

- `npm run check`：四包通过。
- `npm test`：83 文件 / 1066 用例通过。
- `npm run policy`：P1/P3/P4 硬断言通过；P6 的 AGENTS “TS 7”既有 review 提示一条，本票未改该文件。
- `node scripts/policy-check.mjs --self-test`：70 项通过。
- `node scripts/hooks/pretooluse-guard.mjs --self-test`：176 项通过，脚本自测不冒充实际 hook 授信/拦截。
- `npm run lint`：169 文件，0 errors / 0 warnings。
- `git diff --check`：通过。

最后 check 原件：`call_OJ5HSNRSRTERVubTfnjvYFSB-stdout.log`；test 原件：`call_DfkSa8mjP8OxCG6t9wagfBtS-stdout.log`，同上主会话 exec 目录。

### 实际 Vitest 变异

全程只写新 shadow/scratch，无修改源仓实现或测试。每条还原影子文件，核对源与测试哈希。

rev1：58/58 基线和还原基线；20 断言 kill、6 survivors、1 非断言运行失败。证据保留在 `.scratch/recovery-80-mutations-20261003-uzVvGn/`。

rev2：61/61 基线和还原基线；**27 断言 kill、0 survivors、0 编译/解析/加载/非断言失败**，共 60 条失败断言。29 份真实 Vitest JSON，58 次 input-hash 核验全部一致。完整测试名、断言文本、源码位置、堆栈和逐条输出见 `.scratch/recovery-80-mutations-20261003-3dgRZx/failure-index.json` 与 `mutation-results.json`。

| # | 独立变异 | 失败断言数 |
|---|---|---:|
| 01 | markLoaded 无条件清零 | 8 |
| 02 | 重载上限 >= 改 > | 8 |
| 03 | 稳定窗口 >= 改 > | 6 |
| 04 | DOM 起点恒 0 | 2 |
| 05 | main 删除 markUnstable 接线 | 1 |
| 06 | markUnstable 只擦 loadedAt | 5 |
| 07 | main 时钟恒 0 | 3 |
| 08 | dom-ready 回调为空 | 3 |
| 09 | 删除 still-running ignore | 2 |
| 10 | 隐藏回收立即 reload | 3 |
| 11 | Promise fallback 改即时执行 | 1 |
| 12 | 删除 initialLoadInterrupted guard | 1 |
| 13 | 删除 isCrashed guard | 2 |
| 14 | 删除主框架筛 | 1 |
| 15 | 删除 -3 筛 | 1 |
| 16 | 全忽略真实 did-fail-load(-2) | 1 |
| 17 | 删除 failLoad 幂等 | 1 |
| 18 | recovery 删除 quitting guard | 1 |
| 19 | recovery 删除 destroyed guard | 2 |
| 20 | failLoad 删除 quitting guard | 1 |
| 21 | failLoad 删除 destroyed guard | 1 |
| 22 | gone 删除 quitting guard | 1 |
| 23 | gone 删除 destroyed guard | 1 |
| 24 | resume 删除 quitting guard | 1 |
| 25 | resume 删除 destroyed guard | 1 |
| 26 | Promise 删除 quitting guard | 1 |
| 27 | Promise 删除 destroyed guard | 1 |

限定：24、26 在“不 reload/不 fatal”语义上仍有下游保护；本次通过“不在退出/销毁后查询原生对象”的生命周期契约断言击杀，不捏造不存在的重载/退出路径。零 survivors 只针对这 27 个候选。

### 真实 Electron

全新临时根：`C:/Users/023/AppData/Local/Temp/smallrpg-recovery80-runtime-20261003-oA2zJc`。在导入实际 main 之前将 `userData/sessionData/crashDumps/logs` 全部重定向；清除 Steam 环境变量；没有修改用户真档或已装应用，没有用机器 OOM 做探针。

TS 编译与 Vite fresh build 全部输出到临时根，不复用 09-29 旧 dist。实际 BrowserWindow/webContents 与 `app.exit` 保留；仅 dialog 替换为记录器。

| 场景 | 证据与结果 |
|---|---|
| normal-ui | 实际现有开始按钮 click，2100ms 后修为 0→5、收功按钮；桥 flushSave ack=ok、loadSave 原串与沙箱磁盘字节一致；exit 0 |
| crash-loop | 4 次真实 forcefullyCrashRenderer / gone；reload [1,2,3]，第四次 fatal 调用一次，真实进程 exit 1；无 load failed 误报 |
| initial-death | 首次加载 Promise 仍 pending 时真实死亡；reload [1] 后加载完成，无 fatal，exit 0 |
| stable-reset | 5 次真实死亡，稳定窗口后预算为 [1,2,3,1,2]；exit 0 |
| missing-index | 确实缺失 index.html，实际主框架 -6 失败、fatal 调用一次，真实 exit 1 |
| close-loading | 首次加载中正常 close，exit 0、无 fatal |
| injected-hidden-eviction | 仅该 reason 注入，两次隐藏事件只延迟一次；其余 4 次进程死亡真实，预算 [1,2,3,1,2] |
| injected-still-running | 仅该 reason 注入，零额外重载；其余 4 次死亡真实，预算 [1,2,3,1] |

关键首载时序原件（相对毫秒）：DOM ready 216.766；真实 crash 调用 264.850；did-stop-loading 337.403 / isCrashed=false；Promise reject 337.832 / false；微任务 338.171 / false；setImmediate 341.006 / true；gone 341.496 / reason=crashed；随后 reload 1、加载完成、exit 0。实测直接证明即时 catch guard 不足，延后判定确实覆盖该竞争。

原始入口命令：`node D:/My_Projects/SmallRpg/.scratch/recovery-80-runtime-20261003-140513/runner.mjs`（第二轮脚本写入独立 `rev2/`）。每个编译与 Electron 子进程的 exact argv、PID、退出码、stdout/stderr 路径在 `rev2/commands.json`；全部场景 timedOut=false。

证据：`.scratch/recovery-80-runtime-20261003-140513/rev2/results.json`、`manifest.json`、各场景 `*.events.jsonl`。截图 `normal-ui.png` 为 1264×761、非空；主会话已查看，页面、按钮、运行状态正常，无白窗或明显布局遮挡。

浏览器首跑另用 `http://127.0.0.1:5197/` 独立来源，DOM 正常；两次 IAB 自动点击 actionability timeout，未把该交互计为通过。Electron 实际交互独立通过，开发服务已停止。

### 冻结 SHA-256

运行时编译前、编译后、全部场景结束与主会话当前源码一致。mutation rev2 对应同一产品码和最终测试：

| 文件 | SHA-256 |
|---|---|
| electron/main.ts | de971177413561a5abecb39ec25d45918d045b0f82fc917f80d95ca9e4294745 |
| electron/rendererRecovery.ts | e230ea22ef72f8fa0a3621a0441055f5f261bc42b288d9d3bcce5d1306b9c918 |
| tests/main-wiring.test.ts | 4ca31502e1489397e593db2d7dedd260eb0414be8d2dcef7fd7e330976d59a6d |
| tests/rendererRecovery.test.ts | 61fedec06d0b5f6129cb7e21a8baa5168b7c66fcbeb218119464e14d4ce51bef |
| 编译 main.js | 63e981197ce6df76df76464b3f2feb922f80ef59ffbac7d07f55393110140f61 |
| 编译 rendererRecovery.js | d39c88e9c1e9b8f47e17fb7c2f6d7048bae110b916e001c5f7e8773607da540b |
| fresh renderer assets/index-bsWFHu80.js | a227fc65194ed60a86a9db2121ec8d582f649aa68fd0e63fc68d5232ffb2afb0 |

原始 scratch 与 exec 日志为本地证据，不纳入 Git、不会删除其他会话产物。本报告记录可分享的关键信号与哈希，不把本地绝对路径说成 GitHub 可直接读取的附件。

## 独立复审与边界

### Standards

未发现硬规范违背。发现一项 P2 测试等待顺序问题，已用 `finishDeferredLoad()` 修复并经只读复核确认；没有新增代码气味建议需要落代码。该结果不替代 runtime/mutation。

### Spec

最终产品码规格复审 CLEAN：未发现新增实证可达产品 bug、缺项修复或 scope creep。原三项已修不重复计数；无法证实的旧/新 generation 事件交错不按真实运行 bug 计数。测试等待缺口已单独处理。

### 未声称完成的独立边界

- Windows shutdown/restart/logout 不发 before-quit，当前只靠 renderer beforeunload 和周期保存；没有执行系统关机/注销探针，属于关闭即保存保证的独立缺口/潜在丢进度风险。按事件正常送达且自动保存成功的前提，暴露约一个 15s 保存周期；不能无条件承诺任何环境“最多 15s”。应专项验证和裁决，不混进 #80 崩溃恢复。
- 取消 before-quit 后本地 quitting 不回滚：当前没有主动取消监听，不能报现存可达 P1/P2；未来增加退出取消时必须协调该标志。
- memory-eviction 的“reload 加剧压力→再次回收”仍是推断；本次未制造系统内存耗尽，也未取得完整 Chromium 内存回收实现链，隐藏延期是已裁决策略而非该循环的实测证明。
- `integrity-failure` 的官方含义是 Windows code integrity checks failed，不等于已经证明 asar 被动过。现有相关历史注释过窄；恢复分类不因本次发生变化，不把它当独立运行 bug。后续 #65 应一并校准 integrity/fuses 的说明。

## 交付与下一票

本次代码仅涉及 recovery/main 与对应两份测试，另补本报告及 ADR-018 落地指针。用户既有 `docs/agents/domain.md` 修改不纳入提交。未改钩子配置、全局配置、Reference_Documents、用户真档或发行安装目录。

在本次修复按正常门禁推送后，#80 补核销记录，但原票字面原生模态验收仍如实保留，未经裁决不自动关闭。

下一张现成实施票建议 **#65 Electron fuses 加固**：未认领，针对出货二进制默认 runAsNode/inspect/asar integrity 安全设置，优先于 #84 低优包装。实施时重新核对 electron-builder 实际键名和现役版本，并使用隔离出包/首跑，不能覆盖用户已安装应用。Windows 会话结束保存独立缺口先作为专项验证候选留在 #80 评论与本报告；#83 已认领，只有登录态表单验收未完，不抢占。
