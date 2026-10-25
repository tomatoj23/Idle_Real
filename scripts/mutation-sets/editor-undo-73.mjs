// 变异集：editor-undo-73（票 #73 editor undo/redo + update 异常语义的 14 条独立变异）。
//
// 来源：packages/editor/tests/state.test.ts 头注「变异对照」段 +
// tests/app-assembly.test.ts #73 describe 头注。钉的是 store 层快照栈与
// main.ts 接线两面：
//   - update 提交记账（入 undo 栈 / 分叉清重做栈 / 上限 50 挤出）；
//   - undo/redo 整树换装（swapTree 换包 + 标脏 + future 回填）；
//   - update 抛错整树回滚（快照回装 + rollback 事件）；
//   - loadPack 截断历史；
//   - main.ts 'history' 分支接线（collapseAll + repaintForm + syncChrome）
//     与键盘映射（shift+z=重做、Ctrl+Y=重做、undo 按钮活线）。
//
// 源码变了锚点会失配：setup 即逐条报错，重拟本文件再跑（勿为凑绿放宽锚点）。

const statePath = 'packages/editor/src/core/state.ts';
const mainPath = 'packages/editor/src/main.ts';

export default {
  name: 'editor-undo-73',
  description: '#73 editor undo/redo 快照栈 + 抛错回滚：store 记账/换装/回滚 + main 接线的 14 条变异',
  packageDir: 'packages/editor',
  tests: ['tests/state.test.ts', 'tests/app-assembly.test.ts'],
  inputs: {
    dirs: ['packages/editor/src'],
    files: [
      'packages/editor/tests/state.test.ts',
      'packages/editor/tests/app-assembly.test.ts',
    ],
  },
  mutations: [
    {
      id: '01-update-no-history-push',
      path: statePath,
      before: '      recordSnapshot(snapshot);\n      future.length = 0; // 新提交分叉即弃：被撤销的旧线不可达',
      after: '      future.length = 0; // 新提交分叉即弃：被撤销的旧线不可达',
      note: 'update 提交不入 undo 栈：canUndo 恒 false，撤销族用例全红。',
    },
    {
      id: '02-update-fork-keeps-redo',
      path: statePath,
      before: '      future.length = 0; // 新提交分叉即弃：被撤销的旧线不可达',
      after: '',
      note: '新提交不清重做栈：撤销后改线再 redo 会复活已分叉旧线，分叉用例红。',
    },
    {
      id: '03-cap-shift-dropped',
      path: statePath,
      before: '    if (past.length > HISTORY_LIMIT) {\n      past.shift();\n    }',
      after: '',
      note: '上限 50 挤出丢失：51 笔后撤 50 次 canUndo 仍 true，上限用例红。',
    },
    {
      id: '04-undo-no-future-push',
      path: statePath,
      before: '      future.push(clonePack());\n      swapTree(prev);',
      after: '      swapTree(prev);',
      note: 'undo 不回填重做栈：redo 永远 false，重做族用例红。',
    },
    {
      id: '05-swap-tree-no-op',
      path: statePath,
      before: "  const swapTree = (pack: Record<string, unknown>): void => {\n    state = { ...state, pack, dirty: true };\n    notify('history');\n  };",
      after: "  const swapTree = (pack: Record<string, unknown>): void => {\n    notify('history');\n  };",
      note: 'undo/redo 只发事件不换树：值断言全红（事件仍在，假撤销）。',
    },
    {
      id: '06-swap-tree-dirty-false',
      path: statePath,
      before: '  const swapTree = (pack: Record<string, unknown>): void => {\n    state = { ...state, pack, dirty: true };',
      after: '  const swapTree = (pack: Record<string, unknown>): void => {\n    state = { ...state, pack, dirty: false };',
      note: '历史换装清脏（保守标脏语义丢失）：undo/redo 标脏用例红。',
    },
    {
      id: '07-rollback-install-dropped',
      path: statePath,
      before: "      } catch (cause) {\n        state = { ...state, pack: snapshot };\n        notify('rollback');\n        throw cause;\n      }",
      after: '      } catch (cause) {\n        throw cause;\n      }',
      note: 'fn 抛错不回滚：半途变异保留（原票 [中] 缺陷复活），回滚值断言红。',
    },
    {
      id: '08-rollback-notify-dropped',
      path: statePath,
      before: "        notify('rollback');\n        throw cause;",
      after: '        throw cause;',
      note: 'rollback 事件丢失：监听方无法重绑活引用，rollback 通知断言红。',
    },
    {
      id: '09-loadpack-history-kept',
      path: statePath,
      before: '      // 整树替换截断历史（#73）：undo 退回另一个包是语义泥潭，双向清空。\n      past.length = 0;\n      future.length = 0;',
      after: '      // 整树替换截断历史（#73）：undo 退回另一个包是语义泥潭，双向清空。',
      note: 'loadPack 不截断历史：跨包撤销复活，截断用例红。',
    },
    {
      id: '10-history-branch-no-repaint',
      path: mainPath,
      before: "      controller.collapseAll();\n      refreshAll();\n      repaintForm();\n      return;\n    }\n    if (event === 'rollback') {",
      after: "      controller.collapseAll();\n      refreshAll();\n      return;\n    }\n    if (event === 'rollback') {",
      note: "main.ts 'history' 分支丢 repaintForm：撤销后表单滞留旧 DOM（卡数不恢复），装配用例红。",
    },
    {
      id: '11-history-branch-no-collapse',
      path: mainPath,
      before: "      controller.collapseAll();\n      refreshAll();\n      repaintForm();\n      return;\n    }\n    if (event === 'rollback') {",
      after: "      refreshAll();\n      repaintForm();\n      return;\n    }\n    if (event === 'rollback') {",
      note: "main.ts 'history' 分支丢 collapseAll：旧下标展开态跨树残留（假展开），装配展开态用例红。",
    },
    {
      id: '12-key-shift-z-maps-undo',
      path: mainPath,
      before: '      if (event.shiftKey) {\n        store.redo();\n      } else {\n        store.undo();\n      }',
      after: '      if (event.shiftKey) {\n        store.undo();\n      } else {\n        store.undo();\n      }',
      note: 'shift+z 误配撤销：键盘重做路径红（装配用例 shift+z 步骤卡数不符）。',
    },
    {
      id: '13-refreshall-no-chrome-sync',
      path: mainPath,
      before: '  function refreshAll(): void {\n    validatePanel.refresh();\n    repaintNav();\n    syncChrome();\n  }',
      after: '  function refreshAll(): void {\n    validatePanel.refresh();\n    repaintNav();\n  }',
      note: 'refreshAll 不同步撤销按钮禁用态：撤销后 undo 按钮仍可点，装配按钮态断言红。',
    },
    {
      id: '14-undo-btn-dead',
      path: mainPath,
      before: "  undoBtn.addEventListener('click', () => {\n    store.undo();\n  });",
      after: "  undoBtn.addEventListener('click', () => {\n    return;\n  });",
      note: '撤销按钮脱线（store.undo 丢失）：按钮路径撤销失效，装配用例红。',
    },
    {
      id: '15-rollback-branch-no-toast',
      path: mainPath,
      before: "      refreshAll();\n      repaintForm();\n      showToast('上一步编辑未生效（已回滚）');",
      after: '      refreshAll();\n      repaintForm();',
      note: "'rollback' 分支丢回滚提示：toast 滞留上一条消息，装配 rollback 用例红（splice 定点注入驱动真 UI）。",
    },
  ],
};
