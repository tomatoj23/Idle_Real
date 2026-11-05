import { describe, expect, it } from 'vitest';
import { validateContent, validateContentPack } from '../src/index.js';
import type { JsonSchema } from '../src/index.js';
import combatTextSchemaJson from '../src/schema/combat-text.schema.json';
import { expectError, minimalPack } from './fixtures.js';

/**
 * properties 键查找原型链 quirk 根治回归（#90）。
 *
 * checkObject 逐键查 `schema.properties[key]` 曾是普通属性取值：键名来自
 * 不可信内容包，`__proto__`/`constructor` 沿原型链命中 Object.prototype
 * 成员真值（访问器/函数），冒充「有子 schema」绕过 additionalProperties:
 * false——构造的包文件可携原型污染键过校验进运行时（game 壳载包走
 * validateContentPack，无 editor 净化兜底；#89 票评审计 C12 合成极简 +
 * 真实 verbs 候选 schema 双探针 6/6 实锤）。修复 = 查取改 own-properties
 * 语义（Object.hasOwn，engine game.ts/save.ts 同款先例）。
 *
 * - 正对照：三危险键与普通未知键同律按 additionalProperties 拒绝，覆盖
 *   审计探针同款三层（合成 schema / 真实 verbs 候选 schema / 整包路径）。
 *   危险键一律 JSON.parse 构造——字面量 `{ __proto__: … }` 是设原型不是
 *   造键，JSON.parse 走 CreateDataProperty 才得 own 可枚举数据键（审计
 *   探针 6 实证 round-trip 保留）；每处注入先断言 own 键确已在（防空测试，
 *   enemyAuto 先例）。
 * - 反对照：`prototype` 沿链无此键本就拒、键域 pattern 不匹配键本就拒
 *   （audit 探针 4/5）——修复不得改动这些既有拒绝面。
 * 验红钉：改前本文件 quirk 用例全红（ok:true 放行）、反对照恒绿；
 * 修复后全绿。
 *
 * #95 增补（原型链查取家族扫尾，#90 同族两处 own 化的对抗注入回归）：
 * - required 检查 `key in json`（validate.ts checkObject）：Object.prototype
 *   挂 required 键名 → 缺 own 键被 `in` 沿链蒙混（缺字段不报）；
 * - resolveRef 的 `root.definitions?.[name]`：definitions 真实在时查取沿链，
 *   Object.prototype 污染键 / 内建成员（constructor）冒充已注册定义被解析
 *   （伪造 {type:'string'} 形态即可让坏引用蒙混通过）。
 *   两注入均先断言污染键不在场、注入后断言确已在（防空测试），finally
 *   删键还原（防污染同文件后续用例）；注入与还原各断言一次。
 * 验红钉（#95 同律）：注入两测改前红（ok:true 蒙混放行）、反对照恒绿；
 * 修复后全绿。
 */

/** 合成极简 schema（audit 探针同构：闭键域 + 必填，最小复现面）。 */
const TIGHT: JsonSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: { name: { type: 'string' } },
};

const combatTextSchema = combatTextSchemaJson as unknown as JsonSchema;

/**
 * 编辑器 verbs 候选 schema 同构复刻（pipeline.ts candidateSchemaOf('verbs')：
 * {key, list} 容器 + 节根 definitions 的真实 verbList 定义）——内容包不反向
 * 依赖 editor，此处按同构钉回归；两侧形态漂移时本文件即假阴性警报。
 */
function verbsCandidateSchema(): JsonSchema {
  const verbList = combatTextSchema.definitions?.['verbList'];
  // 复刻完整性守卫：定义取不到就大声炸（评审收口），不落 `?? {type:'array'}`
  // 式静默放宽——否则 schema 侧改名后本测试照绿，漂移警报失效。
  if (verbList === undefined) {
    throw new Error(
      'combat-text.schema.json definitions.verbList 不存在：verbs 候选 schema 复刻已漂移（同源 pipeline.ts candidateSchemaOf），本文件须同步',
    );
  }
  return {
    type: 'object',
    required: ['key', 'list'],
    additionalProperties: false,
    properties: {
      key: { type: 'string', pattern: '^[a-z][a-zA-Z0-9_]*$' },
      list: verbList,
    },
    definitions: combatTextSchema.definitions,
  };
}

