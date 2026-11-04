// 变异集：press-guard-99（票 #99 按压窗口守卫的 4 条独立变异）。
//
// 变异集按票逐份拟定，来源是目标测试头注的「变异对照」段：
//   - packages/app-desktop/tests/pressGuard.test.ts
// 钉面：心跳整页换血让路给进行中按压的四角——换血守卫本体、推迟期 lastSig
// 不动（navigate/env.render 强制重建等价面）、释放后补换血宏任务（click 先
// 落地）、release 饥饿超时放行。
//
// 源码变了锚点会失配：setup 即逐条报错，重拟本文件再跑（勿为凑绿放宽锚点）。

const uiPath = 'packages/app-desktop/src/ui.ts';

export default {
  name: 'press-guard-99',
  description: '#99 按压窗口守卫：守卫摘除/lastSig 误写/释放补换血摘除/饥饿兜底摘除 4 条独立变异',
  packageDir: 'packages/app-desktop',
  tests: ['tests/pressGuard.test.ts'],
  inputs: {
    dirs: ['packages/app-desktop/src'],
    files: [
      'packages/app-desktop/tests/pressGuard.test.ts',
      'packages/app-desktop/tests/helpers/mount.ts',
    ],
  },
  mutations: [
    {
      id: '01-swap-guard-severed',
      path: uiPath,
      before: '      if (!journalIncremental && pressActive) {',
      after: '      if (false) {',
      note: '换血守卫摘除：按压期间照常整页换血（#99 吞点击缺陷复发）——三夹具的「原节点存活」断言红。',
    },
    {
      id: '02-lastsig-clobbered-on-defer',
      path: uiPath,
      before: '      if (!journalIncremental && pressActive) {\n        rebuildPending = true;',
      after: '      if (!journalIncremental && pressActive) {\n        rebuildPending = true;\n        lastSig = sig;',
      note: '推迟期误写 lastSig（票评②反例）：补换血时签名比较不再命中，释放/超时后重建永久丢失——三夹具的「补换血落地」断言红。',
    },
    {
      id: '03-release-flush-severed',
      path: uiPath,
      before: '    if (via === \'up\') {\n      setTimeout(render, 0);',
      after: '    if (false) {\n      setTimeout(render, 0);',
      note: '释放补换血摘除：真抬起路径不再补 render（click 落地了但页面滞留旧态）——按压跨换血/切页两夹具的释放后断言红。',
    },
    {
      id: '04-starvation-timeout-severed',
      path: uiPath,
      before: '    pressGuardTimer = setTimeout(() => releasePress(\'timeout\'), PRESS_DEFER_MAX_MS);',
      after: '    pressGuardTimer = null;',
      note: '饥饿兜底摘除（票评③反例）：pointerup 不达时换血被永久推迟——饥饿夹具的「超时放行」断言红。',
    },
  ],
};
