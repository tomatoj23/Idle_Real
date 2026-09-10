/**
 * schema 骨架值（#11）：按 FormNode 生成「过 schema 关卡的最小缺省值」——
 * 新增数组条目、oneOf 分支切换时作为起点。
 *
 * 设计取舍：只填 required 字段（可选字段留白由作者按需添加，表单的
 * 「添加字段」入口补）；占位值尽量中性（空串/0），唯一覆盖的语义键是
 * 字典 requiredKeys（verbs 的 basic 恒需键）。
 */

import type { FormNode, ObjectNode, OneOfNode, StringNode } from './model.js';

/** 生成节点对应的骨架值。 */
export function skeletonOf(node: FormNode): unknown {
  switch (node.kind) {
    case 'string':
      return sampleString(node);
    case 'integer':
    case 'number':
      return defaultNumber(node);
    case 'boolean':
      return false;
    case 'select':
      return node.options[0]?.value ?? '';
    case 'object':
      return objectSkeleton(node);
    case 'array': {
      const items: unknown[] = [];
      const min = node.minItems ?? 0;
      for (let i = 0; i < min; i++) {
        items.push(skeletonOf(node.item));
      }
      return items;
    }
    case 'dict': {
      const value: Record<string, unknown> = {};
      for (const key of node.requiredKeys) {
        value[key] = skeletonOf(node.valueNode);
      }
      // minProperties 兜底：无 requiredKeys 时给一个占位键（moves 等）。
      if (Object.keys(value).length === 0 && (node.minProperties ?? 0) > 0) {
        value['key1'] = skeletonOf(node.valueNode);
      }
      return value;
    }
    case 'oneOf':
      return branchSkeleton(node, node.branches[0]?.discriminator ?? '');
  }
}

/**
 * 字符串占位：pattern 字段给满足模式的样例（id/kind 等），minLength 约束
 * 用「待填」补足（并尊重 maxLength 截断）——骨架必须能直接过节 schema。
 */
const PATTERN_SAMPLES: readonly string[] = ['placeholder', 'abc', 'a', 'key1'];

function sampleString(node: StringNode): string {
  if (node.pattern !== undefined) {
    let re: RegExp;
    try {
      re = new RegExp(node.pattern);
    } catch {
      return 'placeholder';
    }
    return PATTERN_SAMPLES.find((sample) => re.test(sample)) ?? 'placeholder';
  }
  const min = node.minLength ?? 0;
  const max = node.maxLength ?? Number.MAX_SAFE_INTEGER;
  let sample = min > 0 ? '待填' : '';
  while (sample.length < min) {
    sample += '填';
  }
  return sample.slice(0, max);
}

/**
 * 数值缺省：min 优先，exclusiveMinimum（0 极常见，如 attackInterval）给出
 * 其上的最小整数，否则 0。
 */
function defaultNumber(node: { min?: number; exclMin?: number }): number {
  if (node.min !== undefined) {
    return node.min;
  }
  if (node.exclMin !== undefined) {
    return Math.floor(node.exclMin) + 1;
  }
  return 0;
}

function objectSkeleton(node: ObjectNode): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const field of node.fields) {
    if (field.required) {
      value[field.field] = skeletonOf(field);
    }
  }
  return value;
}

/**
 * 分支级语义补丁：schema required 之外、语义校验（validateContentPack
 * 语义关卡）强制的字段——equip 的 slot 缺席会立刻报 shape 错，骨架直接
 * 给 config.slots 引用域占位值。
 */
const BRANCH_EXTRA_FIELDS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  equip: { slot: 'placeholder' },
};

/**
 * oneOf 分支骨架：目标分支骨架 + 判别字段写值 + 语义补丁字段。无匹配
 * 分支时回退首分支（校验面板兜底提示）。
 */
export function branchSkeleton(node: OneOfNode, discriminator: string): Record<string, unknown> {
  const branch =
    node.branches.find((candidate) => candidate.discriminator === discriminator) ??
    node.branches[0];
  const value = branch !== undefined ? skeletonOf(branch.node) : {};
  if (typeof value === 'object' && value !== null && discriminator !== '') {
    const record = value as Record<string, unknown>;
    record['type'] = discriminator;
    for (const [key, fieldValue] of Object.entries(BRANCH_EXTRA_FIELDS[discriminator] ?? {})) {
      if (!(key in record)) {
        record[key] = fieldValue;
      }
    }
    return record;
  }
  return { type: discriminator };
}

/**
 * 形态切换时保留旧值中与新分支形相容的字段：skeleton 键递归取旧值
 * （标量 typeof 相同才保留）；`allowed`（新分支也声明的可选字段，如
 * description/prototypeKey 等公共面）直迁旧值；其余丢弃。
 * `lockKeys`（oneOf 判别字段 type）以骨架值为准。
 */
export function preserveFields(
  oldValue: unknown,
  skeleton: unknown,
  options?: { readonly allowed?: readonly string[]; readonly lockKeys?: readonly string[] },
): unknown {
  const lockKeys = new Set(options?.lockKeys ?? []);
  if (Array.isArray(skeleton)) {
    if (!Array.isArray(oldValue)) {
      return skeleton;
    }
    return skeleton.map((item, i) =>
      i < oldValue.length ? preserveFields(oldValue[i], item, options) : item,
    );
  }
  if (typeof skeleton === 'object' && skeleton !== null) {
    if (typeof oldValue !== 'object' || oldValue === null || Array.isArray(oldValue)) {
      return skeleton;
    }
    const allowed = new Set(options?.allowed ?? []);
    const old = oldValue as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    for (const [key, skelValue] of Object.entries(skeleton)) {
      if (!lockKeys.has(key) && key in old) {
        merged[key] = preserveFields(old[key], skelValue, options);
      } else {
        merged[key] = skelValue;
      }
    }
    for (const [key, oldValue_] of Object.entries(old)) {
      if (!(key in merged) && !lockKeys.has(key) && allowed.has(key)) {
        merged[key] = oldValue_;
      }
    }
    return merged;
  }
  return typeof oldValue === typeof skeleton ? oldValue : skeleton;
}

/**
 * oneOf 分支切换入口：目标分支骨架 + 公共字段保留（目标分支声明的全部
 * 字段为可迁面；判别字段锁定为新分支值）。渲染层切形态时调用。
 */
export function switchBranch(
  oldValue: unknown,
  node: OneOfNode,
  discriminator: string,
): Record<string, unknown> {
  const branch =
    node.branches.find((candidate) => candidate.discriminator === discriminator) ??
    node.branches[0];
  const allowed =
    branch !== undefined && branch.node.kind === 'object'
      ? branch.node.fields.map((field) => field.field)
      : [];
  return preserveFields(oldValue, branchSkeleton(node, discriminator), {
    allowed,
    lockKeys: ['type'],
  }) as Record<string, unknown>;
}
