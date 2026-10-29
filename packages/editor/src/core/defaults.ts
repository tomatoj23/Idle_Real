/**
 * schema 骨架值（#11）：按 FormNode 生成「过 schema 关卡的最小缺省值」——
 * 新增数组条目、oneOf 分支切换时作为起点。
 *
 * 设计取舍：只填 required 字段（可选字段留白由作者按需添加，表单的
 * 「添加字段」入口补）；占位值尽量中性（空串/0），唯一覆盖的语义键是
 * 字典 requiredKeys（verbs 的 basic 恒需键）。
 */

import { skeletonAttr } from '@wendao/content';
import type { FormNode, NumberNode, ObjectNode, OneOfNode, StringNode } from './model.js';

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
      const min = skeletonAttr<number>(node, 'itemCount') ?? 0;
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
      if (Object.keys(value).length === 0 && (skeletonAttr<number>(node, 'keyPlaceholder') ?? 0) > 0) {
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
 * 各关键词的节点属性按矩阵 skeleton 列的策略名读取（#53）。
 */
const PATTERN_SAMPLES: readonly string[] = ['placeholder', 'abc', 'a', 'key1'];

function sampleString(node: StringNode): string {
  const pattern = skeletonAttr<string>(node, 'patternSample');
  if (pattern !== undefined) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      return 'placeholder';
    }
    return PATTERN_SAMPLES.find((sample) => re.test(sample)) ?? 'placeholder';
  }
  const min = skeletonAttr<number>(node, 'minPad') ?? 0;
  const max = skeletonAttr<number>(node, 'maxTruncate') ?? Number.MAX_SAFE_INTEGER;
  let sample = min > 0 ? '待填' : '';
  while (sample.length < min) {
    sample += '填';
  }
  return sample.slice(0, max);
}

/**
 * 数值缺省：min 优先，exclusiveMinimum（0 极常见，如 attackInterval）给出
 * 其上的最小整数，否则 0；排他上界收敛（概率域 exclusiveMinimum:0 +
 * exclusiveMaximum:1 时地板+1=1 顶界，取区间中点）。
 * min + exclusiveMinimum 同节点（现役 schema 无此组合的潜伏缺口，#58 项 4）：
 * 两下界取更严者——min 分支胜出时仍须越过排他下界，否则骨架值出生即违例。
 */
function defaultNumber(node: NumberNode): number {
  const min = skeletonAttr<number>(node, 'numberFloor');
  const exclMin = skeletonAttr<number>(node, 'numberFloorExcl');
  const exclMax = skeletonAttr<number>(node, 'numberFloorCap');
  let value = min ?? (exclMin !== undefined ? Math.floor(exclMin) + 1 : 0);
  if (exclMin !== undefined && value <= exclMin) {
    value = Math.floor(exclMin) + 1;
  }
  if (exclMax !== undefined && value >= exclMax) {
    value = exclMin !== undefined ? (exclMin + exclMax) / 2 : exclMax - 1;
  }
  return value;
}

function objectSkeleton(node: ObjectNode): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const field of node.fields) {
    if (field.required) {
      value[field.field] = skeletonOf(field);
    }
  }
  // 混合形态的开放键值面（bonuses 等）：required 键之外还需满足
  // minProperties 时补一个占位键（策略名经矩阵 dict 行读取，与纯 dict 同律）。
  if (node.dict !== undefined && Object.keys(value).length === 0) {
    const minProps = skeletonAttr<number>(node.dict, 'keyPlaceholder') ?? 0;
    if (minProps > 0) {
      value['key1'] = skeletonOf(node.dict.valueNode);
    }
  }
  return value;
}

/**
 * oneOf 分支骨架：目标分支骨架 + 判别字段写值。分支内 schema required
 * 之外的字段一概不补（#45：equip 语义槽位补丁表随 required 升级退役，
 * 结构必填全由 schema required 驱动 objectSkeleton 产出）。无匹配分支时
 * 回退首分支（校验面板兜底提示）。
 */
export function branchSkeleton(node: OneOfNode, discriminator: string): Record<string, unknown> {
  const branch =
    node.branches.find((candidate) => candidate.discriminator === discriminator) ??
    node.branches[0];
  const value = branch !== undefined ? skeletonOf(branch.node) : {};
  if (typeof value === 'object' && value !== null && discriminator !== '') {
    const record = value as Record<string, unknown>;
    record['type'] = discriminator;
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
