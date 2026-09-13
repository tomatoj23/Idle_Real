import { describe, expect, it } from 'vitest';
import { validateContent, type JsonSchema } from '@wendao/content';
import { skeletonOf } from '../src/core/defaults.js';
import { buildFormNode } from '../src/core/model.js';

/**
 * 骨架合成器跨关键词过验（#53 验收 3，D5）：逐关键词给最小 schema，合成
 * 骨架值必须过同 schema 的 validateContent——钉死 defaults 与 validate 同义。
 * 真实节 schema 的骨架过验已有 form-model.test.ts 覆盖；此处补逐关键词
 * 合成面（新增关键词行时在此加一行用例，红即 defaults 漏消费该关键词）。
 */

/** schema → 控件树 → 骨架值（探针字段名不影响投影）。 */
function skeletonFor(schema: JsonSchema): unknown {
  return skeletonOf(buildFormNode(schema, schema, '', 'probe', true));
}

/** 断言 value 过 schema 校验（不过时把错误清单带进失败信息）。 */
function expectPasses(schema: JsonSchema, value: unknown): void {
  const result = validateContent(value, schema);
  expect(result.ok ? '' : JSON.stringify(result.errors)).toBe('');
}

describe('#53 · 骨架合成器跨关键词过验（defaults ↔ validate 同义）', () => {
  const cases: readonly { readonly name: string; readonly schema: JsonSchema }[] = [
    { name: 'pattern：样例命中模式', schema: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' } },
    { name: 'minLength/maxLength 夹逼', schema: { type: 'string', minLength: 3, maxLength: 6 } },
    { name: 'minLength 长于样例词（待填补足）', schema: { type: 'string', minLength: 12 } },
    { name: 'minimum 地板', schema: { type: 'integer', minimum: 5 } },
    { name: 'exclusiveMinimum 地板（0 之上取 1）', schema: { type: 'integer', exclusiveMinimum: 0 } },
    { name: 'maximum 上界（min 地板已覆盖）', schema: { type: 'integer', minimum: 2, maximum: 9 } },
    // 概率域真形态（boss phase threshold / element primitive value 同款约束）：
    // 合法域是开区间 (0,1)，floor(exclMin)+1=1 顶到排他上界，须收敛区间中点。
    { name: '概率域 (0,1) 排他双界', schema: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 } },
    { name: 'exclusiveMaximum 单独声明（0 落界内）', schema: { type: 'number', exclusiveMaximum: 5 } },
    { name: 'maxItems 上界（空数组即合法）', schema: { type: 'array', maxItems: 2, items: { type: 'string' } } },
    {
      name: 'minItems 补条目且条目自身过验',
      schema: { type: 'array', minItems: 2, items: { type: 'string', pattern: '^[a-z]+$' } },
    },
    {
      name: 'minProperties 占位键且占位值过验',
      schema: { type: 'object', minProperties: 1, additionalProperties: { type: 'integer', minimum: 1 } },
    },
    {
      name: 'required 字段齐备（pattern/id 形态）',
      schema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', pattern: '^[a-z]+$' } },
        additionalProperties: false,
      },
    },
    { name: 'enum 选中', schema: { type: 'string', enum: ['a', 'b'] } },
  ];

  for (const { name, schema } of cases) {
    it(`${name}：骨架值必过 validateContent`, () => {
      expectPasses(schema, skeletonFor(schema));
    });
  }
});