describe('properties 键查找原型链 quirk（#90）', () => {
  it('合成 schema：__proto__ own 键按额外字段拒绝', () => {
    const value = JSON.parse('{"name":"合法","__proto__":{"polluted":1}}') as Record<string, unknown>;
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expectError(validateContent(value, TIGHT), '/__proto__', 'additionalProperties');
  });

  it('合成 schema：constructor own 键按额外字段拒绝', () => {
    const value = JSON.parse('{"name":"合法","constructor":42}') as Record<string, unknown>;
    expect(Object.hasOwn(value, 'constructor')).toBe(true);
    expectError(validateContent(value, TIGHT), '/constructor', 'additionalProperties');
  });

  it('反对照：prototype 与未知键本就按额外字段拒绝（拒绝面不因修复改变）', () => {
    expectError(
      validateContent(JSON.parse('{"name":"合法","prototype":1}') as Record<string, unknown>, TIGHT),
      '/prototype',
      'additionalProperties',
    );
    expectError(
      validateContent(JSON.parse('{"name":"合法","zzz":1}') as Record<string, unknown>, TIGHT),
      '/zzz',
      'additionalProperties',
    );
  });

  it('真实 verbs 候选 schema：顶层 __proto__ own 键拒绝（audit 探针 1 同款）', () => {
    const value = JSON.parse(
      '{"key":"sword","list":[{"v":"斩","limbs":["颈侧"]}],"__proto__":{"polluted":1}}',
    ) as Record<string, unknown>;
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expectError(validateContent(value, verbsCandidateSchema()), '/__proto__', 'additionalProperties');
  });

  it('真实 verbs 候选 schema：list 条目内 __proto__ own 键拒绝（audit 探针 3 同款，verbs 直赋分支实 hurt 面）', () => {
    const value = JSON.parse(
      '{"key":"claw","list":[{"v":"抓","limbs":["肩头"],"__proto__":{"polluted":1}}]}',
    ) as { key: unknown; list: Array<Record<string, unknown>> };
    expect(Object.hasOwn(value.list[0]!, '__proto__')).toBe(true);
    expectError(
      validateContent(value, verbsCandidateSchema()),
      '/list/0/__proto__',
      'additionalProperties',
    );
  });

  it('整包路径（game 壳载包同款 validateContentPack）：verbs 词条带 __proto__ 拒绝', () => {
    const pack = minimalPack() as Record<string, any>;
    pack.combatText.verbs.basic = JSON.parse(
      '[{"v":"击","limbs":["面门"],"__proto__":{"polluted":1}}]',
    );
    expect(Object.hasOwn(pack.combatText.verbs.basic[0], '__proto__')).toBe(true);
    expectError(
      validateContentPack(pack),
      '/combatText/verbs/basic/0/__proto__',
      'additionalProperties',
    );
  });
});

describe('原型链查取家族 own 化（#95：required in + definitions 查取）', () => {
  const PROTO = Object.prototype as unknown as Record<string, unknown>;

  it('对抗注入：Object.prototype 挂 required 键名 → 缺 own 键仍报 required', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['ghost_required'],
      additionalProperties: false,
      properties: { ghost_required: { type: 'string' } },
    };
    expect(Object.hasOwn(PROTO, 'ghost_required')).toBe(false); // 注入前不在场（防空测试）
    PROTO['ghost_required'] = 1;
    try {
      expect(Object.hasOwn(PROTO, 'ghost_required')).toBe(true); // 注入确已在
      // 修复前：`'ghost_required' in {}` 沿链命中 → 必填检查被蒙混（ok:true）。
      expectError(validateContent({}, schema), '/ghost_required', 'required');
    } finally {
      delete PROTO['ghost_required']; // 还原，防污染同文件后续用例
    }
    expect(Object.hasOwn(PROTO, 'ghost_required')).toBe(false);
  });

  it('对抗注入：Object.prototype 挂 definitions 名（污染键 + 内建 constructor）→ $ref 不沿链解析', () => {
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        weapon: { $ref: '#/definitions/ghost_def' },
        spare: { $ref: '#/definitions/constructor' },
      },
      definitions: { real: { type: 'string' } }, // definitions 真实在，?.[name] 才会走链
    };
    expect(Object.hasOwn(PROTO, 'ghost_def')).toBe(false); // 注入前不在场（防空测试）
    PROTO['ghost_def'] = { type: 'string' }; // 伪造「可解析」定义
    try {
      expect(Object.hasOwn(PROTO, 'ghost_def')).toBe(true);
      const value = JSON.parse('{"weapon":"断水","spare":"备剑"}') as Record<string, unknown>;
      // 修复前：两引用分别沿链命中污染键 / 内建 constructor（函数当 schema）→ 蒙混通过。
      const result = validateContent(value, schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.map((e) => e.keyword)).toEqual(['$ref', '$ref']);
        expect(result.errors.map((e) => e.path)).toEqual(['/weapon', '/spare']);
      }
    } finally {
      delete PROTO['ghost_def'];
    }
    expect(Object.hasOwn(PROTO, 'ghost_def')).toBe(false);
  });

  it('反对照：合法 $ref 照常解析、链外未知名照常拒（拒绝面不因修复改变）', () => {
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        weapon: { $ref: '#/definitions/real' },
        spare: { $ref: '#/definitions/ghost_other' },
      },
      definitions: { real: { type: 'string' } },
    };
    expect(validateContent(JSON.parse('{"weapon":"断水"}'), schema).ok).toBe(true);
    expectError(validateContent(JSON.parse('{"spare":"备剑"}'), schema), '/spare', '$ref');
  });
});
