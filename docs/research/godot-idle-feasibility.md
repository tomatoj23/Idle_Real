# 用 Godot 开发放置类游戏的可行性调研（对标《梅尔沃放置》）

> 日期：2026-09-03 · 调研方式：官方文档 / 官方发布页 / 官方仓库等一手来源优先，辅以技术博客与数据站交叉验证
> **决议（2026-09-03）：维持现行 TS 路线，不考虑 Godot。** 本报告留档作为决策依据。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| Godot 能不能做出《梅尔沃放置》级别的放置游戏？ | **能**。核心机制（数值 tick、离线补算、存档、数据驱动内容）全部在引擎能力圈内，且有商业成功先例（Nodebuster，估算营收约 $990K、13.8K 评测 98% 好评） |
| 最大优势 | 一套工程导出六端（Win/mac/Linux/Android/iOS/Web）、MIT 零版税、"游戏感"（动画/粒子/音频）开箱即用、原生二进制小且启动快 |
| 最大短板 | ① Web 版本是"二等公民"：包体 20MB 起步、启动慢、移动浏览器受限——而这恰是 Melvor 模式的主场；② UI 密集型界面（几十个技能页/物品表）用 Control 体系开发摩擦明显大于 HTML/CSS；③ **C# 无法导出 Web**，要 Web 就必须 GDScript；④ 无 JS mod 生态，与 Melvor 的社区 mod 优势相反 |
| 对本项目（SmallRpg）的建议 | **维持现行 TS 路线为主线**（与 Melvor 同构：web-first + JS 生态）；Godot 作为"重表现 / 原生渠道为主 / 新立项"场景的备选。若认真考虑，先用 Godot 4.7 做 1-2 周垂直切片再定 |

## 1. 对标对象画像：《梅尔沃放置》到底是什么技术形态

先确认对标物的真实形态，这直接影响"用 Godot 重做它"的评估口径：

