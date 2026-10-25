// 变异集示例：renderer-recovery-80（票 #80 的 27 条独立变异，rev2 目录全数 assertion-killed）。
//
// 这是 scripts/mutation-check.mjs 的**示例集，不是缺省集**——变异集按票逐份拟定，来源是
// 目标测试头注的「变异对照」段（见 packages/app-desktop/tests/rendererRecovery.test.ts
// 与 main-wiring.test.ts 头注）。本集钉的是 #80 崩溃恢复判据与其主进程接线：
//   - 纯判据侧（rendererRecovery.ts）：上限、稳定窗口、markLoaded/markUnstable 语义；
//   - 接线侧（main.ts）：时钟注入、dom-ready 起点登记、隐藏回收分流、加载失败兜底、
//     退出/销毁谓词的每处现查。
// 22/24/26/27 的 kill 语义是「退出/销毁后不得查询原生对象」的生命周期契约断言
// （不虚构下游 reload/fatal 行为），note 里已注明。
//
// 源码变了锚点会失配：setup 即逐条报错，重拟本文件再跑（勿为凑绿放宽锚点）。

const recoveryPath = 'packages/app-desktop/electron/rendererRecovery.ts';
const mainPath = 'packages/app-desktop/electron/main.ts';

export default {
  name: 'renderer-recovery-80',
  description: '#80 渲染进程崩溃恢复：判据四条 + main 接线的 27 条独立变异（示例集）',
  packageDir: 'packages/app-desktop',
  tests: ['tests/rendererRecovery.test.ts', 'tests/main-wiring.test.ts'],
  inputs: {
    dirs: ['packages/app-desktop/electron'],
    files: [
      'packages/app-desktop/tests/rendererRecovery.test.ts',
      'packages/app-desktop/tests/main-wiring.test.ts',
    ],
  },
  mutations: [
    {
      id: '01-markLoaded-unconditional-reset',
      path: recoveryPath,
      before: 'markLoaded(): void {\n      loadedAt = deps.now();',
      after: 'markLoaded(): void {\n      attempts = 0;\n      loadedAt = deps.now();',
      note: '每次成功加载都洗白崩溃预算：该升级的不升级，attempts 2/3 轮空。',
    },
    {
      id: '02-budget-greater-than',
      path: recoveryPath,
      before: 'if (attempts >= RELOAD_LIMIT)',
      after: 'if (attempts > RELOAD_LIMIT)',
      note: '第 4 次崩溃仍 reload 而非升级；纯判据与接线两侧断言都该红。',
    },
    {
      id: '03-stability-greater-than',
      path: recoveryPath,
      before: 'deps.now() - loadedAt >= RELOAD_STABILITY_WINDOW_MS',
      after: 'deps.now() - loadedAt > RELOAD_STABILITY_WINDOW_MS',
      note: '恰好 3000ms 稳定期不清零预算：等值边界必须有例。',
    },
    {
      id: '04-markLoaded-zero-origin',
      path: recoveryPath,
      before: 'loadedAt = deps.now();',
      after: 'loadedAt = 0;',
      note: '加载耗时被误记成稳定期：2999ms 仍应拿 attempt 2 而非 1。',
    },
    {
      id: '05-main-remove-markUnstable-wiring',
      path: mainPath,
      before: '      recovery.markUnstable();',
      after: '',
      note: '隐藏死亡 renderer 在等待期继续积累假稳定期；死亡前已满窗的恢复应消失。',
    },
    {
      id: '06-markUnstable-clear-only-old-regression',
      path: recoveryPath,
      before: 'markUnstable(): void {\n      settleStability();',
      after: 'markUnstable(): void {\n      loadedAt = undefined;',
      note: '只擦起点丢了「死亡前已满窗」的事实：旧回归（终身累计、第四次误退）复活。',
    },
    {
      id: '07-main-clock-always-zero',
      path: mainPath,
      before: 'now: () => performance.now(),',
      after: 'now: () => 0,',
      note: '真实接线无法度量稳定期：满窗后的第 4 次 reload 与 attempt-1 日志断言红。',
    },
    {
      id: '08-dom-ready-empty-callback',
      path: mainPath,
      before: "win.webContents.on('dom-ready', () => recovery.markLoaded());",
      after: "win.webContents.on('dom-ready', () => {});",
      note: '真实 main 永远记不到稳定期起点：同族稳定期恢复断言红。',
    },
    {
      id: '09-remove-still-running-ignore',
      path: recoveryPath,
      before: "      if (reason === 'still-running') return { action: 'ignore' };",
      after: '',
      note: 'still-running 误入重载面并吃预算：模块面与接线面断言红。',
    },
    {
      id: '10-hidden-eviction-reload-immediately',
      path: mainPath,
      before: "if (details.reason === 'memory-eviction' && !win.isVisible()) {",
      after: "if (false && details.reason === 'memory-eviction' && !win.isVisible()) {",
      note: '隐藏回收改为立即 reload 且可重复；隐藏/挂起/销毁不重载的断言红。',
    },
    {
      id: '11-Promise-fallback-immediate',
      path: mainPath,
      before:
        '    setImmediate(() => {\n      if (quitting || win.isDestroyed() || initialLoadInterrupted || win.webContents.isCrashed()) {\n        return;\n      }\n      failLoad(err, selfUrl);\n    });',
      after:
        '    (() => {\n      if (quitting || win.isDestroyed() || initialLoadInterrupted || win.webContents.isCrashed()) {\n        return;\n      }\n      failLoad(err, selfUrl);\n    })();',
      note: '拒绝微任务里过早观测崩溃态：彼时 dialog 必须还是空的（ProcessDied 竞争）。',
    },
    {
      id: '12-remove-initialLoadInterrupted-guard',
      path: mainPath,
      before: 'quitting || win.isDestroyed() || initialLoadInterrupted || win.webContents.isCrashed()',
      after: 'quitting || win.isDestroyed() || win.webContents.isCrashed()',
      note: 'gone 先行 reload 已清 isCrashed，陈旧初始 Promise 误报 fatal。',
    },
    {
      id: '13-remove-isCrashed-guard',
      path: mainPath,
      before: 'quitting || win.isDestroyed() || initialLoadInterrupted || win.webContents.isCrashed()',
      after: 'quitting || win.isDestroyed() || initialLoadInterrupted',
      note: 'Promise 先行的崩溃（含拒绝后置位）在 gone 通知之前误报 fatal。',
    },
    {
      id: '14-remove-did-fail-load-mainframe-filter',
      path: mainPath,
      before: 'if (!isMainFrame || errorCode === -3) return;',
      after: 'if (errorCode === -3) return;',
      note: '子框架加载错误误杀应用：dialog 1 而非 0。',
    },
    {
      id: '15-remove-did-fail-load-aborted-filter',
      path: mainPath,
      before: 'if (!isMainFrame || errorCode === -3) return;',
      after: 'if (!isMainFrame) return;',
      note: '主框架 ERR_ABORTED 误报致命：dialog 1 而非 0。',
    },
    {
      id: '16-ignore-all-did-fail-load-minus-two',
      path: mainPath,
      before: 'if (!isMainFrame || errorCode === -3) return;',
      after: 'if (!isMainFrame || errorCode === -3 || errorCode === -2) return;',
      note: '恢复后真实主框架 ERR_FAILED 被吞：dialog 0 而非 1。',
    },
    {
      id: '17-remove-failLoad-idempotence',
      path: mainPath,
      before: 'if (quitting || win.isDestroyed() || loadFailureReported) return;',
      after: 'if (quitting || win.isDestroyed()) return;',
      note: '重复 fatal 收尾：fatal 自身抑制第二个 dialog 不再遮蔽，exit:1 计数 3 而非 1。',
    },
    {
      id: '18-recovery-remove-quitting-guard',
      path: recoveryPath,
      before: "if (deps.isQuitting() || deps.isDestroyed()) return { action: 'ignore' };",
      after: "if (deps.isDestroyed()) return { action: 'ignore' };",
      note: '退出中仍 reload；显式 ignore 断言红。',
    },
    {
      id: '19-recovery-remove-destroyed-guard',
      path: recoveryPath,
      before: "if (deps.isQuitting() || deps.isDestroyed()) return { action: 'ignore' };",
      after: "if (deps.isQuitting()) return { action: 'ignore' };",
      note: '销毁后仍 reload；显式 ignore 断言红。',
    },
    {
      id: '20-failLoad-remove-quitting-guard',
      path: mainPath,
      before: 'if (quitting || win.isDestroyed() || loadFailureReported) return;',
      after: 'if (win.isDestroyed() || loadFailureReported) return;',
      note: '退出中的加载失败事件报 fatal；显式无 dialog 断言红。',
    },
    {
      id: '21-failLoad-remove-destroyed-guard',
      path: mainPath,
      before: 'if (quitting || win.isDestroyed() || loadFailureReported) return;',
      after: 'if (quitting || loadFailureReported) return;',
      note: '销毁后的加载失败事件报 fatal；显式无 dialog 断言红。',
    },
    {
      id: '22-gone-remove-quitting-guard',
      path: mainPath,
      before: '    if (quitting || win.isDestroyed()) return;',
      after: '    if (win.isDestroyed()) return;',
      note: 'gone 预筛丢退出检查。普通 reason 有下游 isQuitting 兜住；kill 依赖退出后 memory-eviction 不得查询 isVisible 的生命周期契约断言。',
    },
    {
      id: '23-gone-remove-destroyed-guard',
      path: mainPath,
      before: '    if (quitting || win.isDestroyed()) return;',
      after: '    if (quitting) return;',
      note: 'gone 预筛丢销毁检查：隐藏回收对已销毁对象查询 isVisible 抛错；not.toThrow 断言红。',
    },
    {
      id: '24-resume-remove-quitting-guard',
      path: mainPath,
      before: '      pendingMemoryEviction === undefined ||\n      quitting ||\n      win.isDestroyed() ||',
      after: '      pendingMemoryEviction === undefined ||\n      win.isDestroyed() ||',
      note: '退出后 resume 多读一次 isVisible。不 reload 语义仍有下游 isQuitting 兜住；kill 是这次多余的原生读，非「会发生重载」。',
    },
    {
      id: '25-resume-remove-destroyed-guard',
      path: mainPath,
      before: '      pendingMemoryEviction === undefined ||\n      quitting ||\n      win.isDestroyed() ||',
      after: '      pendingMemoryEviction === undefined ||\n      quitting ||',
      note: '销毁后 resume 查询可见性抛错；显式 not.toThrow 断言红。',
    },
    {
      id: '26-Promise-remove-quitting-guard',
      path: mainPath,
      before: 'quitting || win.isDestroyed() || initialLoadInterrupted || win.webContents.isCrashed()',
      after: 'win.isDestroyed() || initialLoadInterrupted || win.webContents.isCrashed()',
      note: '退出后的拒绝 Promise 多查一次 isCrashed。不 fatal 语义仍有 failLoad 兜住；kill 是这次多余的原生查询。',
    },
    {
      id: '27-Promise-remove-destroyed-guard',
      path: mainPath,
      before: 'quitting || win.isDestroyed() || initialLoadInterrupted || win.webContents.isCrashed()',
      after: 'quitting || initialLoadInterrupted || win.webContents.isCrashed()',
      note: '销毁后的拒绝 Promise 对已销毁对象查询 isCrashed；假面对该查询抛错并计数，断言红。',
    },
  ],
};
