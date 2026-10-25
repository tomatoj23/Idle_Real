// 变异集：editor-writeback-49（票 #49 写回收敛的 11 条独立变异）。
//
// 来源：packages/editor/tests/render-commit.test.ts 头注「变异对照」段 +
// edit-export.test.ts 新真断言（:93 恒真式改语义白名单）的承重证明。
// 钉的是 render.ts 写回单门的三面：
//   - remapExpanded 重映射纯函数（删除平移 / 移动区间旋转 / 插入 +1）；
//   - mutate 控制器策略（insert 就地展开、off-by-one 复活即红、toggle、replace 落点）；
//   - 渲染树接线（xrefPool 参数化、mutate 必经重映射）与骨架数值地板
//     （defaults.ts exclusiveMinimum 收敛——白名单断言的承重变异）。
//
// 源码变了锚点会失配：setup 即逐条报错，重拟本文件再跑（勿为凑绿放宽锚点）。

const renderPath = 'packages/editor/src/ui/render.ts';
const defaultsPath = 'packages/editor/src/core/defaults.ts';

export default {
  name: 'editor-writeback-49',
  description: '#49 编辑器写回收敛：remapExpanded 三律 + mutate 策略 + 接线 + 骨架地板的 11 条变异',
  packageDir: 'packages/editor',
  tests: ['tests/render-commit.test.ts', 'tests/edit-export.test.ts'],
  inputs: {
    dirs: ['packages/editor/src'],
    files: [
      'packages/editor/tests/render-commit.test.ts',
      'packages/editor/tests/edit-export.test.ts',
    ],
  },
  mutations: [
    {
      id: '01-remove-remap-only-own-index',
      path: renderPath,
      before: "    case 'remove':\n      if (index === op.at) {\n        return null;\n      }\n      return index > op.at ? index - 1 : index;",
      after: "    case 'remove':\n      if (index === op.at) {\n        return null;\n      }\n      return index;",
      note: '历史 bug 复活（删除只删单下标，上方条目展开态全错位）：纯函数用例与删中间条目 DOM 回归双红。',
    },
    {
      id: '02-move-remap-no-rotation',
      path: renderPath,
      before: "    case 'move':\n      if (index === op.from) {\n        return op.to;\n      }\n      if (op.from < op.to) {\n        return index > op.from && index <= op.to ? index - 1 : index;\n      }\n      return index >= op.to && index < op.from ? index + 1 : index;",
      after: "    case 'move':\n      if (index === op.from) {\n        return op.to;\n      }\n      return index;",
      note: '历史 bug 复活（拖拽只迁 from→to，区间不旋转）：移动纯函数用例与拖拽 DOM 用例红。',
    },
    {
      id: '03-insert-remap-no-shift',
      path: renderPath,
      before: '      return index >= op.at ? index + 1 : index;',
      after: '      return index;',
      note: '插入位之后的展开下标不 +1：插入中间位纯函数用例红。',
    },
    {
      id: '04-lose-insert-expand',
      path: renderPath,
      before: "        if (op.kind === 'insert') {\n          expanded.add(op.at);\n        }",
      after: '',
      note: '新增条目不再就地展开：新增 DOM 用例红。',
    },
    {
      id: '05-insert-expand-off-by-one',
      path: renderPath,
      before: "        if (op.kind === 'insert') {\n          expanded.add(op.at);\n        }",
      after: "        if (op.kind === 'insert') {\n          expanded.add(op.at + 1);\n        }",
      note: '票面原 off-by-one（expanded.add(value.length)）形态复活：新条目不展开且遗幽灵下标，新增 DOM 用例红。',
    },
    {
      id: '06-toggle-never-collapse',
      path: renderPath,
      before: '      toggleEntry: (index) => {\n        if (expanded.has(index)) {\n          expanded.delete(index);\n        } else {\n          expanded.add(index);\n        }\n        rerender();\n      },',
      after: '      toggleEntry: (index) => {\n        expanded.add(index);\n        rerender();\n      },',
      note: '收起失效（只能展开不能收）：展开切换 DOM 用例红。',
    },
    {
      id: '07-replace-append-not-replace',
      path: renderPath,
      before: '      list[op.at] = op.value;',
      after: '      list.push(op.value);',
      note: 'oneOf 换支改成追加新条目：换支 DOM 用例（原位替换 + 展开跟随）红。',
    },
    {
      id: '08-xref-pool-dead',
      path: renderPath,
      before: '      xrefPool: (target) => xrefOptions(store.state.pack, target),',
      after: '      xrefPool: () => [],',
      note: 'D3 参数化断线（候选池恒空）：datalist 活体用例红。',
    },
    {
      id: '09-mutate-skip-remap',
      path: renderPath,
      before: '        const remapped = remapExpanded(expanded, op);',
      after: '        const remapped = new Set(expanded);',
      note: 'mutate 绕过重映射单点（原集合原样回填）：删中间/拖拽两个 DOM 用例红。',
    },
    {
      id: '10-moveup-identity',
      path: renderPath,
      before: '      commit.mutate({ kind: \'move\', from: index, to: index - 1 });',
      after: '      commit.mutate({ kind: \'move\', from: index, to: index });',
      note: '上移按钮改恒等操作（数据不动、展开态错迁）：上移/下移 DOM 用例红。',
    },
    {
      id: '11-skeleton-number-floor-zero',
      path: defaultsPath,
      before: '  let value = min ?? (exclMin !== undefined ? Math.floor(exclMin) + 1 : 0);',
      after: '  let value = min ?? (exclMin !== undefined ? Math.floor(exclMin) : 0);',
      note: '骨架数值地板丢失（exclusiveMinimum:0 取 0）：attackInterval 结构违规，edit-export 语义白名单真断言红——证「骨架合法性有人验证」。',
    },
  ],
};