- 官方自我定位即 **"A web-based idle/incremental game"**（[melvoridle.com](https://melvoridle.com/)）——浏览器是它的第一平台，Steam/移动是延伸渠道。
- 官方 GitHub 仓库 `MelvorIdle/melvoridle.github.io` **仅作为 issue tracker**（bug/翻译/拼写三类 issue），不含源码（[README](https://github.com/MelvorIdle/melvoridle.github.io)）。
- 官方 Mod 生态明确：**"Mods for Melvor Idle are created using JavaScript"**（[官方 Wiki：Mod Creation/Getting Started](https://wiki.melvoridle.com/w/Mod_Creation/Getting_Started)）。本体即是 JS（网页可玩、可在浏览器控制台观察），社区 mod 直接复用同一语言栈。
- 平台矩阵：Web（melvoridle.com）+ Steam（发行商 Jagex，开发者 Games by Malcs）+ Android（[gamesbymalcs.com](https://gamesbymalcs.com/) 列出 Steam/Android/Web 三个版本入口）；桌面端封装方式官方未公开声明，社区存在非官方 Electron 封装（如 `kasperfb0/melvor-idle-electron`）。
- 内容量级：RuneScape 式多技能体系（伐木/钓鱼/战斗/魔法等 20+ 技能页面）+ 海量物品/装备/副本，靠持续内容更新驱动长线运营。

**要点：Melvor 的成功配方 = 网页即点即玩 + JS 内容/mod 生态 + 多端封装延伸。它恰恰不是用游戏引擎做的。** 用 Godot 复刻"这类玩法"没问题，但会天然偏离"这个配方"。

## 2. 放置游戏的技术需求画像（评估基准）

从玩法本质推导，放置类游戏对引擎/技术栈的真实需求：

1. **数值模拟与离线进度**：低频 tick + 打开时按时间戳补算；计算量通常远低于实时游戏（Melvor 式回合制战斗也可用离线批量结算）。
2. **UI 密集且重复**：几十个技能页、物品表、弹窗、统计面板；"数据→界面"驱动，模板化复用是主要开发模式。
3. **内容高频更新**：版本节奏以周/月计，数值表和词条不断加——需要廉价的内容生产管线。
4. **存档安全**：存档即全部资产，需要本地+云+导出导入多保险。
5. **长生命周期、低成本运营**：单人/小团队数年维护，工具链与构建成本越低越好。
6. **多端分发**：典型路径 Web（引流）→ Steam（变现）→ 移动（留存）。
7. **（Melvor 特有）社区 mod**：JS mod 生态延长游戏寿命。

## 3. Godot 现状速览（2026-09）

| 维度 | 现状 |
|---|---|
| 当前稳定版 | **Godot 4.7**（2026-06-18 发布，代号 "Lights, Camera, Action!"，现维护版 4.7.2；Web 编辑器已挂 4.7.2.stable.official）。此前 4.5（2025-09-15）、4.6.1（2026-02-16）。4.8-dev 预览中（[download/preview](https://godotengine.org/download/preview)） |
| 许可 | MIT，零版税、零授权费，闭源商用无限制（[godotengine.org](https://godotengine.org/)） |
| 脚本语言 | GDScript（首选）/ C# .NET / C++ GDExtension（[官方 FAQ](https://docs.godotengine.org/en/stable/about/introduction/index.html)） |
| 平台矩阵 | Windows / macOS / Linux / Android / iOS / Web（WebAssembly + WebGL 2.0） |
| UI 体系 | Control 节点 + Container（VBox/HBox/Grid）+ Theme + anchors，场景（.tscn）模板化复用 |
| 内容热更 | PCK/ZIP 包官方支持 **Patch PCK**（补丁包、delta encoding、mod 加载），见 [官方文档 Exporting packs, patches, and mods](https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html) |
| Steam 集成 | GodotSteam（成熟第三方 Steamworks 绑定：成就/云存档/overlay，[godotsteam.com](https://godotsteam.com/)）；SteamDB 自动收录 Godot 游戏（[steamdb.info/tech/Engine/Godot](https://steamdb.info/tech/Engine/Godot/)） |

## 4. 逐项可行性评估

### 4.1 核心机制：完全可行（非瓶颈）

- 离线进度 = 保存 `Time.get_unix_time_from_system()` 时间戳 + 重进时批量结算，纯通用编程问题，与引擎无关；Godot 官方有 [Saving games 教程](https://docs.godotengine.org/en/stable/tutorials/io/saving_games.html)（JSON vs binary 序列化、user:// 跨平台路径）。
- 放置游戏的计算量级（每秒数次到数十次数值 tick）对 GDScript 绰绰有余；即便做 Melvor 式全模拟战斗，可用低频 tick 或把热点下沉到 C#/GDExtension（桌面上）解决。**这一层不构成任何风险。**
- 注意点：Web 版切后台后浏览器停止 `requestAnimationFrame`，逻辑会暂停——对放置游戏无伤（本来就是时间差补算模式），但需按"回来补算"设计而非"后台也推进"。

### 4.2 UI 密集型界面：可行，但有真实摩擦（最大短板）

Godot UI 体系能力完整（Theme 全局换肤、Container 自动布局、场景复用做"技能页模板"），但对照 Melvor 式界面有明确差距：

- **无 CSS 级布局能力**：所有间距/对齐/响应式都要逐节点调属性或写代码，改版成本高于 HTML/CSS；没有浏览器 devtools 式的样式调试。
- **大数据量列表性能差**：官方 issue [#70869 "Poor performance of 2D Tree View with many items"](https://github.com/godotengine/godot/issues/70869)（2023 开）记录 Tree 控件大量条目时每次滚动触发 O(n) 查找导致卡顿；官方**没有虚拟滚动列表**控件，物品背包/交易行级别的列表需要自建窗口化渲染或接受 ItemList 的能力上限。
- 富文本只有 RichTextLabel 的 BBCode，能力远不如 HTML。
- 结论：**做得出来，但同等的界面工作量在 Godot 里普遍比 Web 前端重**，尤其数值密集的表格/统计页。

### 4.3 内容数据驱动与热更：可行，且对本项目有独特衔接点

- 内容可用 JSON / CSV / 自定义 Resource 驱动，运行时加载；本地化走 CSV / gettext（官方国际化章节）。
- **Patch PCK 官方支持**：内容更新可只发补丁包（delta encoding），不必整包重发——契合放置游戏高频内容更新的运营节奏（见 [Exporting packs, patches, and mods](https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html)）。
- 与 SmallRpg 的衔接：本仓库的 `packages/content`（JSON schema + 校验 + 默认数值）与 `packages/editor`（内容编辑器）**可以原样保留**——编辑器继续用 TS 做 Web 工具，产出 JSON 直接被 Godot 读。真正要重写的只有 `engine`（GDScript 化）与 UI 层。

### 4.4 分发矩阵逐平台评估

| 平台 | Godot 现实表现 |
|---|---|
| Steam（桌面） | **强项**。原生二进制小、启动快，GodotSteam 集成成就/云存档/overlay 成熟 |
| Web（桌面浏览器） | **可行但要打折**：要求 WebAssembly + WebGL 2.0；多线程导出依赖 SharedArrayBuffer，服务器必须配 `COOP: same-origin` + `COEP: require-corp` 响应头，否则白屏报 `SharedArrayBuffer is not defined`；**4.3 起支持单线程导出**（免响应头，社区共识是独立网页游戏的更安全默认，代价是二进制更大）（[官方 Web 导出文档](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)、[bugnet.io 2026-05](https://bugnet.io/blog/fix-godot-export-html5-game-fails-load-shared-array-buffer)）。itch.io 自 2023 年起提供 SAB 支持开关、自动配响应头 |
| Web 包体/启动 | **是核心短板**：未优化 WASM 载荷 >20MB；禁用 3D/WebRTC/CSG 模块自编译导出模板可再省约 40%，音频需转 96kbps Vorbis 等（[xjustice 优化实录](https://xjustice.github.io/articles/optimizing-godot-4-web-exports.html)）。对照纯 JS 放置游戏"几百 KB 秒开"，首次加载差距是数量级的 |
| Web（移动浏览器） | 官方明确"可在移动平台运行但需注意"：CPU/GPU 受限时性能是硬伤，**原生导出性能显著更好**；4.2 时代多线程导出在 iOS/macOS 上因 SharedArrayBuffer 上游 bug 完全不能跑，4.3 单线程导出后 iOS 才可用。结论：**移动浏览器不要作为 Godot 的目标平台**，移动只走原生 app 导出（[官方 Web 导出文档 Mobile considerations](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)） |
| Android / iOS 原生 | **强项**。官方导出管线成熟（4.7 还新增 GABE 伴侣 app 改善 Android Gradle 导出体验），游戏手柄/触控/生命周期处理内置 |

### 4.5 语言与性能：有一个硬约束

| 语言 | 定位 | 关键限制 |
|---|---|---|
| GDScript | 开发效率最高、零编译等待、与编辑器深度集成；2D/UI 密集型项目首选 | 性能低于 C#/C++，但放置游戏量级下不构成瓶颈 |
| C# (.NET) | 计算密集型任务更快、类型安全、适合大工程 | **官方不支持导出 Web 平台**（4.2 起确认至今，.NET 能编 WASM 但 Godot 用不了；存在第三方 hack 方案 `ComplexRobot/godot-dotnet-web-export`，非官方稳定路线）（[官方 C# 平台支持声明](https://godotengine.org/article/platform-state-in-csharp-for-godot-4-2/)） |
| C++ GDExtension | 最快、可复用 C 库 | Web 平台可用但构建链复杂，一般不需要 |

**选型推论：只要"Web 版"还在需求清单里，逻辑层就只能写 GDScript。** 想用 C# 就等于放弃 Web 渠道（或接受非官方 hack）。

### 4.6 Mod 生态：与 Melvor 正好相反

- Melvor：本体即 JS，官方 mod 系统与游戏同语言，社区零门槛参与——内容长尾的生命线。
- Godot：没有对应物。Web 版理论上可经 `JavaScriptBridge` 与页面 JS 互操作，但把 mod 能力焊在 Web 平台上等于放弃"一次开发多端"；原生 mod 要走 PCK + GDExtension，门槛远高于 JS。
- 若"社区 mod"是产品核心卖点，Godot 是劣势选型。

## 5. 案例证据

| 案例 | 事实 | 说明 |
|---|---|---|
| **Nodebuster**（goblobin，2024-08） | Godot 开发的短篇 incremental/放置游戏，Steam appid 3107330；估算营收约 **$990.7K**，约 **13.8K 评测、98% 好评**（[SteamScanner](https://steamscanner.vercel.app/game/3107330)、[indielist](https://indielist.games/games/nodebuster-3107330)） | **Godot 放置游戏商业成功的一手实锤**；同时证明"短小精悍 + Steam 原生"路线成立（它没有做 Web 版主推） |
| A Dark Forest | 开源 Godot 放置游戏，灵感 A Dark Room（[open-awesome](https://open-awesome.com/projects/godotprojectzero)） | 社区自娱/学习向可行 |
| GitHub `incremental-games` topic | 多个 godot4 标签的开源放置项目持续更新（[github.com/topics/incremental-games](https://github.com/topics/incremental-games)） | 生态存在但远小于 JS 放置生态 |
| SteamDB "Games using Godot Engine" | 自动检测列表规模持续增长（[steamdb.info](https://steamdb.info/tech/Engine/Godot/)） | Godot 在 Steam 的总体供给在涨 |

**反面参照**：至今没有出现"Melvor 级内容量 + Web 首发引流"的 Godot 放置游戏；该生态位由 JS 栈产品（Melvor、浏览器挂机类）占据。

## 6. 优势汇总

1. **一套代码六端导出**，移动端走原生 app（性能、商店分发、推送/内购插件齐全），不必再维护 Electron/Capacitor 双壳。
2. **MIT 零版税**，工具链免费，编辑器轻量（百 MB 级，vs Unity 数 GB）。
3. **"游戏感"开箱即用**：动画/粒子/音频/手柄/触控（4.7 继续完善）都是内置能力——放置游戏往"有打击感的战斗表现"演进时，Web 技术栈要花数倍力气。
4. 桌面原生分发体验好：单文件小、启动快，Steam 差异化存档/成就有 GodotSteam 成熟方案。
5. **PCK 补丁 + 官方 mod 加载机制**契合长线内容运营。
6. GDScript 迭代快，编辑器内置场景/主题/动画编辑，小团队友好。

## 7. 劣势与风险汇总（含缓解）

| # | 劣势/风险 | 缓解手段 |
|---|---|---|
| 1 | Web 版包体 20MB+、启动秒级，无法"秒开引流" | 自编译瘦身模板（禁 3D 等，-40%）+ gzip/brotli + 预载页；或接受"Web 仅做试玩 demo" |
| 2 | 移动浏览器基本不可用，Web 端覆盖 = 桌面浏览器 | 移动流量全走原生 app 导出 |
| 3 | **C# 不能上 Web**，多语言栈规划受限 | 全押 GDScript；热点用 GDExtension（含 Web 构建） |
| 4 | UI 密集页面开发摩擦大：无 CSS、无虚拟滚动列表、Tree 大数据量卡（issue #70869） | 数据驱动 + 场景模板复用；列表控制条目量；接受更慢的界面迭代 |
| 5 | 无 JS mod 生态，复刻不了 Melvor 的社区内容飞轮 | 若 mod 是卖点 → 直接排除 Godot；否则用 PCK 做官方内容更新即可 |
| 6 | 引擎升级偶发回归（如 4.6 渲染回归 issue #115599） | 锁定维护版（4.7.2），升级前跑回归测试 |
| 7 | 对本项目：engine/content 分离架构需 GDScript 重写，双语言栈维护成本 | 见 §8 对照与 §9 决策建议 |

## 8. 与本仓库现行 TS 路线的对照

| 维度 | 现行路线（TS monorepo + Electron/Capacitor） | Godot 4.7 路线 |
|---|---|---|
| Web 端 | 一等公民，秒开，天然覆盖移动浏览器 | 二等公民：包体大、移动浏览器不可用 |
| 内容生产 | JSON schema + editor 包（已有） | **可复用**：JSON 直读，editor 包不动 |
| 机制核心 | TS（已按"零内容感知、平台无关"红线建好） | 需 GDScript 重写（一次性成本，逻辑可平移） |
| UI 迭代 | CSS/HTML 生态，改版快 | Control 体系，等效工作更重 |
| 桌面分发 | Electron（包大 ~100MB+、双份 Chromium） | 原生二进制，小而快（明显优） |
| 移动分发 | Capacitor（WebView 壳） | 原生导出（性能、手感明显优） |
| 表现力上限 | DOM/CSS/Canvas，做重表现费力 | 动画/粒子/音频内置（明显优） |
| Mod/社区生态 | JS 同构（Melvor 同款优势） | 无 |
| 工程纪律 | 现有 vitest/CI/schema 校验全套 | 需重建（gdUnit4 等测试框架可用） |

## 9. 决策建议

1. **主线不变**：SmallRpg 维持 TS 路线。它与 Melvor 配方同构（web-first + JS 生态 + 内容引擎分离），且批 0-2 的机制层重构正是往"引擎无关"走的投入，换 Godot 等于放弃这笔投入的大半价值。
2. **Godot 的适用触发条件**（满足其二即可立项评估）：
   - 产品重心转向"重表现"：战斗动画、特效、音画驱动的放置 RPG；
   - 渠道重心转向原生（Steam 为主 + 双端原生 app），Web 退居 demo 引流；
   - 是**新项目**而非存量迁移（迁移成本主要是 engine 重写 + UI 重建 + 工程纪律重建）。
3. **低成本验证路径**（若决定认真评估）：Godot 4.7.2 + GDScript 做 2 周垂直切片——1 个技能 + 1 个战斗循环 + 存档/离线补算 + Web 与 Steam 双导出各一份，重点体感三个问题：UI 开发手感、Web 包体与启动时间、GDScript 工程化（测试/重构/多人协作）。
4. 无论选哪条路，**内容管线（JSON schema + editor）都值得继续按现状投入**——它在两条路线上都能直接复用。

## 10. 参考来源

- Godot 官方：[为 Web 导出（含移动端注意事项、线程支持、限制）](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html) · [导出 PCK/补丁/mod](https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html) · [保存游戏](https://docs.godotengine.org/en/stable/tutorials/io/saving_games.html) · [4.7 发布页](https://godotengine.org/releases/4.7/) · [下载页（版本线）](https://godotengine.org/download/preview) · [C# 平台支持声明（Web 不支持）](https://godotengine.org/article/platform-state-in-csharp-for-godot-4-2/)
- Godot 官方仓库 issue：[#70869 Tree 大条目性能](https://github.com/godotengine/godot/issues/70869)
- Melvor：[官网（web-based 定位）](https://melvoridle.com/) · [官方仓库 README（issue tracker 定位）](https://github.com/MelvorIdle/melvoridle.github.io) · [官方 Wiki：Mod 用 JavaScript 编写](https://wiki.melvoridle.com/w/Mod_Creation/Getting_Started) · [Games by Malcs（平台入口）](https://gamesbymalcs.com/)
- 案例/数据：[Nodebuster @ SteamScanner（营收/评测估算）](https://steamscanner.vercel.app/game/3107330) · [indielist：Nodebuster](https://indielist.games/games/nodebuster-3107330) · [A Dark Forest（Godot 开源放置）](https://open-awesome.com/projects/godotprojectzero) · [SteamDB：Godot 引擎游戏列表](https://steamdb.info/tech/Engine/Godot/)
- 技术博客：[bugnet.io：SAB/COOP/COEP 配置与单线程导出（2026-05）](https://bugnet.io/blog/fix-godot-export-html5-game-fails-load-shared-array-buffer) · [xjustice：Godot 4 Web 包体优化实测](https://xjustice.github.io/articles/optimizing-godot-4-web-exports.html)
- 生态：[GodotSteam（Steamworks 绑定）](https://godotsteam.com/) · [github.com/topics/incremental-games](https://github.com/topics/incremental-games)
