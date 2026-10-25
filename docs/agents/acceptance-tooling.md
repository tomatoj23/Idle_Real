# 验收工装：变异验红 runner 与 Electron 真机验收 harness

> 票 #86（2026-10-24 retro 批）把 #80 会话在 `.scratch/` 一次性搭的两套验收工装升格入库。
> 两项纪律本身（测试头注「变异对照…别信『测试在场』」、真实浏览器/Electron 首跑红线）见
> AGENTS.md 工程红线；本文只写工装的调用法与适用时机。

## `scripts/mutation-check.mjs` —— Vitest 变异验红 runner

**适用时机**：改了有「变异对照」头注的测试所保护的实现后，交付前验红——证明这组测试
对拟定的变异**真的会红**，而不是「测试在场」的假庇护。变异集由实施会话按目标测试头注
的「变异对照」段**逐票拟定**（`scripts/mutation-sets/renderer-recovery-80.mjs` 是 #80 的
示例集，不是缺省集）。

**调用法**：

```bash
node scripts/mutation-check.mjs --set scripts/mutation-sets/renderer-recovery-80.mjs
node scripts/mutation-check.mjs --set <变异集.mjs> --filter <id 正则>   # 子集调试用
node scripts/mutation-check.mjs --self-test                             # 分类器合成用例自检
```

两脚本的 `--self-test` 是操作者前置自检（纯逻辑合成用例），**有意不接** check/pre-push 门禁
——两工具的验收口径是实跑，分类器/判定器的意图钉在 self-test 用例里，接入回归只会复制同一批
用例钉住同一份意图（2026-10-25 审计裁量）；将来确要接入，唯一可接受形态是 CI 加步，属门禁
构成变更须另票，不得进 pre-push/check。

变异集是 ESM 数据模块（default export）：`name` / `packageDir` / `tests`（相对 packageDir，
shadow vitest 的 include）/ `inputs.dirs` + `inputs.files`（仓库相对，进快照）/
`mutations[]`（`id` / `path` / `before` / `after` / `note`；`before` 必须在目标文件恰好出现一次）。

**行为与产出**：不动真源码——快照全部输入到报告目录 `snapshot/`，`shadow/` 内镜像还原 +
桩 package.json + 生成 vitest.config.mts（include=变异集 tests、cache false），逐条应用变异跑
真 Vitest，按 `assertion-killed`（测试承重）/ `survived`（断言空转，补例或撤变异）/
`compile-or-load-error` / `non-assertion-failure` / `execution-error` / `incomplete-suite-error`
分类。报告目录（缺省 `.scratch/mutation-check-<时标>/`）落盘 `mutation-results.json`
（含 summary 与最终 git tracked 文件对账）、每条变异的 vitest JSON / stdout / stderr /
mutation hash、每次运行前后的 source hash 核验（setup 即验锚点，源码漂移逐条点名，不烧完才炸）。

**已知坑（原型实测吸收）**：
- 根 `tsconfig.json` 是 solution-style：被 references 的包 tsconfig 必须进快照，否则 vite 的
  tsconfig 解析链报 `TSCONFIG_ERROR`（runner 已自动收编，自定义 inputs 时留意同类传递依赖）；
- shadow 根 `package.json` 必须是桩——真根 package.json 的 workspace 语义会串场；
- 锚点写法对 CRLF/LF 敏感：runner 已做 EOL 自适应（before/after 对称），变异集里用 `\n` 写即可；
  `after` 里的 `$&`/`$1` 按字面落盘（函数形替换），不会被解释成替换模式；
- 报告目录必须在仓库树内（`.scratch/` 已 gitignore）——shadow 靠祖先 node_modules 解析依赖，
  不复制不安装；`--out` 越树/越盘符会被前置拒绝。

## `packages/app-desktop/scripts/electron-acceptance.mjs` —— Electron 真机验收 harness

**适用时机**：改了 electron 壳层（main / rendererRecovery / fatal / preload / 窗口生命周期）
或 renderer 启动路径后，交付前的真机面验收。「真实浏览器首跑」红线在 Electron 侧的机械
执行面：真进程、真 `forcefullyCrashRenderer()`、真 `app.exit`、真事件时序；vitest+happy-dom
冒烟（`main-wiring.test.ts` 等）不能替代它，它也不能替代 UI 冒烟的覆盖面。

