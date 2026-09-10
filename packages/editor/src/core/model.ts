/**
 * schema → 表单控件树（#11）。纯函数投影：JsonSchema（content 校验器
 * 支持的关键字子集）→ FormNode 树，渲染层按树生成 DOM。
 *
 * 覆盖形态：标量（string/integer/number/boolean）、enum→select、
 * $ref（#/definitions 内部引用）、object（properties + required +
 * additionalProperties:false）、开放键值容器（patternProperties /
 * additionalProperties:schema → DictNode）、array、oneOf 分支联合
 * （item 五形态，判别式 properties.type.enum）。
 *
 * FormNode 与具体包数据无关——同一节所有条目共享一棵树；值过滤
 * （可选字段是否渲染）是渲染层的事。
 */

import type { JsonSchema } from '@wendao/content';
import { BRANCH_LABELS, fieldLabel } from './labels.js';
import { xrefForField, type XrefTarget } from './xref.js';

/** 所有节点的公共面：路径、展示名、输入提示、必填标志、跨引用标注。 */
interface CommonNode {
  /** 节值相对的 JSON Pointer 片段（根为 ''）。 */
  readonly path: string;
  /** 末段字段名（label/xref 判定用；根/数组条目为容器字段名）。 */
  readonly field: string;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
  readonly xref?: XrefTarget;
}

