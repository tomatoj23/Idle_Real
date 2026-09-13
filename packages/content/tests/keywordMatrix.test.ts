import { describe, expect, it } from 'vitest';
import { KEYWORD_MATRIX, discriminatorOf } from '../src/index.js';
import type { JsonSchema } from '../src/index.js';

/**
 * 关键词支持矩阵一致性（#53 验收 3，D5）：矩阵是界约束关键词子集的单点
 * 声明，三解释器（validate/model/defaults）各取一列。本文件钉：
 * - 每行三列齐备（新增关键词缺列 → 编译器红；类型外的接线错误 → 此处红）
 * - formAttr 家族属性名集合（漏登记/拼错 attr 名即红）
 * - enforce.pick / formAttr.read 接线（读错属性即红）
 * - skeleton 策略与家族相配、策略在矩阵内唯一
 * - 关键词行清单本身（增删行是协议面变更，必须过此清单）
 */

/** formAttr 各家族的属性名全集（与 editor FormNode 节点接口一一对应）。 */
const FAMILY_ATTRS: Readonly<Record<string, readonly string[]>> = {
  string: ['pattern', 'minLength', 'maxLength'],
  number: ['min', 'max', 'exclMin', 'exclMax'],
  array: ['minItems', 'maxItems'],
  dict: ['minProperties'],
};

/** skeleton 列的已知策略闭集（keywords.ts SkeletonPolicy 的运行腿清单）。 */
const KNOWN_POLICIES: Readonly<Record<string, string | undefined>> = {
  patternSample: 'string',
  minPad: 'string',
  maxTruncate: 'string',
  numberFloor: 'number',
  numberFloorExcl: 'number',
  numberFloorCap: 'number',
  itemCount: 'array',
  keyPlaceholder: 'dict',
  upperBound: undefined, // 非排他上界：不限家族
};

/** 界约束关键词全集（支持子集声明；增删 = 协议面变更，须三列 + 本清单同改）。 */
const KNOWN_KEYWORDS = [
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'minProperties',
  'pattern',
];

/** 消费型策略须一策略一行（skeletonAttr 按首个命中行取值）；no-op 标记除外。 */
const MULTI_ROW_POLICIES = new Set(['upperBound']);

describe('#53 · 关键词支持矩阵一致性', () => {
  it('关键词行清单与声明一致（新增关键词 = 矩阵加一行 + 本清单同步）', () => {
    expect(Object.keys(KEYWORD_MATRIX).sort()).toEqual([...KNOWN_KEYWORDS].sort());
  });

  it('行序钉死：行序即 validateContent 报错序（头注释约定，重排即红）', () => {
    // 与 KEYWORD_MATRIX 字面量书写序逐位一致；有意调序须同步此处（报错顺序是可观察行为）。
    expect(Object.keys(KEYWORD_MATRIX)).toEqual([
      'minLength',
      'maxLength',
      'pattern',
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'minItems',
      'maxItems',
      'minProperties',
    ]);
  });

  it('每个关键词三列齐备且形制正确（防某列漏登记）', () => {
    for (const [keyword, row] of Object.entries(KEYWORD_MATRIX)) {
      expect(typeof row.enforce.pick, `${keyword} enforce.pick`).toBe('function');
      expect(typeof row.enforce.violated, `${keyword} enforce.violated`).toBe('function');
      expect(typeof row.enforce.message, `${keyword} enforce.message`).toBe('function');
      expect(FAMILY_ATTRS[row.formAttr.family], `${keyword} formAttr.family 未知`).toBeDefined();
      expect(typeof row.formAttr.attr, `${keyword} formAttr.attr`).toBe('string');
      expect(typeof row.formAttr.read, `${keyword} formAttr.read`).toBe('function');
      expect(row.skeleton in KNOWN_POLICIES, `${keyword} skeleton 策略未知`).toBe(true);
    }
  });

  it('formAttr 属性名按家族恰为声明的全集（漏登记/拼错 attr 即红）', () => {
    const actual: Record<string, string[]> = { string: [], number: [], array: [], dict: [] };
    for (const row of Object.values(KEYWORD_MATRIX)) {
      actual[row.formAttr.family]!.push(row.formAttr.attr);
    }
    for (const [family, attrs] of Object.entries(actual)) {
      expect(attrs.sort(), `formAttr.${family} 属性名集`).toEqual([...FAMILY_ATTRS[family]!].sort());
    }
  });

  it('enforce.pick 与 formAttr.read 都读各自关键词的声明值（接线防呆）', () => {
    for (const [keyword, row] of Object.entries(KEYWORD_MATRIX)) {
      const schema = { [keyword]: 3 } as unknown as JsonSchema;
      expect(row.enforce.pick(schema), `${keyword} enforce.pick 接线`).toBe(3);
      expect(row.formAttr.read(schema), `${keyword} formAttr.read 接线`).toBe(3);
    }
  });

  it('skeleton 策略与 formAttr 家族相配（骨架从节点读的就是表单写入的属性）', () => {
    for (const row of Object.values(KEYWORD_MATRIX)) {
      const expectFamily = KNOWN_POLICIES[row.skeleton];
      if (expectFamily !== undefined) {
        expect(row.formAttr.family, `${row.formAttr.attr} 的 skeleton=${row.skeleton}`).toBe(
          expectFamily,
        );
      }
    }
  });

  it('消费型 skeleton 策略在矩阵内唯一（skeletonAttr 按「一策略一行」取值的前提；no-op 标记可多行）', () => {
    const seen = new Set<string>();
    for (const row of Object.values(KEYWORD_MATRIX)) {
      if (MULTI_ROW_POLICIES.has(row.skeleton)) {
        continue;
      }
      expect(seen.has(row.skeleton), `策略 ${row.skeleton} 被多行复用`).toBe(false);
      seen.add(row.skeleton);
    }
  });
});

describe('#53 · discriminatorOf：oneOf 判别式解析单一来源', () => {
  it('分支以 properties.type.enum 钉死形态时返回枚举值组', () => {
    expect(discriminatorOf({ properties: { type: { enum: ['equip'] } } })).toEqual(['equip']);
    expect(discriminatorOf({ properties: { type: { enum: ['a', 'b'] } } })).toEqual(['a', 'b']);
  });

  it('未钉判别式（无 properties.type.enum / 入参 undefined）→ undefined', () => {
    expect(discriminatorOf({ properties: {} })).toBeUndefined();
    expect(discriminatorOf({})).toBeUndefined();
    expect(discriminatorOf(undefined)).toBeUndefined();
  });
});
