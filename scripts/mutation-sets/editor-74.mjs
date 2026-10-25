// 变异集：editor-74（票 #74 的 12 条独立变异）。
//
// 来源 = 目标测试头注的「变异对照」段：
//   - tests/llm-panel.test.ts（项 11 勾选重绘 / 项 7 取消 / 项 6 key 剥离）
//   - tests/pack-section.test.ts + tests/render-commit.test.ts（项 2 形态守卫）
//   - tests/app-assembly.test.ts（项 4 行错误态 / 项 8 gotoError / 项 10 脏守卫）
//   - tests/io-files.test.ts（项 3 非 UTF-8 拒绝）
// 源码变了锚点会失配：setup 即逐条报错，重拟本文件再跑（勿为凑绿放宽锚点）。

const llmPanelPath = 'packages/editor/src/ui/llmPanel.ts';
const configPath = 'packages/editor/src/llm/config.ts';
const pipelinePath = 'packages/editor/src/llm/pipeline.ts';
const renderPath = 'packages/editor/src/ui/render.ts';
const mainPath = 'packages/editor/src/main.ts';
const filesPath = 'packages/editor/src/io/files.ts';

export default {
  name: 'editor-74',
  description: '#74 editor 边角收敛批：勾选重绘/取消/key 剥离/形态守卫/行错误态/gotoError/脏守卫/UTF-8 拒绝',
  packageDir: 'packages/editor',
  tests: [
    'tests/llm-panel.test.ts',
    'tests/pack-section.test.ts',
    'tests/render-commit.test.ts',
    'tests/app-assembly.test.ts',
    'tests/io-files.test.ts',
  ],
  inputs: {
    dirs: ['packages/editor/src'],
    files: [
      'packages/editor/tests/llm-panel.test.ts',
      'packages/editor/tests/pack-section.test.ts',
      'packages/editor/tests/render-commit.test.ts',
      'packages/editor/tests/app-assembly.test.ts',
      'packages/editor/tests/io-files.test.ts',
      'packages/editor/tests/helpers.ts',
    ],
  },
  mutations: [
    {
      id: '01-checkbox-no-repaint',
      path: llmPanelPath,
      before:
        'candidate.approved = checkbox.checked;\n        // #74 项 11：两态由本函数单点自持——勾选即整表重绘（个位数规模），\n        // 计数与可用态不再有第二条维护路径（曾漏此步致主路径堵死）。\n        repaintCandidates();',
      after: 'candidate.approved = checkbox.checked;',
      note: '复活票评追加项的原始缺陷：勾选只改数据不重绘，入包按钮恒灰主路径堵死。',
    },
    {
      id: '02-cancel-no-abort',
      path: llmPanelPath,
      before: 'abortController?.abort();',
      after: '',
      note: '取消按钮空转：signal 不到 client、busy 不复位。',
    },
    {
      id: '03-config-keep-plaintext-key',
      path: configPath,
      before: 'const persisted = config.rememberApiKey ? config : { ...config, apiKey: \'\' };',
      after: 'const persisted = config;',
      note: '「仅本会话」名存实亡：不勾记住时明文 key 照落 localStorage。',
    },
    {
      id: '04-pipeline-verbs-raw-assert',
      path: pipelinePath,
      before:
        '      const verbs = packRecordOf(packRecordOf(pack[\'combatText\'])?.[\'verbs\']);\n      if (verbs === undefined) {\n        skipAll();\n        return;\n      }',
      after: '      const verbs = (pack[\'combatText\'] as { verbs: Record<string, unknown> }).verbs;',
      note: '复活旧码裸断言：combatText.verbs 缺失即 TypeError。',
    },
    {
      id: '05-pipeline-section-raw-assert',
      path: pipelinePath,
      before:
        '    const section = packSectionArray(pack, kind);\n    if (section === undefined) {\n      skipAll();\n      return;\n    }',
      after: '    const section = pack[kind] as unknown[];',
      note: '复活旧码裸断言：目标节非数组即 TypeError。',
    },
    {
      id: '06-render-entryop-guard-drop',
      path: renderPath,
      before:
        '  const mutable = packSectionArray(pack, section);\n  if (mutable === undefined) {\n    throw new Error(`内容节 ${section} 不是数组（包形态损坏），操作未生效`);\n  }',
      after: '  const mutable = pack[section] as unknown[];',
      note: 'EntryOp 数据面守卫退役：节数组被旁门删除后结构写 TypeError 且无回滚语义。',
    },
    {
      id: '07-render-entry-body-guard-off',
      path: renderPath,
      before: '    if (entry === undefined) {',
      after: '    if (entry === undefined && false) {',
      note: '非对象条目守卫旁路：renderObjectFields 对 undefined 取 in 运算符即炸。',
    },
    {
      id: '08-errormarks-unwire',
      path: mainPath,
      before:
        '    // 行错误态联动（#74-4）：当前节的错误按 data-path 标回表单行。\n    applyErrorMarks(\n      formArea,\n      store.state.section === null ? [] : (validatePanel.errorsBySection().get(store.state.section) ?? []),\n    );',
      after: '',
      note: '行错误态接线拆除：清空必填字段后行永不标红。',
    },
    {
      id: '13-errormarks-collapse-cross-entry',
      path: renderPath,
      before: '        errorKey.firstIndex === rowKey.firstIndex &&',
      after: '',
      note: '折叠匹配丢条目首下标对齐：未展开条目的嵌套行错误误标已展开兄弟条目的同形行，跨条目用例红。',
    },
    {
      id: '10-goto-no-expand',
      path: mainPath,
      before:
        '    const entryIndex = Number.parseInt(segments[1] ?? \'\', 10);\n    if (!Number.isNaN(entryIndex)) {\n      controller.expandEntry(entryIndex);\n    }',
      after: '    const entryIndex = Number.parseInt(segments[1] ?? \'\', 10);',
      note: '错误定位不展开条目：收起态下 data-path 行不存在，定位落空。',
    },
    {
      id: '11-sample-load-no-dirty-guard',
      path: mainPath,
      before: '    if (!confirmDirtyLoad(store, (message) => window.confirm(message))) return;',
      after: '',
      note: '脏包载入守卫拆除：有未导出改动也直接整树替换（确认弹窗消失）。',
    },
    {
      id: '12-files-no-utf8-reject',
      path: filesPath,
      before: "  if (text.includes('\\uFFFD')) {",
      after: "  if (false && text.includes('\\uFFFD')) {",
      note: '非 UTF-8 检测旁路：GBK 包 mojibake 后报不可读的 JSON SyntaxError。',
    },
  ],
};
