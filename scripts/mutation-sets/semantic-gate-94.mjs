// 变异集：semantic-gate-94（票 #94 带错包语义半边门禁的 2 条独立变异）。
//
// 变异集按票逐份拟定，来源是目标测试头注的「变异对照」段：
//   - packages/editor/tests/llm-pipeline.test.ts（#94 段）
// 钉面：applyCandidates 事务门禁的语义半边——带 schema 错包状态下对照底
// 与入包后两侧的独立语义入口（validatePackSemantics）补齐调用。
// content 侧校验器本体（validatePackSemantics/节形态守卫/条目参与守卫）
// 的变异验红走手工，见 packages/content/tests/pack-semantics.test.ts 头注
// M1–M5（content 无 vite.config，runner 不支持，票评已申报）。
//
// 源码变了锚点会失配：setup 即逐条报错，重拟本文件再跑（勿为凑绿放宽锚点）。

const pipelinePath = 'packages/editor/src/llm/pipeline.ts';

export default {
  name: 'semantic-gate-94',
  description: '#94 带错包语义半边门禁：对照底/入包后两侧独立语义入口的 2 条独立变异',
  packageDir: 'packages/editor',
  tests: ['tests/llm-pipeline.test.ts'],
  inputs: {
    dirs: ['packages/editor/src'],
    files: ['packages/editor/tests/llm-pipeline.test.ts', 'packages/editor/tests/helpers.ts'],
  },
  mutations: [
    {
      id: '01-baseline-semantic-severed',
      path: pipelinePath,
      before: '    if (!baseline.ok) {\n      for (const error of validatePackSemantics(pack)) {',
      after: '    if (false) {\n      for (const error of validatePackSemantics(pack)) {',
      note: '对照底缺语义半边：存量语义错（悬空 drops）不在基准里，被 after 侧语义对照误判为新增——好候选入包被误回滚，「不误伤」用例红。',
    },
    {
      id: '02-after-semantic-severed',
      path: pipelinePath,
      before: '    if (!after.ok) {\n      for (const error of validatePackSemantics(pack)) {',
      after: '    if (false) {\n      for (const error of validatePackSemantics(pack)) {',
      note: '入包后语义对照摘除：带 schema 错包的悬空 drops 候选入包畅通（#56 挂账缺口复发）——拦断面/消息定位两用例红。',
    },
  ],
};
