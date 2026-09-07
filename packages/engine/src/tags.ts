/**
 * tag 倒排索引（issue #14，ADR-015 tags/flags 分工：tags = 归类"能不能
 * 批量捞"，flags = 裸布尔"有没有"，后者无消费场景不设字段）。
 *
 * 引擎零内容感知：索引是泛型机制，对条目形状只要求 `{ id, tags? }`——
 * 铭纹池（标签加权抽取）等任意带 tags 的内容集合都能用同一把索引做
 * 批量查询（O(tags × 命中数)，免逐条扫描全集）。
 */

/** 可索引条目的最小形状：稳定 id + 可选标签集（ADR-015）。 */
export interface TaggedEntry {
  readonly id: string;
  readonly tags?: readonly string[];
}

/**
 * 构建 tag → 条目列表 的倒排索引（同 id 去重，保留首个——与包校验的
 * id 去重同策略，坏包防御不崩）。无 tags / 空数组的条目不入索引。
 */
export function buildTagIndex<T extends TaggedEntry>(
  entries: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const index = new Map<string, T[]>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    for (const tag of entry.tags ?? []) {
      const bucket = index.get(tag);
      if (bucket) bucket.push(entry);
      else index.set(tag, [entry]);
    }
  }
  return index;
}

/** 按标签批量捞取（跨集合查询的读面）；未登记标签返回空表。 */
export function queryByTag<T extends TaggedEntry>(
  index: ReadonlyMap<string, readonly T[]>,
  tag: string,
): readonly T[] {
  return index.get(tag) ?? [];
}
