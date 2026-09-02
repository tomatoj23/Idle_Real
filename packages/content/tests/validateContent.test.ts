import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateContent } from '../src/index.js';
import type { ValidationResult } from '../src/index.js';

const schema = JSON.parse(
  readFileSync(new URL('../schemas/skill.schema.json', import.meta.url), 'utf8'),
);
const sample = JSON.parse(
  readFileSync(new URL('../samples/skills.json', import.meta.url), 'utf8'),
) as { skills: Array<Record<string, unknown>> };

/** 复制样例并改动第 index 个技能，返回待校验内容。 */
function breakSkill(index: number, mutate: (skill: Record<string, unknown>) => void): unknown {
  const broken = JSON.parse(JSON.stringify(sample)) as typeof sample;
  mutate(broken.skills[index] as Record<string, unknown>);
  return broken;
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
    expect(validateContent(sample, schema)).toEqual({ ok: true });
  });

  it('对缺字段样例报字段级错误', () => {
    const broken = breakSkill(0, (skill) => {
      delete skill.name;
    });
    expectFieldError(validateContent(broken, schema), '/skills/0/name', 'required');
  });

  it('对类型错误报出实际类型', () => {
    const broken = breakSkill(1, (skill) => {
      skill.baseInterval = '很快';
    });
    expectFieldError(validateContent(broken, schema), '/skills/1/baseInterval', 'type');
  });

  it('对越界数值报出字段错误', () => {
    const broken = breakSkill(0, (skill) => {
      skill.baseInterval = -1;
    });
    expectFieldError(
      validateContent(broken, schema),
      '/skills/0/baseInterval',
      'exclusiveMinimum',
    );
  });

  it('对额外字段报 additionalProperties 错误', () => {
    const broken = breakSkill(0, (skill) => {
      skill.cheat = true;
    });
    expectFieldError(validateContent(broken, schema), '/skills/0/cheat', 'additionalProperties');
  });

  it('对非法 id 报 pattern 错误', () => {
    const broken = breakSkill(0, (skill) => {
      skill.id = '炼气';
    });
    expectFieldError(validateContent(broken, schema), '/skills/0/id', 'pattern');
  });
});