**调用法**：

```bash
node packages/app-desktop/scripts/electron-acceptance.mjs                    # 全部 8 场景
node packages/app-desktop/scripts/electron-acceptance.mjs --scenario normal-ui  # 单场景调试
node packages/app-desktop/scripts/electron-acceptance.mjs --self-test        # 判定器合成事件自检
```

双模式同文件：普通 node 下是 runner（临时根全新构建 electron main + renderer——`--configLoader
native` 防缓存写盘，不复用旧 dist——然后逐场景 spawn 真 electron）；`electron <本文件> <config>`
下是沙箱内 harness（`userData/sessionData/crashDumps/logs` 在导入真实 main **之前**全重定向、
清 Steam 环境变量、`dialog.showErrorBox` 换记录器防无人值守模态阻塞）。

**八场景**：normal-ui（真渲染层启动 + mock 桥存档往返 + start→running + 截屏）/ crash-loop
（3 reload + 第 4 次 escalate → exit 1）/ initial-death（首载中真死）/ stable-reset（稳定满窗
重开预算 [1,2,3,1,2]）/ missing-index（无 index.html → fatal 'load failed'）/ close-loading
（首载 pending 中关窗零 dialog）/ injected-hidden-eviction、injected-still-running（**事件注入，
非真死**，defer/ignore 语义）。

**分级标注（申报口径）**：真实崩溃 = `forcefullyCrashRenderer-call` 事件 + reason ∈
crashed/killed/abnormal-exit/oom 的 `render-process-gone`；事件注入 = `injected-render-process-gone`
且事件带 `injected: true, notRealOSRecovery: true`。两者在 results.json 分开计数，交付申报不得混淆。

**产出**：报告目录（缺省 `.scratch/electron-acceptance-<时标>/`）落盘 manifest.json（源码
hash 三时点核对：构建前/构建后/全部场景后——构建期失配即抛错中止，场景后失配则判定
false 走 exit 1、manifest 留 `sourceFrozenAcrossRun: false` 供复核；另含 electron exe hash
与 safety 声明）、results.json（8 场景判定 + 事件时序索引）、每场景 events.jsonl（逐事件
seq/ms 时序）、config/stdout/stderr、commands.json（每次 spawn 的原件留痕）、normal-ui 截图。
沙箱在 os.tmpdir 下 mkdtemp，真档零接触（红线同 2026-09-29 删档事故教训）。

**已知坑（原型实测吸收）**：
- 慢资源 fixture（initial-death / close-loading）必须**等请求真实到达、load 仍 pending** 才
  crash / 关窗——harness 内 `slowRequests === 0` 时轮询等待，防 fixture 抢跑把「竞争暴露」
  变成「随机通过」；
- 编译走 `node node_modules/typescript/bin/tsc` 直起，**不要**经 cmd.exe 调 `node_modules/.bin/*.cmd`
  （双层引号陷阱；若必须走 cmd，参照原型用 `windowsVerbatimArguments`）；
- 沙箱重定向的是 `userData`/`sessionData`/`crashDumps`/`logs` 四路径（main 侧实际触达面），
  不是字面意义的「全部 app.getPath」——`appData`/`temp` 等是 Electron 内部派生源，动了反而
  破坏沙箱自身；
- 验收超时杀进程须 `taskkill /PID <pid> /T /F`（Windows 下 SIGKILL 到不了进程树）；
- 判定口径的 reload 分母由 runner 从编译产物 `RELOAD_LIMIT` 读取传入（同源）；`expectedAttempts`
  表与各场景崩溃次数设计仍钉当前 RELOAD_LIMIT=3 的行为——改重载上限须同步重拟场景脚本与
  期望表，不能只改正则。

## 证据留档

两工装默认把报告落在 `.scratch/`（gitignore，不入库）；需要交付背书时在票评引用报告目录
路径与关键数字（分类表 / 8 场景结果），原型期先例见 `docs/audit/2026-10-03-renderer-recovery-80.md`。
`.scratch/` 会被会话清理，长期背书以票评为准。
