# #96 harness 抗遮挡验收留痕（setBackgroundThrottling(false) + 失败链 visibilityState 取证）

日期：2026-11-04。机器：Windows 10 x64（双显示器：主 2560×1440 / 副 1920×1080），Electron 44.10.1。
改动：`packages/app-desktop/scripts/electron-acceptance.mjs`（工装面）——窗口创建点
`setBackgroundThrottling(false)` + 失败链经 `executeJavaScript` 取 `document.visibilityState`/
`hasFocus` 并入 harness-error 事件（1s 竞速兜底，写盘先于 `app.exit(2)`）。
原始报告目录在 `.scratch/adv96/`（会话清理即失效，本文为长期背书）。

## 结论

harness normal-ui 的「窗口被完全遮挡/最小化 → Chromium 停发 rAF → 壳层重绘链停滞 →
断言拿旧 DOM 假阴性」机理定案成立，因果对照成对证得（**对照红出具于最终代码**——code
review 修复批（fail 幂等闸）之后复跑）：

| 跑（.scratch/adv96/） | 构造 | 节流 | 结果 | 关键读数 |
| --- | --- | --- | --- | --- |
| `occ-contrast-final` | 遮挡窗盖主窗（出生即盖） | 临时复开（true） | **红** code=2 | 断言红点=`existing UI start transitioned to running stop state after ticks`（#91 flake 同点）；`stopButtonPresent:false`；harness-error 恰 1 条带 `page:{visibilityState:"hidden", hasFocus:true}`——**visibilityState 判别面在案 + fail 幂等闸生效**（修复前 `occ-contrast-v2` 同判同读数） |
| `occ-green-v2` / `occ-green-v3` | 同上构造 | 关（修法） | **绿** code=0 | `stopButtonPresent:true`、截图非空 1264×761；成功期 vis 读 `visible`——**修法激活下的预期**（见机理②，非「遮挡没生效」） |

八场景整跑（最终代码，无遮挡无诊断面）：`.scratch/adv96/full-8of8-final`，**8/8 绿，`sourceFrozen:true`**。
分级计数：crash-loop 4 真 4 调用 1 dialog；stable-reset [1,2,3,1,2] 5 真；initial-death 1 真 +
load-rejection 链；两注入场景各 4 真 + 2 注入（injected 与真死分开计数）；missing-index/close-loading
按设计。判定器 `--self-test` 14/14 全过。证据出具时点申报：遮挡绿两例出具于 review 修复批之前
（success 路径与节流行为在该批中零改动）；最终代码的 normal-ui 绿由整跑覆盖，对照红已按最终
代码复跑（上表）。

## 机理定案（两条，源码级）

1. **遮挡停 rAF 与 visibilityState 判别面**：窗口被完全盖住或最小化 → Chromium 停发 rAF。
   `isVisible()`/`isFocused()` 被遮挡时仍为 true（对照跑实测 `hasFocus:true`+`hidden` 并存），
   `document.visibilityState` 翻 hidden 是唯一判别面——**但只在节流开时成立**。
2. **`setBackgroundThrottling(false)` 的豁免机制 = 吞掉 hidden 迁移本身**：Electron
   `shell/browser/api/electron_api_web_contents.cc` `SetBackgroundThrottling`（本地快照
   46.0 线，:3814 起）对每个帧宿主置 `RenderWidgetHost::disable_hidden_ = !allowed` 并
   `SetSchedulerThrottling(allowed)`——hidden 迁移被 `disable_hidden_` 吞掉，页面对自己恒报
   visible、rAF 不停。**同一开关既解锁重绘也掩盖可见性判别面**：修法激活的 harness 跑失败链
   读 visible 属预期；hidden 只出现在对照跑（节流临时复开）与产品实际态。三例独立复现
   （#92 反方 d2-advocc-off `vis:"visible"+rAF 照跑`、#96 occ-green-v2/v3 同型）。

## 构造法与一次教训（一次性驱动的坑）

- **有效构造**（occ-contrast-final / occ-green-v2/v3 实证）：外置 electron 进程建置顶不透明黑窗
  只盖主窗落点区域（默认居中 (640,300,1280,800) 的 +20px 外沿），`focusable:false`，主窗
  出生即被盖、不最小化；**遮挡窗贴 runner 的 `scenario-start` 建**（间隔落 ~4s）。同构造下
  对照红/修法绿成对，因果归因干净。
- **无效构造教训（v1，occ-green / occ-contrast-red 两跑作废）**：遮挡窗盖满主屏工作区且先坐
  ~60s（构建期间）再让主窗出生即盖——节流开下 DOM 照更新（遮挡未被记账），对照假绿。同文件
  探针（.scratch/adv96/probe-occlusion.mjs / probe-c / probe-d 已落档；60s 间隔例证=probe-e
  内联 node -e **未落档**）证明出生即盖在 2.5s/0.5s/60s 间隔、跨进程、带节流调用各变体下对
  **裸页面**都稳定记账（raf:0, vis:hidden），唯全屏尺寸+长时间先坐的实 harness 跑失灵 2/2
  ——机理未深究，**做法上收窄为：遮挡窗只盖主窗区域 + 贴 scenario-start 建**（此构造共
  4 跑全符合预期：对照可观测面 2/2 记账成立 vis:hidden；绿跑 2 跑记账被修法掩盖不可观测）。
  另：全屏遮挡窗会长时间遮黑用户桌面，已改小窗并加自杀看门狗（防驱动崩溃残留黑屏）。
- 探针判别面：`document.visibilityState` + rAF 计数（页面内 `requestAnimationFrame` 累加器）
  直读，比 `isVisible/isFocused` 可靠。

## 边界申报

- 一次性驱动、探针、遮挡窗均在 `.scratch/adv96/`，**不入库**；harness 交付面只有节流豁免 +
  失败链取证两处，场景构成与判定口径零改动（`--self-test` 14 用例原样全过）。code review
  双轴（Standards/Spec 独立子代理）复核后采纳一处修复：`fail()` 入口置 `finished` 赢家定序——
  probe ≤1s 窗口内并发来的 success/二次 fail 不再跑（防取证面被自然退出冲掉、防重复
  harness-error）；修复后对照红已复跑核验（恰 1 条 harness-error）。
- 产品代码零改动（遮挡时节流降 CPU 是产品期望行为；tick 循环 setInterval 驱动 + dt 补偿，
  账目不受影响）。
- harness 非 vitest 面，以实跑为验收；check/test 照常全绿（测试基线不变）。
