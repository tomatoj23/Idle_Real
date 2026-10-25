/**
 * 跨引用提示（#11 表单「跨引用下拉选择」）：引用域候选池构建器。
 *
 * 字段与引用域的对应关系已迁入 schema 自定义关键字 `x-xref`（#45），
 * 由 core/model.ts 投影进 FormNode.xref/keyXref；本模块只剩引用域 →
 * 当前包候选 id 池的求值（datalist 下拉数据源）。
 *
 * x-xref 是显示意图登记：真正的引用合法性仍由 content 包语义校验收口
 * （校验面板兜底），datalist 是输入辅助不是硬约束——引用目标可能尚未
 * 建条目（先建敌人后建掉落物品），自由输入是有意裁断。
 */

/** 跨引用目标域：包节 id 池或派生键域。 */
export type XrefTarget =
  | 'items'
  | 'skills'
  | 'enemies'
  | 'elements'
  | 'verbsKeys'
  | 'movesKeys'
  | 'slotIds';

/** 引用域 → 当前包内的候选 id 池（datalist 下拉数据源）。 */
export function xrefOptions(pack: Record<string, unknown>, target: XrefTarget): readonly string[] {
  const sectionOf = (name: string): readonly { id?: unknown }[] =>
    Array.isArray(pack[name]) ? (pack[name] as { id?: unknown }[]) : [];
  const ids = (name: string): readonly string[] =>
    sectionOf(name)
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id !== '');
  const combatText = pack['combatText'] as { verbs?: unknown; moves?: unknown } | undefined;
  const config = pack['config'] as { slots?: { id?: unknown }[] } | undefined;
  switch (target) {
    case 'items':
      return ids('items');
    case 'skills':
      return ids('skills');
    case 'enemies':
      return ids('enemies');
    case 'elements':
      return ids('elements');
    case 'verbsKeys':
      return combatText !== null && typeof combatText?.verbs === 'object' && combatText.verbs !== null
        ? Object.keys(combatText.verbs)
        : [];
    case 'movesKeys':
      return combatText !== null && typeof combatText?.moves === 'object' && combatText.moves !== null
        ? Object.keys(combatText.moves)
        : [];
    case 'slotIds':
      return (config?.slots ?? [])
        .map((slot) => slot.id)
        .filter((id): id is string => typeof id === 'string' && id !== '');
  }
}
