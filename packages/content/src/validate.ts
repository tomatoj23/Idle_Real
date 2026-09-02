/**
 * JSON Schema 校验器骨架（issue #1）。
 *
 * 支持常用关键字子集：type / required / properties / items /
 * additionalProperties / enum / 数值与字符串边界 / pattern / $ref（仅
 * `#/definitions/...` 内部引用，不做递归展开）。完整 JSON Schema 支持
 * 与内容包整体校验在 issue #2 落地。
 */

/** 本校验器支持的 JSON Schema 关键字子集。 */
export interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly additionalProperties?: boolean | JsonSchema;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly pattern?: string;
  readonly $ref?: string;
  readonly definitions?: Readonly<Record<string, JsonSchema>>;
}

/** 字段级错误：path 为 JSON Pointer 风格（如 `/skills/0/baseInterval`）。 */
export interface ContentError {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly ContentError[] };

/** 校验上下文：错误收集器 + 根 schema（供 $ref 解析）+ 深度计数。 */
interface Ctx {
  readonly root: JsonSchema;
  readonly errors: ContentError[];
  depth: number;
}

/** $ref 解析与子节点下探的最大深度，防御循环引用 schema。 */
const MAX_DEPTH = 64;

/** 校验一段内容是否符合 schema；错误逐字段上报。 */
export function validateContent(json: unknown, schema: JsonSchema): ValidationResult {
  const ctx: Ctx = { root: schema, errors: [], depth: 0 };
  validateNode(json, schema, '', ctx);
  return ctx.errors.length === 0 ? { ok: true } : { ok: false, errors: ctx.errors };
}

function validateNode(json: unknown, schema: JsonSchema, path: string, ctx: Ctx): void {
  if (ctx.depth > MAX_DEPTH) {
    ctx.errors.push({ path, keyword: '$ref', message: 'schema 嵌套过深，疑似循环引用' });
    return;
  }

  const ref = schema.$ref;
  if (ref !== undefined) {
    const target = resolveRef(ref, ctx.root);
    if (!target) {
      ctx.errors.push({ path, keyword: '$ref', message: `无法解析引用 ${ref}` });
      return;
    }
    ctx.depth += 1;
    validateNode(json, target, path, ctx);
    ctx.depth -= 1;
    return;
  }

  if (!checkType(json, schema.type, path, ctx.errors)) {
    // 类型不符时不再深入子字段，避免衍生噪音错误。
    return;
  }

  checkEnum(json, schema.enum, path, ctx.errors);
  checkConstraints(json, schema, path, ctx.errors);

  if (isPlainObject(json)) {
    checkObject(json, schema, path, ctx);
  } else if (Array.isArray(json) && schema.items) {
    json.forEach((item, index) => {
      ctx.depth += 1;
      validateNode(item, schema.items as JsonSchema, `${path}/${index}`, ctx);
      ctx.depth -= 1;
    });
  }
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema | undefined {
  if (!ref.startsWith('#/definitions/')) {
    return undefined;
  }
  return root.definitions?.[ref.slice('#/definitions/'.length)];
}

function checkType(
  json: unknown,
  type: string | readonly string[] | undefined,
  path: string,
  errors: ContentError[],
): boolean {
  if (type === undefined) {
    return true;
  }
  const expected = Array.isArray(type) ? type : [type];
  if (expected.some((t) => matchesType(json, t))) {
    return true;
  }
  errors.push({
    path,
    keyword: 'type',
    message: `类型应为 ${expected.join(' | ')}，实际为 ${describeType(json)}`,
  });
  return false;
}

function matchesType(json: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(json);
    case 'array':
      return Array.isArray(json);
    case 'string':
      return typeof json === 'string';
    case 'integer':
      return typeof json === 'number' && Number.isInteger(json);
    case 'number':
      return typeof json === 'number' && Number.isFinite(json);
    case 'boolean':
      return typeof json === 'boolean';
    case 'null':
      return json === null;
    default:
      return false;
  }
}

function describeType(json: unknown): string {
  if (json === null) {
    return 'null';
  }
  if (Array.isArray(json)) {
    return 'array';
  }
  return typeof json;
}

