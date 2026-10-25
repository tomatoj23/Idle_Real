/**
 * 包节安全访问器（#74 项 2 单点）：包数据是外部输入（导入/LLM 生成/
 * store.update 旁门写），节形态不保证合法——节级读取一律经此守卫，
 * 坏形态返回 undefined 由调用方降级，禁止裸 `as Record/unknown[]` 断言
 * 直取（旧坑：combatText 缺失时 verbs/moves 直取即 TypeError）。
 */

/**
 * 节数组形态守卫：节值是数组返回原引用（可变——入包/EntryOp 面需要
 * push/splice），缺失/被写坏（对象/标量）返回 undefined。
 */
export function packSectionArray(
  pack: Record<string, unknown>,
  section: string,
): unknown[] | undefined {
  const value = pack[section];
  return Array.isArray(value) ? value : undefined;
}

/**
 * 记录形态守卫（非 null 非数组的 object）：其余（含数组——数组不是键值
 * 记录）返回 undefined。combatText.verbs/moves 这类键域容器用。
 */
export function packRecordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
