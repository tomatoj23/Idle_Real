// 变异集：semantic-surface-100（票 #100 用户可见校验面补语义面的 4 条独立变异）。
//
// 变异集按票逐份拟定，来源是目标测试头注的「变异对照」段：
//   - packages/editor/tests/validate-surface-100.test.ts（#100 段）
// 钉面：带 schema 错包的语义面并入用户可见校验面——合并入口
// visibleValidation（core/validate.ts）的语义半边与身份去重，以及
// panel.ts / main.ts（confirmExportDespiteErrors）两处接线不被摘除。
// 入包门禁侧（pipeline.ts）的语义半边不在本集（见 semantic-gate-94.mjs）。
//
// 源码变了锚点会失配：setup 即逐条报错，重拟本文件再跑（勿为凑绿放宽锚点）。

const helperPath = 'packages/editor/src/core/validate.ts';
const panelPath = 'packages/editor/src/ui/panel.ts';
const mainPath = 'packages/editor/src/main.ts';

export default {
  name: 'semantic-surface-100',
  description:
    '#100 用户可见校验面补语义面：合并入口语义半边/身份去重 + 面板/导出确认两处接线的 4 条独立变异',
  packageDir: 'packages/editor',
  tests: ['tests/validate-surface-100.test.ts'],
  inputs: {
    dirs: ['packages/editor/src'],
    files: ['packages/editor/tests/validate-surface-100.test.ts', 'packages/editor/tests/helpers.ts'],
  },
  mutations: [
    {
      id: '01-helper-semantic-severed',
      path: helperPath,
      before: '  for (const error of validatePackSemantics(pack)) {',
      after: '  for (const error of [] as readonly ContentError[]) {',
      note: '合并入口语义半边摘除：带 schema 错包的存量语义错不再并入——面板红条缺语义错行/计数缺面，导出确认无「含语义错」注记，两处用例红。',
    },
    {
      id: '02-helper-dedup-severed',
      path: helperPath,
      before:
        '  for (const error of validatePackSemantics(pack)) {\n    merged.set(errorKeyOf(error), error);\n  }',
      after:
        "  for (const error of validatePackSemantics(pack)) {\n    merged.set('\\u0000' + errorKeyOf(error), error);\n  }",
      note: '身份去重摘除（语义面键加前缀即恒异键）：仅语义错包的语义面被二次并入——计数翻倍、「含语义错」注记现身，防双计用例红。',
    },
    {
      id: '03-panel-wiring-severed',
      path: panelPath,
      before: '      const result = visibleValidation(store.state.pack);',
      after: '      const result = { ok: true as boolean, errors: [], extraSemantic: 0 };',
      note: '面板接线摘除（恒 ok 换绿）：校验面板对带错包恒报合法——面板红条三用例（计数/语义行/不双计）红。',
    },
    {
      id: '04-confirm-wiring-severed',
      path: mainPath,
      before: '    const result = visibleValidation(store.state.pack);',
      after: '    const result = { ok: true as boolean, errors: [], extraSemantic: 0 };',
      note: '导出确认接线摘除（恒 ok 换绿）：confirmExportDespiteErrors 恒静默放行——确认消息不弹（confirms 空）且下载计数增长，装配级两用例红。',
    },
  ],
};