function checkEnum(
  json: unknown,
  options: readonly unknown[] | undefined,
  path: string,
  errors: ContentError[],
): void {
  if (options !== undefined && !options.some((option) => option === json)) {
    errors.push({
      path,
      keyword: 'enum',
      message: `取值须为 ${options.map((o) => JSON.stringify(o)).join(' | ')} 之一`,
    });
  }
}

/** 单条边界关键字的检查规则：命中类型且有声明时才生效。 */
interface ConstraintRule {
  readonly keyword: string;
  readonly pick: (schema: JsonSchema) => number | string | undefined;
  readonly violated: (value: unknown, bound: number | string) => boolean;
  readonly message: (bound: number | string) => string;
}

const CONSTRAINT_RULES: readonly ConstraintRule[] = [
  {
    keyword: 'minLength',
    pick: (s) => s.minLength,
    violated: (v, b) => (v as string).length < (b as number),
    message: (b) => `长度不得少于 ${b}`,
  },
  {
    keyword: 'maxLength',
    pick: (s) => s.maxLength,
    violated: (v, b) => (v as string).length > (b as number),
    message: (b) => `长度不得超过 ${b}`,
  },
  {
    keyword: 'pattern',
    pick: (s) => s.pattern,
    violated: (v, b) => !new RegExp(b as string).test(v as string),
    message: (b) => `不匹配模式 ${b}`,
  },
  {
    keyword: 'minimum',
    pick: (s) => s.minimum,
    violated: (v, b) => (v as number) < (b as number),
    message: (b) => `不得小于 ${b}`,
  },
  {
    keyword: 'maximum',
    pick: (s) => s.maximum,
    violated: (v, b) => (v as number) > (b as number),
    message: (b) => `不得大于 ${b}`,
  },
  {
    keyword: 'exclusiveMinimum',
    pick: (s) => s.exclusiveMinimum,
    violated: (v, b) => (v as number) <= (b as number),
    message: (b) => `必须大于 ${b}`,
  },
  {
    keyword: 'exclusiveMaximum',
    pick: (s) => s.exclusiveMaximum,
    violated: (v, b) => (v as number) >= (b as number),
    message: (b) => `必须小于 ${b}`,
  },
  {
    keyword: 'minItems',
    pick: (s) => s.minItems,
    violated: (v, b) => (v as unknown[]).length < (b as number),
    message: (b) => `至少需要 ${b} 项`,
  },
  {
    keyword: 'maxItems',
    pick: (s) => s.maxItems,
    violated: (v, b) => (v as unknown[]).length > (b as number),
    message: (b) => `至多允许 ${b} 项`,
  },
];

function checkConstraints(
  json: unknown,
  schema: JsonSchema,
  path: string,
  errors: ContentError[],
): void {
  for (const rule of CONSTRAINT_RULES) {
    const bound = rule.pick(schema);
    if (bound === undefined) {
      continue;
    }
    if (rule.violated(json, bound)) {
      errors.push({ path, keyword: rule.keyword, message: rule.message(bound) });
    }
  }
}

function checkObject(json: Record<string, unknown>, schema: JsonSchema, path: string, ctx: Ctx): void {
  for (const key of schema.required ?? []) {
    if (!(key in json)) {
      ctx.errors.push({
        path: `${path}/${key}`,
        keyword: 'required',
        message: '缺少必填字段',
      });
    }
  }

  for (const [key, value] of Object.entries(json)) {
    const childPath = `${path}/${key}`;
    const childSchema = schema.properties?.[key];
    if (childSchema) {
      ctx.depth += 1;
      validateNode(value, childSchema, childPath, ctx);
      ctx.depth -= 1;
    } else if (schema.additionalProperties === false) {
      ctx.errors.push({
        path: childPath,
        keyword: 'additionalProperties',
        message: '不应存在此额外字段',
      });
    } else if (typeof schema.additionalProperties === 'object') {
      ctx.depth += 1;
      validateNode(value, schema.additionalProperties, childPath, ctx);
      ctx.depth -= 1;
    }
  }
}

function isPlainObject(json: unknown): json is Record<string, unknown> {
  return typeof json === 'object' && json !== null && !Array.isArray(json);
}
