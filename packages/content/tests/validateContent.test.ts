import { describe, expect, it } from 'vitest';
import { validateContent } from '../src/index.js';
import type { JsonSchema, ValidationResult } from '../src/index.js';
import skillSchemaJson from '../src/schemas/skill.schema.json';

// skill.schema.json 约束 content 包 skills 节的值本身（技能数组）。
const schema = skillSchemaJson as unknown as JsonSchema;

/** 合法最小样例：一个 gather 技能带一个活动（含副产出）。 */
function makeSkills(): unknown[] {
  return [
    {
      id: 'herb',
      name: '采药',
      icon: '药',
      kind: 'gather',
      description: '寻访灵草异卉，以备丹炉',
      activities: [
        {
          name: '采青灵草',
          unlockLevel: 1,
          interval: 3000,
          exp: 6,
          output: { item: 'herb1', count: 1 },
          byproduct: { item: 'silk', chance: 0.5 },
        },
      ],
    },
  ];
}

/** 断言校验失败且命中指定字段与关键字（字段级错误）。 */
function expectFieldError(result: ValidationResult, path: string, keyword: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  expect(result.errors).toContainEqual({
    path,
    keyword,
    message: expect.any(String),
  });
}

describe('validateContent', () => {
  it('对合法 skills 样例通过', () => {
    expect(validateContent(makeSkills(), schema)).toEqual({ ok: true });
  });

  it('对缺字段样例报字段级错误', () => {
    const skills = makeSkills() as Array<Record<string, unknown>>;
    delete skills[0].name;
    expectFieldError(validateContent(skills, schema), '/0/name', 'required');
  });

  it('对类型错误报出实际类型', () => {
    const skills = makeSkills() as Array<Record<string, unknown>>;
    (skills[0].activities as Array<Record<string, unknown>>)[0].interval = '很快';
    expectFieldError(validateContent(skills, schema), '/0/activities/0/interval', 'type');
  });

  it('对越界数值报出字段错误', () => {
    const skills = makeSkills() as Array<Record<string, unknown>>;
    (skills[0].activities as Array<Record<string, unknown>>)[0].unlockLevel = 0;
    expectFieldError(validateContent(skills, schema), '/0/activities/0/unlockLevel', 'minimum');
  });

  it('对额外字段报 additionalProperties 错误', () => {
    const skills = makeSkills() as Array<Record<string, unknown>>;
    skills[0].cheat = true;
    expectFieldError(validateContent(skills, schema), '/0/cheat', 'additionalProperties');
  });

  it('对非法 id 报 pattern 错误', () => {
    const skills = makeSkills() as Array<Record<string, unknown>>;
    skills[0].id = '采药';
    expectFieldError(validateContent(skills, schema), '/0/id', 'pattern');
  });

  it('对空活动列表报 minItems 错误', () => {
    const skills = makeSkills() as Array<Record<string, unknown>>;
    skills[0].activities = [];
    expectFieldError(validateContent(skills, schema), '/0/activities', 'minItems');
  });

  it('对副产出概率越界报 maximum 错误', () => {
    const skills = makeSkills() as Array<Record<string, unknown>>;
    ((skills[0].activities as Array<Record<string, unknown>>)[0].byproduct as Record<string, unknown>).chance = 1.5;
    expectFieldError(
      validateContent(skills, schema),
      '/0/activities/0/byproduct/chance',
      'maximum',
    );
  });
});

describe('schema 关键字扩展（issue #2）', () => {
  it('minProperties：对象字段数不足报错', () => {
    const result = validateContent({}, { type: 'object', minProperties: 1 });
    expectFieldError(result, '', 'minProperties');
  });

  it('minProperties：满足时不报错', () => {
    expect(validateContent({ a: 1 }, { type: 'object', minProperties: 1 })).toEqual({ ok: true });
  });

  it('patternProperties：匹配键按子 schema 校验并报字段级错误', () => {
    const materialSchema: JsonSchema = {
      type: 'object',
      patternProperties: { '^[a-z][a-z0-9_]*$': { type: 'integer', minimum: 1 } },
    };
    const result = validateContent({ herb1: 0 }, materialSchema);
    expectFieldError(result, '/herb1', 'minimum');
  });

  it('patternProperties：未匹配键不套用该子 schema', () => {
    const materialSchema: JsonSchema = {
      type: 'object',
      patternProperties: { '^[a-z][a-z0-9_]*$': { type: 'integer' } },
    };
    expect(validateContent({ '坏键': '任意' }, materialSchema)).toEqual({ ok: true });
  });

  it('patternProperties 与 additionalProperties:false 组合：未匹配键仍报额外字段', () => {
    const materialSchema: JsonSchema = {
      type: 'object',
      patternProperties: { '^[a-z][a-z0-9_]*$': { type: 'integer' } },
      additionalProperties: false,
    };
    const result = validateContent({ '坏键': 1 }, materialSchema);
    expectFieldError(result, '/坏键', 'additionalProperties');
  });
});
