# 版本漂移影响评估 · 二轮对抗性复审：复核、勘误与补盲

> 日期：2026-09-16 · 调研方式：对一轮报告（`docs/research/version-drift-impact.md`，同日成文）的对抗性复核——①逐条抽查其载荷论断（官方一手源换源重验 + 脚本重数量化数字 + 仓库引证逐行核对）；②用一轮未用的方法开辟 10 个新排查面（CI/打包链/fuses/ABI 矩阵/npm audit/依赖树/模块图/废弃旗标/git 钉龄/渲染层 API）；③全程仓库只读，仅新增本文件
> 状态：**调研留档，决策权在用户**。方法论审计先行结论：本机 `npm config get registry` = `https://registry.npmmirror.com`（镜像源），`package-lock.json` 全部 414 个 `resolved` 字段亦指向镜像——一轮所有 `npm view` 数据理论上有镜像滞后风险，本轮已全部换官方源 `--registry=https://registry.npmjs.org` 重验（见 §1.0）。
> 补记（同日）：另有**三轮人工对账**（附录 C）——主会话不依赖二轮脚本、以三路独立手段全量硬扫复核，总裁定「两轮脚本结果可信」，微勘误 2 处、补盲 3 条、方法风险实录 1 条。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 一轮报告整体可信度 | **高**。全部 registry 版本数字（10 个包 + 关键发布时间线）、TS 7.0 公告全部论断（含可疑的 `types:[]` 默认——官方原文确有）、Electron 内嵌版本、Node 24 LTS 日程、Vitest 5 迁移指南 5 项、21 个 schema 关键字频次等，经官方源/脚本重验**逐项命中**（§1.1–§1.2） |
| 一轮勘误 | **6 处（实质性 2 处，表述性 4 处）**。实质性：①「48 个 happy-dom 标记测试文件」实为 22；②§0 风险计数「高1/中6/低3」与正文不符，裁决为**高1/中5/低4**（§1.3–§1.4） |
| 新发现 | **9 项（中 3 / 低 6）** + 3 项信息级。最重要的三项：npm audit 实测 **1 critical + 2 high** 全落在现行 pin 上（happy-dom 18 命中 critical RCE 类 GHSA）；git 钉龄证明 **electron 38 / happy-dom 18 都是 2026-09 上旬新鲜选型时选中的停更线**（知识漂移已在选型时点兑现过一次）；steamworks.js 0.4.0 已 **25 个月未发版**，CONTEXT.md ADR-001「活跃成熟」的「活跃」与 npm time 元数据矛盾（第 2 章） |
| 对一轮三选项的影响 | 方向不变、砝码重排：选项一（只做文档）的代价被 audit 数据加重；选项二的 happy-dom 升级从「对齐可选」升为「有安全通报支撑的优先动作」；选项三的 steamworks.js 兼容担忧**显著降级**（N-API 按平台 prebuild，ABI 139→149 无需重编译），但需注意 extract-zip 两条 8.1 分漏洞升级也修不掉（§3） |
| 运行时矩阵与「最老环境=Electron 38」 | **成立**。45 stable 未发布（feed 中仅有 46 nightly），一轮「支持窗口=44/43/42」论断正确；steam 打包链产出的仍是同一 electron 38.8.6 二进制；editor 为开发者本机现代浏览器工具，无更老执行环境（§1.5） |
| registry 镜像审计结果（铁律 3 项） | **好结果**：镜像当日与官方源完全同步（10 包 latest 逐一比对无差），一轮数据成立；但「单源取数不声明镜像」是可复现性缺陷，后续调研应显式 `--registry=https://registry.npmjs.org`（§1.0） |

---

## 1. 第一步：对一轮报告的复核与勘误

### 1.0 方法论审计：registry 镜像（结果无论好坏，如实记录）

- 本机配置：`npm config get registry` → `https://registry.npmmirror.com`。
- lockfile 取证：`package-lock.json` 中 414 个带 `resolved` 的条目 **100% 指向 `registry.npmmirror.com`**（`node -e` 全量解析，脚本于系统临时目录）。
- 一轮报告附录声明「联网核实（npm registry，2026-09-16）：`npm view <pkg> …`」，**未声明实际走的是镜像**。
- 换源重验结果（同日，`--registry=https://registry.npmjs.org`）：typescript=7.0.2、vitest=5.0.1、vite=8.3.0、happy-dom=20.14.5、electron=44.4.1、electron-builder=26.15.3、@types/node dist-tag latest=22.20.3、steamworks.js=0.4.0、fflate=0.8.3、@capacitor/core=cli=8.5.2——**镜像与官方完全一致，一轮全部版本数字成立**。
- 裁定：数据无错，方法有险。镜像对当日新发布的同步（electron 44.4.1 发布于当日 00:54 UTC）也已跟上，但这是运气好而非机制保证。**建议**：涉及「latest 是什么」的调研一律显式指定官方源。

### 1.2 复核通过的关键论断（对抗抽查后仍站立）