export interface StringNode extends CommonNode {
  readonly kind: 'string';
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface NumberNode extends CommonNode {
  readonly kind: 'integer' | 'number';
  readonly min?: number;
  readonly max?: number;
  readonly exclMin?: number;
  readonly exclMax?: number;
}

export interface BooleanNode extends CommonNode {
  readonly kind: 'boolean';
}

export interface SelectNode extends CommonNode {
  readonly kind: 'select';
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

/** 封闭对象：字段集固定（additionalProperties:false），可选字段由渲染层按值过滤。 */
export interface ObjectNode extends CommonNode {
  readonly kind: 'object';
  readonly fields: readonly FormNode[];
  /** 附加开放键值容器（如 bonuses: 显式 crit + patternProperties 开放键）。 */
  readonly dict?: DictShape;
}

export interface ArrayNode extends CommonNode {
  readonly kind: 'array';
  readonly item: FormNode;
  readonly minItems?: number;
  readonly maxItems?: number;
}

/** 开放键值容器（纯 patternProperties / additionalProperties:schema）。 */
export interface DictNode extends CommonNode {
  readonly kind: 'dict';
  readonly keyPattern?: string;
  /** 字典键的引用域标注（materials 键=物品 id 等）。 */
  readonly keyXref?: XrefTarget;
  readonly valueNode: FormNode;
  readonly minProperties?: number;
  /** schema required 透传（如 verbs 的 basic 恒需）。 */
  readonly requiredKeys: readonly string[];
}

export interface DictShape {
  readonly keyPattern?: string;
  readonly keyXref?: XrefTarget;
  readonly valueNode: FormNode;
}

export interface OneOfBranch {
  /** 判别值（分支 properties.type.enum 的单值；无判别式分支用索引字符串）。 */
  readonly discriminator: string;
  readonly label: string;
  readonly node: FormNode;
}

export interface OneOfNode extends CommonNode {
  readonly kind: 'oneOf';
  readonly branches: readonly OneOfBranch[];
}

export type FormNode =
  | StringNode
  | NumberNode
  | BooleanNode
  | SelectNode
  | ObjectNode
  | ArrayNode
  | DictNode
  | OneOfNode;

/** $ref 仅支持 #/definitions 内部引用（与 content 校验器同律）。 */
function resolveRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const ref = schema.$ref;
  if (ref === undefined) {
    return schema;
  }
  if (!ref.startsWith('#/definitions/')) {
    return schema;
  }
  return root.definitions?.[ref.slice('#/definitions/'.length)] ?? schema;
}

/**
 * 构建（子）控件树。`field` 是该节点在父对象中的字段名（数组条目传
 * 数组字段名，供 xref 判定：pool 条目仍是物品引用）。
 */
export function buildFormNode(
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  field: string,
  required: boolean,
): FormNode {
  const resolved = resolveRef(schema, root);
  const common = {
    path,
    field,
    label: fieldLabel(field),
    description: resolved.description ?? schema.description,
    required,
    xref: xrefForField(field),
  };

  if (resolved.oneOf !== undefined) {
    return buildOneOf(resolved, root, common);
  }
  if (resolved.enum !== undefined) {
    return {
      ...common,
      kind: 'select',
      options: resolved.enum.map((value) => ({
        value: String(value),
        label: String(value),
      })),
    };
  }

  switch (resolved.type) {
    case 'object':
      return buildObject(resolved, root, path, common);
    case 'array':
      return buildArray(resolved, root, path, common);
    case 'integer':
    case 'number':
      return {
        ...common,
        kind: resolved.type,
        min: resolved.minimum,
        max: resolved.maximum,
        exclMin: resolved.exclusiveMinimum,
        exclMax: resolved.exclusiveMaximum,
      };
    case 'boolean':
      return { ...common, kind: 'boolean' };
    case 'string':
    default:
      // 无 type 的残缺节点按自由文本兜底（校验面板兜底合法性）。
      return {
        ...common,
        kind: 'string',
        pattern: resolved.pattern,
        minLength: resolved.minLength,
        maxLength: resolved.maxLength,
      };
  }
}

function buildOneOf(
  schema: JsonSchema,
  root: JsonSchema,
  common: Omit<CommonNode, 'xref'> & { xref?: XrefTarget },
): OneOfNode {
  const branches = (schema.oneOf ?? []).map((branch, index) => {
    const resolved = resolveRef(branch, root);
    const enumValues = resolved.properties?.type?.enum;
    const discriminator =
      enumValues !== undefined && enumValues.length === 1 ? String(enumValues[0]) : String(index);
    return {
      discriminator,
      label: BRANCH_LABELS[discriminator] ?? `分支 ${index + 1}`,
      node: buildFormNode(resolved, root, common.path, common.field, common.required),
    };
  });
  return { ...common, kind: 'oneOf', branches };
}

function buildObject(
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  common: Omit<CommonNode, 'xref'> & { xref?: XrefTarget },
): ObjectNode | DictNode {
  const requiredSet = new Set(schema.required ?? []);
  const properties = schema.properties ?? {};

  // 开放键值容器判定：无显式字段且声明了 patternProperties / 对象型
  // additionalProperties → DictNode（moves/verbs/affinities/reasonMap 等）。
  const patternEntries = Object.entries(schema.patternProperties ?? {});
  const addProps = schema.additionalProperties;
  if (Object.keys(properties).length === 0) {
    if (patternEntries.length > 0) {
      const [, valueSchema] = patternEntries[0]!;
      return {
        ...common,
        kind: 'dict',
        keyPattern: patternEntries[0]![0],
        keyXref: xrefForField(common.field),
        valueNode: buildFormNode(valueSchema, root, `${path}/*`, `${common.field}.*`, false),
        minProperties: schema.minProperties,
        requiredKeys: schema.required ?? [],
      };
    }
    if (typeof addProps === 'object' && addProps !== null) {
      return {
        ...common,
        kind: 'dict',
        keyXref: xrefForField(common.field),
        valueNode: buildFormNode(addProps, root, `${path}/*`, `${common.field}.*`, false),
        minProperties: schema.minProperties,
        requiredKeys: schema.required ?? [],
      };
    }
  }

  const fields = Object.entries(properties).map(([key, childSchema]) =>
    buildFormNode(childSchema, root, `${path}/${key}`, key, requiredSet.has(key)),
  );

  // 混合形态（如 bonuses：显式 crit 字段 + patternProperties 开放键）。
  let dict: DictShape | undefined;
  if (patternEntries.length > 0) {
    const [pattern, valueSchema] = patternEntries[0]!;
    dict = {
      keyPattern: pattern,
      keyXref: xrefForField(common.field),
      valueNode: buildFormNode(valueSchema, root, `${path}/*`, `${common.field}.*`, false),
    };
  } else if (typeof addProps === 'object' && addProps !== null) {
    dict = {
      keyXref: xrefForField(common.field),
      valueNode: buildFormNode(addProps, root, `${path}/*`, `${common.field}.*`, false),
    };
  }

  return { ...common, kind: 'object', fields, dict };
}

function buildArray(
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  common: Omit<CommonNode, 'xref'> & { xref?: XrefTarget },
): ArrayNode {
  const itemSchema = schema.items ?? {};
  return {
    ...common,
    kind: 'array',
    item: buildFormNode(itemSchema, root, `${path}/*`, common.field, false),
    minItems: schema.minItems,
    maxItems: schema.maxItems,
  };
}

/**
 * 节 schema → 条目级 schema（LLM 候选逐条校验用）：取 array 节的 items
 * 子 schema，并把节根 definitions 并入作 $ref 解析根（内部引用相对节根）。
 * 非数组节原样返回。
 */
export function entrySchemaOf(sectionSchema: JsonSchema): JsonSchema {
  const items = sectionSchema.items;
  if (items === undefined) {
    return sectionSchema;
  }
  return { ...items, definitions: sectionSchema.definitions };
}
