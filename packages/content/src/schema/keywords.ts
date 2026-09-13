/**
 * schema 关键词支持矩阵（#53，架构评审二轮卡 8）：界约束关键词子集的
 * 单点声明。三个解释器各取一列，新增关键词 = 加一行（缺列由 KeywordRow
 * 类型强制，编译器接管「三处同步」）：
 *
 * - enforce  列 → content/validate.ts（校验：取界 / 判违 / 报错文案）
 * - formAttr 列 → editor/core/model.ts（schema 声明值 → FormNode 控件属性）
 * - skeleton 列 → editor/core/defaults.ts（骨架合成器的消费策略）
 *
 * 结构性关键词（type/properties/required/items/enum/oneOf/$ref/…）不在
 * 矩阵：它们的解释是各解释器的形状遍历逻辑，不是同一张界约束表的三份
 * 手抄；types↔schema 形状同形由 #43 协议守卫钉死。oneOf 判别式的解析
 * （validate 与 editor 两处独立读 properties.type.enum）归本模块统一
 * （discriminatorOf）。DOM 展示层（render.ts 读 min/max/requiredKeys 决定
 * 「展示哪些约束」）不进矩阵——那是 UI 专属列，#49 地盘。
 */

import type { JsonSchema } from './validate.js';

/** enforce 列：命中类型且有声明时的校验规则（validate.ts 消费）。 */
export interface EnforceRule {
  readonly pick: (schema: JsonSchema) => number | string | undefined;
  readonly violated: (value: unknown, bound: number | string) => boolean;
  readonly message: (bound: number | string) => string;
}

/** formAttr 列的控件节点家族（FormNode 侧按家族承接界约束属性）。 */
export type AttrFamily = 'string' | 'number' | 'array' | 'dict';

/**
 * FormNode 各家族的界约束属性——控件属性名的单一来源。editor 的
 * StringNode/NumberNode/ArrayNode/DictNode extends 这四张（#53 D2）。
 */
export interface StringFormAttrs {
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}
export interface NumberFormAttrs {
  readonly min?: number;
  readonly max?: number;
  readonly exclMin?: number;
  readonly exclMax?: number;
}
export interface ArrayFormAttrs {
  readonly minItems?: number;
  readonly maxItems?: number;
}
export interface DictFormAttrs {
  readonly minProperties?: number;
}
export type FormAttrsOf<F extends AttrFamily> =
  F extends 'string' ? StringFormAttrs
  : F extends 'number' ? NumberFormAttrs
  : F extends 'array' ? ArrayFormAttrs
  : DictFormAttrs;

/**
 * skeleton 列：骨架合成器对该关键词的消费策略（defaults.ts 按策略经
 * skeletonAttr 读节点属性）。新策略 = 扩此闭集 + 在 defaults.ts 落消费逻辑。
 */
export type SkeletonPolicy =
  | 'patternSample' // 重跑 pattern 选过验样例
  | 'minPad' // 「待填」补足到 minLength
  | 'maxTruncate' // 按 maxLength 截断
  | 'numberFloor' // minimum 直接当地板
  | 'numberFloorExcl' // exclusiveMinimum 之上取最小整数
  | 'numberFloorCap' // exclusiveMaximum 收敛（概率域 (0,1) 等，地板+1 顶界时取区间中点）
  | 'itemCount' // minItems 补条目
  | 'keyPlaceholder' // minProperties 占位键兜底
  | 'upperBound'; // 非排他上界：下限优先合成天然满足，骨架不单独消费

/** 矩阵行：一个界约束关键词的三列语义。键名即关键词名（报错 keyword 用）。 */
export interface KeywordRow {
  readonly enforce: EnforceRule;
  readonly formAttr: {
    readonly family: AttrFamily;
    /** FormNode 属性名（如 minimum→min）。 */
    readonly attr: string;
    /** 从 schema 读该关键词的声明值（未声明 → undefined）。 */
    readonly read: (schema: JsonSchema) => number | string | undefined;
  };
  readonly skeleton: SkeletonPolicy;
}

/**
 * 关键词支持矩阵（行序 = 校验报错序，勿无谓重排——错误清单顺序随行序）。
 * enforce 列自 validate.ts CONSTRAINT_RULES 原文迁入，行为不变。
 */
