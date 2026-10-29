// 变异集：editor-exit-gates-56（票 #56 出口门禁批的 10 条独立变异）。
//
// 变异集按票逐份拟定，来源是目标测试头注的「变异对照」段：
//   - packages/editor/tests/llm-pipeline.test.ts（#56 项 1/4 段）
//   - packages/editor/tests/llm-panel.test.ts（#89-2 + #56 自然红路径段）
//   - packages/editor/tests/render-commit.test.ts（#56 项 3 段）
//   - packages/editor/tests/app-assembly.test.ts（#56 项 2 段）
// 钉面：LLM 入包事务式整包把关（新增错误回滚/存量不误伤/撞名逐条拦截）、
// verbs 候选键 pattern 单一来源、数字清空态标红+失焦回填、导出/写游戏
// 三口的校验门禁。
//
// 源码变了锚点会失配：setup 即逐条报错，重拟本文件再跑（勿为凑绿放宽锚点）。

const pipelinePath = 'packages/editor/src/llm/pipeline.ts';
const renderPath = 'packages/editor/src/ui/render.ts';
const mainPath = 'packages/editor/src/main.ts';

export default {
  name: 'editor-exit-gates-56',
  description: '#56 editor 出口门禁批：入包事务把关/撞名拦截/pattern 收编/清空回填/导出门禁的 10 条独立变异',
  packageDir: 'packages/editor',
  tests: [
    'tests/llm-pipeline.test.ts',
    'tests/llm-panel.test.ts',
    'tests/render-commit.test.ts',
    'tests/app-assembly.test.ts',
  ],
  inputs: {
    dirs: ['packages/editor/src'],
    files: [
      'packages/editor/tests/llm-pipeline.test.ts',
      'packages/editor/tests/llm-panel.test.ts',
      'packages/editor/tests/render-commit.test.ts',
      'packages/editor/tests/app-assembly.test.ts',
      'packages/editor/tests/helpers.ts',
    ],
  },
  mutations: [
    {
      id: '01-apply-drop-transactional-gate',
      path: pipelinePath,
      before: '      if (added.length > 0) {',
      after: '      if (false && added.length > 0) {',
      note: '事务把关失效：悬空 drops 候选入包不回滚——pipeline 悬空用例、panel 自然红路径、包未改动断言红。',
    },
    {
      id: '02-apply-baseline-emptied',
      path: pipelinePath,
      before: '    const baselineKeys = new Set(baseline.ok ? [] : baseline.errors.map(errorKeyOf));',
      after: '    const baselineKeys = new Set<string>();',
      note: '对照底清空：存量错误被误判为新增，带错编辑期入包被堵死——「不误伤」用例红。',
    },
    {
      id: '03-apply-drop-dup-id-skip',
      path: pipelinePath,
      before: "      if (typeof entry.id === 'string' && claimedIds.has(entry.id)) {",
      after: "      if (false && typeof entry.id === 'string' && claimedIds.has(entry.id)) {",
      note: '撞名入包口拦截失效：撞名候选混入同批（靠事务兜底整批回滚）——撞名用例经门禁抛错红（抛错路径击杀，同 02 号口径）。',
    },
    {
      id: '04-verb-pattern-source-severed',
      path: pipelinePath,
      before: "  return Object.keys(root.properties?.['verbs']?.patternProperties ?? {})[0];",
      after: '  return undefined;',
      note: 'pattern 单一来源断链（漂移面复活）：单一来源钉住用例红。',
    },
    {
      id: '05-number-clear-pending-dropped',
      path: renderPath,
      before: "      input.classList.add('input-pending');",
      after: '',
      note: '清空态标红丢失：UI 与数据静默分叉复发——清空用例的 input-pending 断言红。',
    },
    {
      id: '06-number-blur-restore-severed',
      path: renderPath,
      before: "    input.value = typeof value === 'number' ? String(value) : '';",
      after: "    input.value = '';",
      note: '失焦回填失效：清空后 blur 显示空、与数据旧值继续分叉——回填断言红。',
    },
    {
      id: '07-export-json-gate-dropped',
      path: mainPath,
      before: "  document.querySelector('#btn-export-json')?.addEventListener('click', () => {\n    if (!requirePack() || !confirmExportDespiteErrors()) return;",
      after: "  document.querySelector('#btn-export-json')?.addEventListener('click', () => {\n    if (!requirePack()) return;",
      note: 'json 出口门禁拆除：带错导出不弹确认直接出包——装配门禁用例红。',
    },
    {
      id: '08-export-zip-gate-dropped',
      path: mainPath,
      before: "  document.querySelector('#btn-export-zip')?.addEventListener('click', () => {\n    if (!requirePack() || !confirmExportDespiteErrors()) return;",
      after: "  document.querySelector('#btn-export-zip')?.addEventListener('click', () => {\n    if (!requirePack()) return;",
      note: 'zip 出口门禁拆除：带错 zip 不弹确认直接出包——装配门禁用例红。',
    },
    {
      id: '09-to-game-gate-dropped',
      path: mainPath,
      before: "  document.querySelector('#btn-to-game')?.addEventListener('click', () => {\n    if (!requirePack() || !confirmExportDespiteErrors()) return;",
      after: "  document.querySelector('#btn-to-game')?.addEventListener('click', () => {\n    if (!requirePack()) return;",
      note: '写游戏出口门禁拆除：带错包直写游戏（壳层 fail-fast 拒启风险）——装配门禁用例红。',
    },
    {
      id: '10-export-gate-validate-severed',
      path: mainPath,
      before: '  function confirmExportDespiteErrors(): boolean {\n    const result = validateContentPack(store.state.pack);',
      after: '  function confirmExportDespiteErrors(): boolean {\n    const result = { ok: true } as { ok: boolean; errors: never[] };',
      note: '门禁判定恒放行：形同虚设——干净包零确认与带错确认两组断言双红。',
    },
  ],
};
