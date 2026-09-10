/**
 * 跨引用提示（#11 表单「跨引用下拉选择」）：按字段名约定把标量字段/
 * 字典键标注为包内其它节的 id 域，渲染层据此生成 datalist 下拉。
 *
 * schema 表达不了「此字段引用某节 id」，本表是编辑器侧的显示意图登记；
 * 真正的引用合法性仍由 content 包语义校验收口（校验面板兜底），此处
 * 只影响输入辅助，误登记不会破坏数据。
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

/** 字段名（或字典键容器字段名）→ 引用域。 */
const FIELD_XREF: Readonly<Record<string, XrefTarget>> = {
  item: 'items',
  shardItem: 'items',
  pool: 'items', // gearDrops 异宝池（string[] 条目）
  key: 'items', // dungeon.entry.key 钥匙物品
  skill: 'skills',
  skills: 'skills', // rebirth.unlocks[].skills 条目
  enemy: 'enemies',
  enemies: 'enemies', // rebirth.unlocks[].enemies 条目
  element: 'elements',
  affinities: 'elements', // 字典键 = 系别键
  materials: 'items', // 字典键 = 物品 id
  verbStyle: 'verbsKeys',
  moveKey: 'movesKeys',
  slot: 'slotIds',
};

/** 按字段名取引用域标注；未登记字段返回 undefined。 */
export function xrefForField(field: string): XrefTarget | undefined {
  return FIELD_XREF[field];
}

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