export const KEYWORD_MATRIX: Readonly<Record<string, KeywordRow>> = {
  minLength: {
    enforce: {
      pick: (s) => s.minLength,
      violated: (v, b) => (v as string).length < (b as number),
      message: (b) => `长度不得少于 ${b}`,
    },
    formAttr: { family: 'string', attr: 'minLength', read: (s) => s.minLength },
    skeleton: 'minPad',
  },
  maxLength: {
    enforce: {
      pick: (s) => s.maxLength,
      violated: (v, b) => (v as string).length > (b as number),
      message: (b) => `长度不得超过 ${b}`,
    },
    formAttr: { family: 'string', attr: 'maxLength', read: (s) => s.maxLength },
    skeleton: 'maxTruncate',
  },
  pattern: {
    enforce: {
      pick: (s) => s.pattern,
      violated: (v, b) => !new RegExp(b as string).test(v as string),
      message: (b) => `不匹配模式 ${b}`,
    },
    formAttr: { family: 'string', attr: 'pattern', read: (s) => s.pattern },
    skeleton: 'patternSample',
  },
  minimum: {
    enforce: {
      pick: (s) => s.minimum,
      violated: (v, b) => (v as number) < (b as number),
      message: (b) => `不得小于 ${b}`,
    },
    formAttr: { family: 'number', attr: 'min', read: (s) => s.minimum },
    skeleton: 'numberFloor',
  },
  maximum: {
    enforce: {
      pick: (s) => s.maximum,
      violated: (v, b) => (v as number) > (b as number),
      message: (b) => `不得大于 ${b}`,
    },
    formAttr: { family: 'number', attr: 'max', read: (s) => s.maximum },
    skeleton: 'upperBound',
  },
  exclusiveMinimum: {
    enforce: {
      pick: (s) => s.exclusiveMinimum,
      violated: (v, b) => (v as number) <= (b as number),
      message: (b) => `必须大于 ${b}`,
    },
    formAttr: { family: 'number', attr: 'exclMin', read: (s) => s.exclusiveMinimum },
    skeleton: 'numberFloorExcl',
  },
  exclusiveMaximum: {
    enforce: {
      pick: (s) => s.exclusiveMaximum,
      violated: (v, b) => (v as number) >= (b as number),
      message: (b) => `必须小于 ${b}`,
    },
    formAttr: { family: 'number', attr: 'exclMax', read: (s) => s.exclusiveMaximum },
    skeleton: 'numberFloorCap',
  },
  minItems: {
    enforce: {
      pick: (s) => s.minItems,
      violated: (v, b) => (v as unknown[]).length < (b as number),
      message: (b) => `至少需要 ${b} 项`,
    },
    formAttr: { family: 'array', attr: 'minItems', read: (s) => s.minItems },
    skeleton: 'itemCount',
  },
  maxItems: {
    enforce: {
      pick: (s) => s.maxItems,
      violated: (v, b) => (v as unknown[]).length > (b as number),
      message: (b) => `至多允许 ${b} 项`,
    },
    formAttr: { family: 'array', attr: 'maxItems', read: (s) => s.maxItems },
    skeleton: 'upperBound',
  },
  minProperties: {
    enforce: {
      pick: (s) => s.minProperties,
      violated: (v, b) => isPlainObject(v) && Object.keys(v).length < (b as number),
      message: (b) => `至少需要 ${b} 个字段`,
    },
    formAttr: { family: 'dict', attr: 'minProperties', read: (s) => s.minProperties },
    skeleton: 'keyPlaceholder',
  },
};

function isPlainObject(json: unknown): json is Record<string, unknown> {
  return typeof json === 'object' && json !== null && !Array.isArray(json);
}

/**
 * formAttr 列消费入口：收集某家族在 schema 上声明的全部界约束属性，
 * 属性名即矩阵声明的 FormNode 属性名（model.ts 构节点用，#53 D2）。
 */
export function formAttrsOf(schema: JsonSchema, family: 'string'): StringFormAttrs;
export function formAttrsOf(schema: JsonSchema, family: 'number'): NumberFormAttrs;
export function formAttrsOf(schema: JsonSchema, family: 'array'): ArrayFormAttrs;
export function formAttrsOf(schema: JsonSchema, family: 'dict'): DictFormAttrs;
export function formAttrsOf(schema: JsonSchema, family: AttrFamily): Partial<FormAttrsOf<AttrFamily>> {
  const attrs: Record<string, unknown> = {};
  for (const row of Object.values(KEYWORD_MATRIX)) {
    if (row.formAttr.family !== family) {
      continue;
    }
    const value = row.formAttr.read(schema);
    if (value !== undefined) {
      attrs[row.formAttr.attr] = value;
    }
  }
  return attrs as Partial<FormAttrsOf<AttrFamily>>;
}

/**
 * skeleton 列消费入口：按骨架策略读 FormNode 上的对应属性（defaults.ts
 * 用）。消费型策略在矩阵中恰对应一行（一致性测试钉死），故返回该行属性
 * 在节点上的值；未声明（属性不存在）→ undefined。'upperBound' 是显式
 * no-op 标记（可多行），不经本函数查询。
 */
export function skeletonAttr<T = number>(node: object, policy: SkeletonPolicy): T | undefined {
  for (const row of Object.values(KEYWORD_MATRIX)) {
    if (row.skeleton !== policy) {
      continue;
    }
    const value = (node as Record<string, unknown>)[row.formAttr.attr];
    if (value !== undefined) {
      return value as T;
    }
  }
  return undefined;
}

/**
 * oneOf 判别式解析的单一来源（#53 D3）：validate.checkOneOf 的
 * branchDiscriminates 与 editor buildOneOf 共调，`properties.type.enum`
 * 的读取全仓仅此一处。分支 schema 由调用方先解析 $ref（各自保留既有的
 * resolveRef 回退语义：解析失败 → undefined → 无判别式）。
 */
export function discriminatorOf(
  branch: JsonSchema | undefined,
): readonly unknown[] | undefined {
  return branch?.properties?.type?.enum;
}