| 一轮论断 | 复核方式 | 结果 |
|---|---|---|
| TS 7.0 GA=2026-07-08；7.0.2=npm latest；`next=7.1.0-dev.20260916.1` | 官方源 `npm view typescript dist-tags/time`（7.0.2 发布时间 2026-07-08T15:55Z）+ [官方发布公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)（访问日期 2026-09-16，下同） | **逐项命中** |
| §2.1 全部 TS 7 差异论断：硬移除 target es5 / downlevelIteration / baseUrl / moduleResolution node·node10·classic / module amd·umd·systemjs·none；默认翻转 strict、module=esnext、**types=[]（不再自动纳入 @types/*）**、rootDir="./"、noUncheckedSideEffectImports；assert→with；模板字面量类型按 Unicode 码位；无编译器 API（7.1 提供） | 逐句对照 [TS 7.0 发布公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)原文 | **全部命中**。重点怀疑项「types:[] 默认」**不是过度推断**——公告原文："types now defaults to []"（恢复旧行为需显式 `["*"]`）。一轮引用纪律良好 |
| Electron 38.8.6 内嵌 Node 22.22.0 / Chromium 140.0.7339.249；44.4.1 内嵌 Node 24.21.0 / Chromium 152.0.7977.78 | [releases.electronjs.org/releases.json](https://releases.electronjs.org/releases.json)（`node https.get` 直取解析） | **四个数字精确命中** |
| Electron 支持窗口=44/43/42；38.x 末版=38.8.6（停在 2026-03-11）；44.0.0=2026-08-25 | releases feed 全量解析：45 stable 未发布（最新为 46.0.0-nightly）；npm 官方源 time 元数据 | **命中** |
| Node 24「Krypton」LTS 2025-10-28 / 2026-10-20 转维护 / EOL 2028-04-30；26 LTS 2026-10-28 | [nodejs/Release schedule.json](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) | **逐字命中**（顺带实测：Node 22 已于 2025-10-21 进入维护期，即 Electron 38 内嵌的 Node 22.22 属维护线） |
| Vitest 5.0.0 GA=2026-09-03；4.1.11=V4 末版（2026-08-18）；V4 dist-tag 仍在；V4/V5 engines 区间 | 官方源 time/dist-tags/engines（vitest@5.0.1 engines=`^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`，vitest@4.1.11=`^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0`） | **逐项命中** |
| Vitest 5 迁移要点：clearMocks 默认 true、vi.mock 顶层强制（违者从警告改抛错）、json/junit reporter 默认写文件、vitest/mocker 移除、@vitest/expect 并入主包 | [Vitest 5 迁移指南](https://vitest.dev/guide/migration.html) | **五项全命中** |
| happy-dom 时间线：18.0.1（2025-06-10）后停更、19.0.0=2025-09-28、20.0.0=2025-10-09、20.14.5=2026-09-12 | 官方源 time 元数据 | **命中** |
| 137 个 .ts 文件、16 个 schema 文件 | 脚本重数（排除 node_modules/dist 等） | **精确命中** |
| schema 21 个关键字频次全表（type×398、$ref×375、description×522…oneOf×1） | JSON.parse 后按实际 key 重数（非文本 grep） | **21 个数字全部精确命中** |
| @types/node 三槽位（根 20.19.43 / electron 内嵌 22.20.1 / app-desktop 24.13.3）；根槽位由 vite/happy-dom/vitest 的 ^20 区间拖入；dist-tag latest=22.20.3 跟随 Node 22 | lockfile 全量解析 + 逐包 requires 取证 + 官方源 | **命中**（根槽位 20.19.43 同时满足 vite `^20.19.0`、happy-dom/vitest `^20.0.0`，electron 自依赖 `^22.7.7` 得嵌套 22.20.1） |
| 全部 package.json 无 `engines`/`packageManager`；@capacitor/cli 8 要 node>=22 | 五份 manifest 复查 + 官方源 engines | **命中** |
| §2.3「39–44 破坏性变更与本仓库 API 面零直接命中」及各版本逐项（42 起 postinstall 不再下载二进制、44 移除 ia32/armv7l、44 移除 renderer clipboard、42 macOS UNNotification 须签名、42 clearStorageData quotas、41 PDF 独立 WebContents/cookie、39 window.open resizable） | [Electron 官方破坏性变更页](https://www.electronjs.org/docs/latest/breaking-changes) 全文核对 | **结论成立**（仅一处版本归属小错，见 E4；本仓不注册自定义协议、不用 OSR/clipboard/PDF、window.open 全 deny——`packages/app-desktop/electron/main.ts:119`） |
| §2.4 全仓唯一 `vi.mock` 使用点=projection-shell.test.ts；无快照测试 | grep 全仓 | **命中**（toMatch Snapshot 类 0 处；`@vitest/*` 七个子包 4.1.11 在 lockfile 在册） |
| §2.7/§2.8 引证：`satisfies`（pipeline.ts:128）、steamworks 接口形状（platform.ts:26 + index.d.ts:1 逐字）、preload.cjs:2-3 CJS 注释、main.ts:119 deny、save.ts bind 教训注释、fixtures.ts:103 / editor state.ts:89 的 structuredClone | 逐行核对 | **全部命中** |
| vite.config 两份各仅 `base:'./'`（editor/app-desktop） | 全文复读 | **命中** |
| 本机 node v24.13.0 / npm 11.6.2 | `node --version` / `npm --version` | **命中** |

**引用时效说明（非勘误）**：一轮调研时仓库有在途 journal 工作，其后已提交落地（95258ee，2026-09-16 21:40 +0800）。受此影响 `packages/engine/src/state.ts` 的「structuredClone 规避」注释由一轮所引 `:848` 漂移至现 `:856`，内容原样仍在。一轮读取的是移动中仓库的快照，此类 ±行号漂移不记为勘误。

### 1.3 勘误清单（实质性 2 处）

| # | 一轮论断 | 实测 | 证据 | 影响 |
|---|---|---|---|---|
| E1 | §2.4：「48 个 `@vitest-environment happy-dom` 测试文件」 | **22 个**（标记出现次数亦为 22，两法一致） | `grep -rl/-c/-o` 三口径；并回溯 git 历史：17f2677=0、02311ca=12、955a327=16、d2e5078/5739052=21、95258ee/HEAD=22——**任何历史时点都不是 48**。总测试文件数 67 与一轮自述一致 | 实质性：V5 迁移重验面被高估 1 倍多；「升级工作量=半天」的估计反而更宽裕 |
| E2 | §0：「风险点计数 高 1 / 中 6 / 低 3」 | 正文实为：高 1（§2.1）+ 中 5（§2.2、§2.3、§2.4、§2.6，另 §2.5 自述「综合记 中→低」）+ 低 4（§2.7–§2.10）。无任何自洽读法能得出中 6/低 3 | 一轮报告 §0 表 vs §2 各节评级原文逐条点数 | 实质性（决策用计数错误）：**裁决为 高1 / 中5 / 低4**（§2.5 按其「综合」口径记中）。各单项评级本体无争议，纯计数错 |

### 1.4 勘误清单（表述性 4 处，均不动摇结论）

| # | 一轮论断 | 实测 | 证据 |
|---|---|---|---|
| E3 | §2.7：「可选链 `?.`（603 处）／空值合并 `??`（452 处）」 | 口径未注明导致数字不可复现：按「出现次数」为 **677 / 482**（剥注释字符串后 676 / 478），按「含该操作符的行数」为 **602 / 453**——一轮数字与行数口径最接近但仍差 ±1~3 | 三种口径脚本重数（临时目录脚本）。量级结论（「远低于矩阵底线」）不受任何口径影响 |
| E4 | §2.3：「43 的 dialog 默认目录/**offscreen 渲染**」 | offscreen 渲染变更（deviceScaleFactor 默认 1.0）属 **42.0**，非 43；dialog 默认目录归 43 正确 | [Electron 破坏性变更页](https://www.electronjs.org/docs/latest/breaking-changes)原文："Behavior Changed: Offscreen rendering will use 1.0 as default device scale factor"（42.0 节） |
| E5 | §2.4 位置引证：`.githooks/pre-push:5-6` | 注释实际在 **3–4 行**，`--pool=vmThreads` 旗标在 **11 行** | 文件直读 |
| E6 | §2.7：「红线在 save.ts 与 **desktop.ts:30** 两处执行到位」（未写全路径） | `packages/app-desktop/electron/` 下无 desktop.ts；实指 **`packages/app-desktop/src/desktop.ts:30`**（`globalThis` 探测 wendao 桥，已核实该行存在） | 目录列举 + 逐行核对 |

### 1.5 运行时矩阵与「最老环境」判定复核

**成立，无漏项**：
- steam 分发链：electron-builder 产出的就是同一个 electron 38.8.6 运行时（`packages/app-desktop/electron-builder.yml` files 只含 dist/dist-electron，无第二个运行时面）；
- editor：ADR-005 定位为独立本地 web 工具，消费方式是开发者本机浏览器（现代 Chromium），不构成更老的真实执行环境；仓库无 browserslist 配置，vite 构建目标默认即现代浏览器；
- Capacitor：未安装，无可检验事实（与一轮一致）。
- 一处补充（对一轮有利的确认）：45 stable 截至 2026-09-16 **未发布**（releases feed 最新稳定=44.4.1，仅 46.0.0-nightly），一轮「官方支持最新 3 个大版本=44/43/42」精准成立。

---

## 2. 新发现（一轮未照到的面，按一轮高/中/低口径评级）

> 评级沿用一轮口径：高=按旧知识会改错代码/误判行为；中=误导性文档或次优修改；低=表面性差异。

### 2.1【中】npm audit 基线：3 条漏洞全部命中现行 pin，「安全断供」从定性变定量

`npm audit --registry=https://registry.npmjs.org`（2026-09-16，只读）实测 **1 critical + 2 high**：

| 包 | 严重度 | 明细（GHSA/评分） | 修复路径 |
|---|---|---|---|
| happy-dom ≤20.8.8（仓库装 18.0.1） | **critical** | VM Context Escape→RCE（[GHSA-37j7-fg3j-429f](https://github.com/advisories/GHSA-37j7-fg3j-429f)，未评分）；fetch credentials 误用页面源 cookie（[GHSA-w4gp-fjgq-3q4g](https://github.com/advisories/GHSA-w4gp-fjgq-3q4g)，7.5）；ESM 编译器未消毒 export 名注入可执行代码（[GHSA-6q6h-j7hj-3r64](https://github.com/advisories/GHSA-6q6h-j7hj-3r64)，**8.8**） | 升 happy-dom@20.14.5（即一轮选项二已列的动作） |
| electron ≤40.10.2 等（仓库 pin 38.8.6） | **high** | **19 条 Electron 官方公告**，CVSS 2.3–8.1。与本仓形态直接相关的：context isolation 可经 Function.prototype.bind 劫持绕过（[GHSA-h7rp-cf8h-j98x](https://github.com/advisories/GHSA-h7rp-cf8h-j98x)，**7.5**——本仓正用 contextBridge+沙箱）；自定义协议跨源读（7.4，本仓未注册协议）；沙箱 iframe 弹窗限制绕过（7.2，本仓 window.open 全 deny 已缓解）；UAF offscreen 绘制回调（**8.1**）等 | `npm audit` 给出路径：升 electron@44.4.1 |
| extract-zip `*`（electron 依赖 @electron/get 拖入） | **high** | symlink 路径穿越 / 任意文件写（[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)、[GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)，各 **8.1**）；影响面在**安装/打包期**（解压 Electron 二进制时） | 公告 range=`*`：**暂无修复版，升 Electron 也修不掉** |

- 对一轮的修正：§2.5 的「中→低」在安全维度**偏低，建议上修为中**（测试专用依赖命中 critical 级通报，虽无生产面、测试fixtures皆第一方，但「无风险」与「有 critical 通报」是两种决策输入）；§2.3 的「安全补丁断供」从推断变为带编号的 19 条公告实锤。
- 定性说明：happy-dom 的 RCE 类漏洞的暴露前提是测试环境解析不可信内容，本仓测试内容第一方，实际可利用性低；但安全通报的存在本身改变升级优先级。

### 2.2【中】git 钉龄考古：知识漂移已在「选型时刻」兑现过一次

`git log -S` 全量回溯（pin 引入即唯一变更，此后未动过）：

| pin | 引入提交 | 日期 | 选型时刻该版本的状态 |
|---|---|---|---|
| typescript ^7.0.2 | 17f2677 | 2026-09-02 | 当日最新（7.0 GA 于 2026-07-08）——**新鲜选型，覆盖良好** |
| vite ^8.2.2 | 17f2677 | 2026-09-02 | 8.2.2 发布于 2026-08-20，13 天前——**新鲜选型** |
| vitest ^4.1.11 | 17f2677 | 2026-09-02 | V4 末版，一天后（09-03）V5 才 GA——**选型时正确** |
| electron 38.8.6 | 02311ca | **2026-09-08** | 38.0.0 发布于 2025-09-02、末版停在 2026-03-11、**早已出官方支持窗口**（44.0.0 已于 2026-08-25 发布）——**新鲜时刻选了停更线** |
| happy-dom ^18.0.1 | 955a327 | **2026-09-11** | 18.0.1 停更于 2025-06-10（15 个月），20.x 活跃（次日即发 20.14.5）——**新鲜时刻选了停更线** |

- 对一轮的修正：一轮 §0 说「风险全部集中在**未来**编辑/升级动作上」——就**代码**而言成立，但就**版本选择**而言，漂移已经兑现过一次：两个停更线都是在 2026-09 上旬被「新鲜地」选进来的。这与报告主题（AI 训练数据滞后）自洽——选型者（AI 辅助的脚手架阶段）对 electron 38/happy-dom 18 的熟悉度高于 44/20，是同一枚硬币的另一面。
- 「落后多久」的直观量化：electron 38.8.6 pin 至今 8 天，但其内嵌 Chromium 140 的世代已 12 个月；happy-dom 18 引入至今 5 天，版本本身已 15 个月。

### 2.3【中】steamworks.js 生态停更：ADR-001「活跃」表述与 npm time 元数据矛盾

- npm 官方源 time 元数据：steamworks.js **0.4.0 发布于 2024-08-06**，此后 25 个月无任何版本（上一版 0.3.2=2024-06-03；历史发布节奏本就缓慢）。
- CONTEXT.md:57（ADR-001，2026-09-02）理由栏写「steamworks.js 活跃成熟（**已核实**）」——「成熟」成立，「活跃」与注册表事实矛盾。一轮 §1.1 只核了「0.4.0=latest 零差距」，未查发布日期，故未发现。
- 缓释（本轮新证）：prebuild 为 N-API 按**平台**命名（`dist/win64/steamworksjs.win32-x64-msvc.node` 等，文件名无 ABI 号），N-API 层 ABI 稳定，当前加载无碍；且仓库有 mock 平台完整回落（`platform.ts` mock/steam 双模式）。
- 处置建议：属文档修正类（与一轮 §3.2 同批）——ADR 简表按维护规则应补记勘误；框架对外发布前对 Steam 集成做「上游停更风险」声明。

### 2.4【低】Electron fuses 未配置（AI 旧知识的系统性盲区）

- `packages/app-desktop/electron-builder.yml` 全文（6–23 行）**无任何 fuses 配置**；按 [Electron 官方 fuses 文档](https://www.electronjs.org/docs/latest/tutorial/fuses)默认值（2026-09-16 访问），出货二进制保持：**runAsNode=Enabled**（`ELECTRON_RUN_AS_NODE` 可把应用变成裸 Node 运行时）、nodeOptions/nodeCliInspect=Enabled、**cookieEncryption=Disabled、asarIntegrityValidation=Disabled**、onlyLoadAppFromAsar=Disabled。
- 本仓威胁面有限（file:// 本地内容、window.open 全 deny、无远程内容加载、win x64 无签名公证链），故评「低」；但 fuses 是训练数据普遍不覆盖的新机制，**AI 不会主动想起它**——恰是本报告主题的活例。electron-builder 26 原生支持配置键 `electronFuses`（本地 `node_modules/app-builder-lib/out/configuration.d.ts` 含该键，安装包 26.15.3 实证）。
- 处置建议：并入下次 Electron 升级同一 PR（改 yml 一处），关 runAsNode + 开 asar 完整性校验是常规起点。

### 2.5【低】无 CI：本地绿=唯一绿

- `.github/` 目录**不存在**（无 workflows/dependabot/CI 任何形态）。
- 含义：工具链升级（Electron/vitest/TS）的回归网只有 `.githooks/pre-push`（check+test）与 AGENTS.md「真实浏览器首跑」红线。一轮选项三的「1-2 天含真机回归」估计因此应理解为**下限**；本轮只读约束未实跑打包，彼时须补。也是一条「版本漂移面」：actions 版本漂移等经典问题在本仓暂不存在，属于「缺失即免疫，但缺的是安全网」。

### 2.6【低】steamworks.js 兼容矩阵挖实：N-API prebuild 使 Electron 38→44 无需重编译

- 一轮「选项三」把「steamworks.js 与 Electron 44 兼容矩阵未验证」列为成本风险。本轮证据链：
  - ABI 号（本地 `node_modules/node-abi@4.35.0` 的 `abi_registry.json` 实测）：Electron **38=ABI 139**、39=140、40=143、41=145、42=146、43=148、**44=ABI 149**（跨度 8 个 V8 ABI 档）；
  - 但 `node_modules/steamworks.js/dist/` 的 prebuild 按**平台**命名（win32-x64-msvc / linux-x64-gnu / darwin-x64·arm64），无 ABI 号——N-API（node-api）ABI 稳定层的标准形态，`index.js` 按平台/架构直接 require；
  - 结论：38→44 升级**不需要新的原生构建产物**，一轮担忧的「prebuild 断供」不成立；保留的残余验证只剩真机加载冒烟（Steam overlay/init 行为等运行时面），外加本机 `steam_api64.dll` 为 2024 年中产物这一点随包发布（无版本声明文件，见附录未验证项）。
- 选项三成本估计因此可维持甚至略降（省去 ABI 适配排查）。

### 2.7【低】更新链当前休眠：updater 是占位 stub

- `packages/app-desktop/electron/updater.ts:10-12` 仅打一行 log（注释自述「自动更新占位……electron-updater 待分发渠道定版后接入」）；全仓无 electron-updater 依赖；electron-builder.yml 无 `publish` 配置。
- 含义：一轮 §2.3/选项三「42 起安装期二进制下载方式变化波及打包流程」——受影响的是**构建机 npm install 行为**（postinstall 不再自动下载 Electron 二进制，首跑 `electron` 命令时下载），而非终端用户更新通道（不存在）。风险表述应收窄。

### 2.8【低】渲染进程 Web API 面实测：极小且无 140→152 废弃风险

- grep 全量（app-desktop/src、editor/src，排除测试）：仅 **5 种 API 共 12 处**——localStorage×8（desktop.ts/main.ts/ui.ts 存档与 llm/config.ts）、requestAnimationFrame×1（`packages/app-desktop/src/ui.ts:297`）、structuredClone×1（`packages/editor/src/core/state.ts:89`）、fetch×1（`packages/editor/src/llm/client.ts:32`）、URL.createObjectURL×1（`packages/editor/src/io/files.ts:107`）。
- ResizeObserver/Notification/clipboard/serviceWorker/dialog/showOpenFilePicker/IntersectionObserver 等**零使用**。上述 5 种均为 Web 平台基石 API，Chromium 140→152 无废弃/变更记录触及。一轮查了主进程 Electron API 面，本轮补上渲染进程面，结论一致：升级零 API 命中。

### 2.9【低】TS 7 一轮漏列的差异项：本仓零暴露（逐项排雷）

一轮 §2.1 抓了大头但漏了 [TS 7.0 公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)的几条，逐项排雷结果：

| 漏列项 | 本仓暴露面 | 结论 |
|---|---|---|
| `esModuleInterop`/`allowSyntheticDefaultImports` **不可设为 false**（TS 6.0 起弃、7.0 硬错误） | `tsconfig.base.json:13` 显式 `esModuleInterop: true` | 零暴露 |
| `alwaysStrict` 不可关 | 未设置（strict 链路默认 true） | 零暴露 |
| namespace 位置禁用 `module` 关键字（`module X {}` 硬弃用；ambient `declare module` 仍合法） | 全仓 grep `module X {` 形态 **0 命中** | 零暴露 |
| CLI 传文件路径 + 当前目录有 tsconfig → 需 `--ignoreConfig`（TS 6.0 起 TS5112） | 各包脚本均为裸 `tsc --noEmit` / `tsc -b`，不传文件路径 | 零暴露 |
| target 默认浮动至 esnext 前一版（es2025）、libReplacement=false、stableTypeOrdering=true 且不可关 | base 显式 target/lib；stableTypeOrdering 只影响类型序（本仓无依赖类型序的技巧） | 零暴露 |
| rootDir 默认 `./`（内层源码目录须显式） | 三个 emitting 配置（engine/content/tsconfig.electron.json）**均已显式 rootDir** | 零暴露 |

**废弃旗标清退扫描**（一轮未做）：按 [TS 6.0 公告](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)官方废弃清单（target es5、downlevelIteration、moduleResolution node/node10、classic 已移除、module amd/umd/systemjs/none、baseUrl、esModuleInterop=false、alwaysStrict=false、outFile、legacy module 关键字、import asserts、no-default-lib）+ TS 5.0 时代旧旗标（charset/importsNotUsedAsValues/preserveValueImports/suppressImplicitAnyIndexErrors/keyofStringsOnly 等）扫全部 7 份 tsconfig：**全部干净**；并实测 `node_modules/.bin/tsc -b --dry`（npm run check 依赖的 composite 构建链）在 TS 7.0.2 下正常通过（EXIT=0，两项目 up to date）——**TS 7 项目引用支持实证无忧**。

### 2.10 信息级（不评级）

1. **OSV 覆盖缺口**：`api.osv.dev/v1/query`（ecosystem=Chromium, version=140.0.7339.249）返回 **0 条**——不能解读为「Chromium 140 无漏洞」，只能说明 OSV 对 Chromium 版本区间覆盖不完整；本报告的 CVE 定量化改由 npm audit 的 GHSA 数据承担（§2.1）。
2. **@vitest/\* 子包在册清单**：lockfile 中 expect/mocker/pretty/runner/snapshot/spy/utils 七包均 4.1.11——V5 迁移时 `vitest/mocker` 等子入口的移除与本仓直接相关（一轮已提示，本条补充完整清单）。
3. **editor LLM client 的环境假设**（一轮未查，非版本漂移主面）：`client.ts:47` 用 `AbortSignal.timeout(60_000)`（Chromium 103+/Node 17.3+，矩阵内全支持）；CORS 依赖各 OpenAI 兼容端点（ADR-006）自行放行，被拒时的失败形态是裸 `TypeError: Failed to fetch` 而非 client.ts 里的友好报错——设计假设，若未来编辑器以非 localhost origin 分发才需处理。

---

## 3. 对一轮 §3.3 三个选项的影响修正

**选项一（只做文档修正，工具链全不动）**——方向维持，**代价上调**：
- 「Electron 安全补丁断供」不再是推断：19 条 GHSA（最高 8.1）+ happy-dom critical（8.8）在案，其中 extract-zip 两条 8.1 连升级都修不掉；每次发版都在扩大暴露。
- 文档修正清单（一轮 §3.2 的三条之外）应追加：④ ADR-001「steamworks.js 活跃」措辞勘误（25 个月无版，§2.3）；⑤ fuses 知识条目（§2.4）；⑥ 本轮 audit 基线快照。
- 一句话：**能做，但「零动作」的安全成本已被定量证实，不宜久持**。

**选项二（文档 + 小步升级：happy-dom 20 / Vite 8.3；Vitest 5 观望；Electron 暂持）**——方向维持，**内部权重重排**：
- happy-dom 18→20 从「训练数据覆盖好的对齐动作」**升格为有安全通报支撑的优先项**（critical GHSA + npm audit 明确修复路径 20.14.5；§2.4 的 22 个标记测试文件为重验面，工作量比一轮估的小）；workaround 注释 4 处的过时化检查照旧。
- Vite 8.3 分钟级；Vitest 5 观望结论维持（GA 13 天 + `--pool=vmThreads` 门禁钉须实跑重验，本轮只读未验）。
- Electron 暂持的「舍」项加重（见选项一）。
- 一句话：**仍是性价比首选，但 happy-dom 是其中的第一优先，不再是顺带**。

**选项三（全面对齐：+ Electron 44.4.1）**——方向维持，**成本担忧下调、清单增补**：
- steamworks.js 兼容担忧显著降级：N-API 按平台 prebuild（ABI 139→149 无需重编译，§2.6），一轮「兼容矩阵未验证」已挖实为「结构上无碍 + 真机冒烟即可」；
- 升级 PR 建议同步做：`electronFuses` 配置（§2.4，electron-builder 26 原生支持）；42 起 postinstall 下载行为变化只影响构建机（§2.7），重验点收窄为「干净环境 npm install 后首跑 electron」；
- 预期管理：升级后 `npm audit` 仍会剩 extract-zip 两条（range=`*` 无修复版，§2.1）——「升级≠audit 全绿」应提前写进验收口径；
- happy-dom critical 在本轮口径下应与 Electron 同批处理（若走选项三，两项一起清账）。
- 一句话：**比一轮估计的更可行（native 模块无忧），但验收标准要写清 audit 残留**。

---

## 附录 A：方法与命令（全部只读；辅助脚本写于系统临时目录，未进仓库）

1. **方法论审计**：`npm config get registry`；`node -e` 解析 `package-lock.json` 全部 `resolved` 主机分布（414/414=npmmirror）。
2. **换源重验**：`npm view <pkg> version/dist-tags/time/engines --registry=https://registry.npmjs.org`（typescript/vitest/vite/happy-dom/electron/electron-builder/@types/node/steamworks.js/fflate/@capacitor/core·cli/@typescript/typescript6）；同数据镜像比对。
3. **官方页面**（访问日期均 2026-09-16）：[TS 7.0 公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)、[TS 6.0 公告](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)、[Electron releases.json](https://releases.electronjs.org/releases.json)（`node https.get` 直取）、[Electron 破坏性变更页](https://www.electronjs.org/docs/latest/breaking-changes)、[Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)、[Node schedule.json](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)、[Vitest 5 迁移指南](https://vitest.dev/guide/migration.html)。
4. **量化重数**：三种口径统计 `?.`/`??`（原始出现次数/剥注释字符串/按行）；schema 关键字按 JSON.parse 后实际 key 计数；happy-dom 标记文件三口径 + `git grep` 回溯 7 个历史提交。
5. **新面排查**：`.github` 存在性；electron-builder.yml/updater.ts 全文；steamworks.js dist 结构 + node-abi ABI 表（本地 `node_modules/node-abi@4.35.0`）；`npm audit --registry=<官方源>`（文本+JSON 两遍，取 CVSS 与 GHSA 编号）；`npm ls --all`（无 invalid/extraneous/UNMET）+ `npm outdated`；六份 manifest 的 type/exports/engines 字段 dump；7 份 tsconfig 全文 + 废弃旗标 key 级扫描 + `tsc -b --dry` 实跑；`git log -S` 钉龄回溯；CONTEXT.md/ADR 简表/editor llm 模块人工读；渲染层 Web API grep 全量。
6. **引证核对**：一轮引用的 file:line 逐条打开比对（preload.cjs:2-3、platform.ts:26、main.ts:119、pipeline.ts:128、save.ts 注释、state.ts:848→856 漂移、fixtures.ts:103、editor state.ts:89、desktop.ts:30 等）。

## 附录 B：未验证项（如实声明，宁缺毋断）

- Vitest 5 下 `.githooks/pre-push` 的 `--pool=vmThreads`「必挂」论断是否仍成立——须实际升级后实跑（只读约束内不可为）。
- electron-builder 26.15.3 × Electron 44 打包产物端到端（NSIS/portable 实际出包与安装）——须实跑。
- happy-dom 19.0.0–20.8.7 逐版本 breaking 变更清单未逐条核对（本轮仅由 GHSA 影响区间 ≤20.8.8 反推修复线在 20.8.9+，未读 changelog 原文）。
- steamworks.js 内嵌的 Steamworks SDK（steam_api64.dll 等）具体版本与支持窗口——包内无版本声明文件，未验证。
- Vite 8.0 **beta 宣布日**（2025-12-03，一轮 §2.2 引）未复核（GA 日已由 registry 核实，beta 日非载荷数字）。
- 各 OpenAI 兼容端点的 CORS 放行现状（外部运行时事实，与版本漂移弱相关，见 §2.10.3）。
- Capacitor 8 目标机型 WebView 基线（路线未启用，无可检验事实；与一轮口径一致）。
- OSV 对 Chromium 的覆盖完整度（返回 0 条按数据源缺口处理，见 §2.10.1）。

## 附录 C：三轮人工对账（2026-09-16 补记，主会话硬扫）

> 方法：不重跑二轮临时脚本（在系统临时目录），改用三路独立手段对账——① find / git ls-files 多口径重数文件；② 纯 grep 文本级计数；③ 另写一套全新实现的 JSON 键计数器；tsconfig、pre-push、引证逐份/逐行直读。全程只读（git status 前后一致）。

**总裁定：两轮脚本扫描结果可信，未发现实质性错误。** 复验逐项命中：

- 137 个 .ts（67 测试 / 0 个 .d.ts）、16 个 schema 全 draft-07、`$schema` 全在第 2 行；
- §1.4 的 21 个关键字频次独立重数**逐个精确相等**；裸 grep 抽验中 `"type"` 文本计数 403 vs 键计数 398 的 5 处差额，全部定位为 item.schema.json 五个 `"required": [..., "type", ...]` 数组里的**字符串值**——键计数口径正确，反倒是裸 grep 会多算；
- 14 项「零使用」论断（groupBy / withResolvers / fromAsync / hasOwn / toSorted 族 / `.with(` / randomUUID / Intl / v 旗标 / import assert / 装饰器 / `module X{` / `using` / 顶层 await / 快照测试）全部复现为 0；
- structuredClone 2 用 + 注释、replaceAll 7 处全在 combat.ts:180,331-341（331 行同行两处）、`.at(` 9 处全在测试、satisfies 唯一 pipeline.ts:128、globalThis 排除 dist 产物后恰 7 文件；
- `?.`/`??`：按出现 677/482、按行 602/453，与 §1.4 E3 的二轮数字**精确一致**（一轮 603/452 差 ±1，维持 E3「口径差、不动摇结论」的裁决）；
- 测试面 67 = 21+12+6+28、happy-dom 标记 22（E1 维持）、vi.mock 唯一 projection-shell.test.ts；
- 渲染面 rAF = ui.ts:297、fetch = client.ts:32、createObjectURL = files.ts:107 逐字命中；
- 7 份 tsconfig 旗标与 §2.9 排雷表一致、无废弃旗标；pre-push 勘误 E5 维持（注释 3–4 行、旗标 11 行）；
- lockfile 独立重解：414 条 registry resolved 100% npmmirror、@types/node 三槽位 20.19.43 / 22.20.1 / 24.13.3、全部关键版本与 @vitest/* 七子包逐字吻合；
- 引证抽查 9 处（save.ts:65-67、platform.ts:26+188-190、main.ts:119、preload.cjs:2-3、desktop.ts:30、keywords.ts:1-13、validate.ts:119、CONTEXT.md:57、ui.ts:297）全部命中。

差异与补盲 5 条（均不动摇任何决策结论）：

| # | 类型 | 内容 |
|---|---|---|
| C1 | 二轮微勘误 | §2.8 localStorage 实为 **7** 处非 ×8，且归因提到的 ui.ts 零命中（实际落点 app-desktop/src/desktop.ts、main.ts 与 editor/src/llm/config.ts） |
| C2 | 二轮微勘误 | §2.9 `esModuleInterop: true` 在 tsconfig.base.json **第 12 行**（原文引 :13，第 13 行是 skipLibCheck） |
| C3 | 补盲 | engine/save.ts:59 经 globalThis 探测访问 localStorage（`asStorage(g['localStorage'])`）——渲染进程里真实执行的访问点，落在 §2.8 声明的扫描范围（仅 app-desktop/src + editor/src）之外；§2.8 结论（基石 API、140→152 无废弃）不受影响，但渲染面清单口径应补记此点 |
| C4 | 补盲 | 存在 **2 个 `@vitest-environment node`** 标记测试（desktop-bridge.test.ts、platform.test.ts），两轮测试面清单均未提；仓库无任何 vitest.config，测试配置 = 文件头标记 + CLI 旗标（§1.2「无快照测试」维持） |
| C5 | 补盲 | app-desktop/tsconfig.json 的 include **不含 tests/**（editor 含）——其 21 个测试文件不在 `npm run check` 的 tsc 范围内，vitest 只转译不查型，类型错误在这批测试中不可见；属交付网盲区而非版本漂移，动 app-desktop 测试时须知 |

方法风险实录（对「脚本扫描」本身的可信度回答）：本机 Git Bash 的 grep 以**反斜杠**输出路径，`grep -v '/tests/'` 类正斜杠过滤器会**静默失效**——三轮现场踩中（一度得出「测试文件零 `?.`」的错误中间结论，实际 tests 下有 323 行含 `?.`）；总量数字未受影响（未用该过滤器），但这是 Windows 扫描管道的固有坑类，后续调研的路径过滤建议双分隔符兜底（如 `grep -vE '[\\/]tests[\\/]'`）。另：lockfile 除 414 条 registry 条目外还有 **4 个 workspace link 项**（resolved = 相对路径），§1.0「414/414 镜像」口径实指 registry 条目，准确但可更精确。
