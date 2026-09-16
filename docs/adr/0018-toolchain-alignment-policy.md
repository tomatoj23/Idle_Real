# ADR-018: 工具链版本对齐策略与 Electron 38 暂持的风险接受

日期：2026-09-16
状态：已接受（grilling 十问裁决；证据与对抗复审：`docs/research/version-drift-impact.md` + `version-drift-impact-round2.md`）

## 背景

2026-09-16 两轮版本漂移调研钉死三件事实：①本仓受 AI 训练数据滞后影响的方向与直觉相反——TS 7.0（Go 原生编译器）已是 npm latest，风险在「AI 按 5.x 旧知识改代码」而非仓库落后；②`npm audit` 1 critical（happy-dom 18）+ 2 high 全落现行 pin；③git 钉龄考古证明 electron 38 / happy-dom 18 两条停更线都是 2026-09 上旬「新鲜选型时刻」入伙的——伤害发生在选型瞬间，不在落后过程中。

## 决策

1. **当期对齐 = 小步**：happy-dom 18→20 + Vite 8.3.0（#64）、Electron fuses 加固（#65）、app-desktop 测试入 tsc 查型（#66）；**Electron 38.8.6 暂持**，升级 44.4.1 = #67（触发：对外发版前硬门槛；无发布计划则 UX 批 #34–#38 收口后立即）；Vitest 5 观望 = #68。
2. **持续策略 = 事件驱动 + 周期巡检，反对「随时对齐」**：
   - 选型时：新依赖先查维护状态与 GA 时长（`npm view <pkg> time --registry=https://registry.npmjs.org`），停更线不进 package.json；
   - 巡检：每特性批收口（或季度）跑 `npm outdated` + `npm audit` + Electron 支持窗口核对；
   - 插队触发：现行 pin 出 critical/high 通报、或滑出 Electron 官方三版本支持窗口 → 升级票插到对齐档位；
   - 大版本观望：非安全驱动的大版本等 GA 满 2–3 个月（或 .1 patch）。
3. AGENTS.md 增工具链校准节，**只写不随版本腐坏的纪律**；时点事实（版本数字、audit 基线）以调研文档与票为单一来源，不在 AGENTS.md 复制。

## 理由

训练数据滞后使「最新」反而覆盖最差（Vitest 5 GA 13 天覆盖≈0），甜点区是「GA 2–3 个月 + 活跃维护」；「随时对齐」会制造它要防的知识漂移，且 Electron 每 minor 都是新版 Chromium 测试面、升级打断特性工作。

## 后果

- Electron 38.8.6 暂持 = **有意识接受** 19 条 GHSA 在案（最高 8.1，context isolation 绕过 7.5 与本仓 contextBridge+沙箱形态相关；缓解：本地 file:// 内容、无远程加载、window.open 全 deny）。复评触发 = #67，不得无票延长。
- 永久残留：extract-zip 两条 8.1（range=`*` 无修复版，安装/打包期影响面），升 Electron 亦不消除——audit 非绿不阻断验收。
- happy-dom 18→20 落地后 4 处 workaround 注释需同步复核（#64 验收项）。
