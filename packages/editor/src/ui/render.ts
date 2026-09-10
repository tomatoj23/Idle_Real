/**
 * 控件树 → DOM（#11 表单渲染）。
 *
 * 写回策略：标量输入经闭包持有的真实父引用直改（不重渲染，焦点保持）；
 * 结构性操作（数组增删/排序、oneOf 分支切换、字段添加/移除、字典行增删）
 * 先改数据再整节重渲染。校验由面板层订阅 data 事件 debounce 重跑。
 *
 * data-path 标注与 validateContentPack 错误 path 同构（`/节/…/字段`），
 * 错误点击定位靠它。
 */

import { sectionSchemas, type JsonSchema } from '@wendao/content';
import { skeletonOf, switchBranch } from '../core/defaults.js';
import { SECTION_LABELS } from '../core/labels.js';
import { buildFormNode, type ArrayNode, type DictNode, type FormNode, type ObjectNode, type OneOfNode } from '../core/model.js';
import type { EditorStore } from '../core/state.js';
import { xrefOptions, type XrefTarget } from '../core/xref.js';

/** 数据写回通道：一切变更过 store.update（标脏 + data 事件）。 */
type Commit = (fn: () => void) => void;

export interface SectionRenderOpts {
  /** 结构性变更后回调（默认整节重渲染由内部完成；外层接校验刷新）。 */
  readonly onStructure?: () => void;
  /** 标量数据变更后回调（外层 debounce 校验）。 */
  readonly onData?: () => void;
  /** 已展开的数组条目下标（跨重渲染保持）。 */
  readonly expanded: Set<number>;
}

let datalistSeq = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** option 元素（vm 池无全局 Option 构造器，统一走 createElement）。 */
export function optionEl(value: string, text: string, selected = false): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  option.selected = selected;
  return option;
}

/**
 * 给输入框挂跨引用 datalist（focus 时从当前包快照重建候选池）。
 * datalist 是输入辅助不是硬约束——引用目标可能尚未建条目（先建敌人后建
 * 掉落物品），自由输入 + 校验面板兜底是有意裁断。
 */
function attachXrefDatalist(input: HTMLInputElement, xref: XrefTarget): void {
  input.classList.add('xref-input');
  const listId = `dl-${(datalistSeq += 1)}`;
  input.setAttribute('list', listId);
  const datalist = document.createElement('datalist');
  datalist.id = listId;
  input.append(datalist);
  input.addEventListener('focus', () => {
    datalist.replaceChildren();
    for (const option of currentXrefPool(xref)) {
      datalist.append(optionEl(option, option));
    }
  });
}

/** 条目列表摘要（id + name）。 */
function entrySummary(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null) {
    return String(entry);
  }
  const record = entry as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : '?';
  const name = typeof record['name'] === 'string' ? ` · ${record['name']}` : '';
  return `${id}${name}`;
}

/** 渲染当前节到容器（结构性操作内部自渲染）。 */
export function renderSection(
  container: HTMLElement,
  store: EditorStore,
  section: string,
  opts: SectionRenderOpts,
): void {
  xrefPack = store.state.pack;
  container.replaceChildren();
  if (!store.hasPack()) {
    container.append(el('p', 'empty-hint', '尚未加载内容包——先从顶栏导入 .json / .zip，或载入示例包。'));
    return;
  }
  const schema = (sectionSchemas as Record<string, JsonSchema | undefined>)[section];
  if (schema === undefined) {
    container.append(el('p', 'empty-hint', `未知内容节：${section}`));
    return;
  }
  const value = store.state.pack[section];
  const title = el('h2', 'section-title', `${SECTION_LABELS[section] ?? section}`);
  title.dataset.path = `/${section}`;
  container.append(title);

  const rerender = (): void => {
    renderSection(container, store, section, opts);
    opts.onStructure?.();
  };
  const touch = (fn: () => void): void => {
    store.update(fn);
    opts.onData?.();
  };

  if (Array.isArray(value)) {
    renderArraySection(container, store, section, schema, value, rerender, touch, opts);
  } else if (typeof value === 'object' && value !== null) {
    const node = buildFormNode(schema, schema, '', section, true);
    if (node.kind === 'object') {
      const body = el('div', 'object-body');
      renderObjectFields(body, node, value as Record<string, unknown>, `/${section}`, touch, rerender);
      container.append(body);
    }
  } else {
    container.append(el('p', 'empty-hint', `内容节 ${section} 缺失（坏包？重导入）。`));
  }
}

/* ==================== 数组节（手风琴条目列表） ==================== */

function renderArraySection(
  container: HTMLElement,
  store: EditorStore,
  section: string,
  schema: JsonSchema,
  value: unknown[],
  rerender: () => void,
  touch: Commit,
  opts: SectionRenderOpts,
): void {
  const node = buildFormNode(schema, schema, '', section, true);
  if (node.kind !== 'array') {
    return;
  }
  const list = el('div', 'entry-list');
  value.forEach((entry, index) => {
    list.append(entryCard(node, section, value, index, store, rerender, touch, opts));
  });

  const addBtn = el('button', 'btn btn-add', '+ 新增条目');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    const skeleton = skeletonOf(node.item);
    store.update((pack) => {
      (pack[section] as unknown[]).push(skeleton);
    });
    opts.expanded.add(value.length);
    rerender();
  });
  container.append(list, addBtn);
}

function entryCard(
  node: ArrayNode,
  section: string,
  value: unknown[],
  index: number,
  store: EditorStore,
  rerender: () => void,
  touch: Commit,
  opts: SectionRenderOpts,
): HTMLElement {
  const card = el('div', 'entry-card');
  card.dataset.path = `/${section}/${index}`;

  const header = el('div', 'entry-header');
  const summary = el('span', 'entry-summary', `${index + 1}. ${entrySummary(value[index])}`);
  header.append(summary);

  const syncSummary = (): void => {
    summary.textContent = `${index + 1}. ${entrySummary(value[index])}`;
  };

  const makeBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const button = el('button', 'btn btn-mini', label);
    button.type = 'button';
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  };
  header.append(
    makeBtn('↑', '上移', () => {
      if (index === 0) return;
      store.update((pack) => {
        const list = pack[section] as unknown[];
        [list[index - 1], list[index]] = [list[index]!, list[index - 1]!];
      });
      opts.expanded.delete(index);
      opts.expanded.add(index - 1);
      rerender();
    }),
    makeBtn('↓', '下移', () => {
      if (index >= value.length - 1) return;
      store.update((pack) => {
        const list = pack[section] as unknown[];
        [list[index + 1], list[index]] = [list[index]!, list[index + 1]!];
      });
      opts.expanded.delete(index);
      opts.expanded.add(index + 1);
      rerender();
    }),
    makeBtn('✕', '删除', () => {
      if (!window.confirm(`删除条目 ${entrySummary(value[index])}？`)) return;
      store.update((pack) => {
        (pack[section] as unknown[]).splice(index, 1);
      });
      opts.expanded.delete(index);
      rerender();
    }),
  );

  const isOpen = opts.expanded.has(index);
  const toggle = makeBtn(isOpen ? '收起' : '编辑', '展开编辑', () => {
    if (opts.expanded.has(index)) {
      opts.expanded.delete(index);
    } else {
      opts.expanded.add(index);
    }
    rerender();
  });
  header.append(toggle);

  // 拖拽排序（HTML5 DnD；上移/下移按钮为键盘/测试可达路径）。
  header.draggable = true;
  header.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/plain', String(index));
    event.dataTransfer!.effectAllowed = 'move';
  });
  header.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
  });
  header.addEventListener('drop', (event) => {
    event.preventDefault();
    const from = Number.parseInt(event.dataTransfer?.getData('text/plain') ?? '', 10);
    if (Number.isNaN(from) || from === index || from < 0 || from >= value.length) {
      return;
    }
    store.update((pack) => {
      const list = pack[section] as unknown[];
      const [moved] = list.splice(from, 1);
      list.splice(index, 0, moved!);
    });
    if (opts.expanded.has(from)) {
      opts.expanded.delete(from);
      opts.expanded.add(index);
    }
    rerender();
  });

  card.append(header);
  if (isOpen) {
    const body = el('div', 'entry-body');
    const entryNode = node.item;
    const entry = value[index] as Record<string, unknown>;
    const entryPath = `/${section}/${index}`;
    if (entryNode.kind === 'oneOf') {
      renderOneOfBody(body, entryNode, entry, entryPath, store, section, index, rerender, touch, syncSummary);
    } else if (entryNode.kind === 'object') {
      renderObjectFields(body, entryNode, entry, entryPath, touch, rerender);
    }
    card.append(body);
  }
  return card;
}

/* ==================== oneOf（item 五形态） ==================== */

function renderOneOfBody(
  body: HTMLElement,
  node: OneOfNode,
  value: Record<string, unknown>,
  path: string,
  store: EditorStore,
  section: string,
  index: number,
  rerender: () => void,
  touch: Commit,
  syncSummary: () => void,
): void {
  const current = typeof value['type'] === 'string' ? value['type'] : node.branches[0]?.discriminator ?? '';
  const branchRow = el('div', 'field-row');
  const branchLabel = el('label', 'field-label', '形态');
  const select = document.createElement('select');
  select.className = 'input branch-select';
  for (const branch of node.branches) {
    const option = document.createElement('option');
    option.value = branch.discriminator;
    option.textContent = branch.label;
    option.selected = branch.discriminator === current;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const next = switchBranch(value, node, select.value);
    store.update((pack) => {
      (pack[section] as unknown[])[index] = next;
    });
    rerender();
  });
  branchRow.append(branchLabel, select);
  body.append(branchRow);

  const branch = node.branches.find((candidate) => candidate.discriminator === current) ?? node.branches[0];
  if (branch !== undefined && branch.node.kind === 'object') {
    renderObjectFields(body, branch.node, value, path, touch, rerender, syncSummary);
  }
}

/* ==================== 封闭对象字段表 ==================== */

function renderObjectFields(
  body: HTMLElement,
  node: ObjectNode,
  value: Record<string, unknown>,
  path: string,
  touch: Commit,
  onStructure: () => void,
  syncSummary?: () => void,
): void {
  for (const field of node.fields) {
    if (!field.required && !(field.field in value)) {
      continue; // 可选字段未启用不渲染（「添加字段」入口补）。
    }
    body.append(fieldRow(field, value, path, touch, onStructure, syncSummary));
  }

  // 添加可选字段。
  const optional = node.fields.filter((field) => !field.required && !(field.field in value));
  if (optional.length > 0) {
    const addRow = el('div', 'field-add-row');
    const addSelect = document.createElement('select');
    addSelect.className = 'input input-inline';
    addSelect.append(optionEl('＋ 添加字段…', ''));
    for (const field of optional) {
      addSelect.append(optionEl(field.field, field.label));
    }
    addSelect.addEventListener('change', () => {
      if (addSelect.value === '') return;
      const field = optional.find((candidate) => candidate.field === addSelect.value)!;
      touch(() => {
        value[field.field] = skeletonOf(field);
      });
      onStructure();
    });
    addRow.append(addSelect);
    body.append(addRow);
  }

  // 附加开放键值容器（bonuses 的 patternProperties 等）。
  if (node.dict !== undefined) {
    body.append(dictBlock(node.dict, value, path, touch, onStructure));
  }
}

function fieldRow(
  field: FormNode,
  value: Record<string, unknown>,
  path: string,
  touch: Commit,
  onStructure: () => void,
  syncSummary?: () => void,
): HTMLElement {
  const row = el('div', 'field-row');
  const fullPath = `${path}/${field.field}`;
  const label = el('label', 'field-label', field.label);
  if (field.description !== undefined) {
    label.title = field.description;
    label.classList.add('has-hint');
  }
  if (!field.required) {
    label.classList.add('optional');
  }
  row.dataset.path = fullPath;
  row.append(label);
  row.append(controlOf(field, value, field.field, fullPath, touch, onStructure, syncSummary));
  return row;
}

/* ==================== 控件分派 ==================== */

function controlOf(
  node: FormNode,
  container: Record<string, unknown>,
  key: string,
  path: string,
  touch: Commit,
  onStructure: () => void,
  syncSummary?: () => void,
): HTMLElement {
  switch (node.kind) {
    case 'string':
      return stringControl(node, container, key, touch, syncSummary);
    case 'integer':
    case 'number':
      return numberControl(node, container, key, touch);
    case 'boolean':
      return checkboxControl(container, key, touch);
    case 'select':
      return selectControl(node, container, key, touch);
    case 'object': {
      const wrap = el('div', 'nested-object');
      const child = container[key];
      if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
        renderObjectFields(wrap, node, child as Record<string, unknown>, path, touch, onStructure);
      }
      return wrap;
    }
    case 'array':
      return arrayControl(node, container, key, path, touch, onStructure);
    case 'dict':
      return dictBlock(
        { keyPattern: node.keyPattern, keyXref: node.keyXref, valueNode: node.valueNode },
        container[key] as Record<string, unknown>,
        path,
        touch,
        onStructure,
        node.requiredKeys,
      );
    case 'oneOf': {
      const wrap = el('div', 'nested-object');
      const child = container[key];
      if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
        renderOneOfInline(wrap, node, child as Record<string, unknown>, path, touch, onStructure);
      }
      return wrap;
    }
  }
}

function stringControl(
  node: { pattern?: string; minLength?: number; maxLength?: number; xref?: FormNode['xref'] },
  container: Record<string, unknown>,
  key: string,
  touch: Commit,
  syncSummary?: () => void,
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.value = typeof container[key] === 'string' ? (container[key] as string) : '';
  if (node.pattern !== undefined) {
    input.placeholder = `格式 ${node.pattern}`;
  }
  if (node.xref !== undefined) {
    attachXrefDatalist(input, node.xref);
  }
  input.addEventListener('input', () => {
    touch(() => {
      container[key] = input.value;
    });
    syncSummary?.();
  });
  return input;
}

function numberControl(
  node: { kind: 'integer' | 'number'; min?: number; max?: number },
  container: Record<string, unknown>,
  key: string,
  touch: Commit,
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'input';
  input.step = node.kind === 'integer' ? '1' : 'any';
  if (node.min !== undefined) input.min = String(node.min);
  if (node.max !== undefined) input.max = String(node.max);
  const current = container[key];
  input.value = typeof current === 'number' ? String(current) : '';
  input.addEventListener('input', () => {
    const parsed = node.kind === 'integer' ? Number.parseInt(input.value, 10) : Number.parseFloat(input.value);
    if (Number.isNaN(parsed)) return; // 清空输入中：不写回，避免破类型。
    touch(() => {
      container[key] = parsed;
    });
  });
  return input;
}

function checkboxControl(
  container: Record<string, unknown>,
  key: string,
  touch: Commit,
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = container[key] === true;
  input.addEventListener('change', () => {
    touch(() => {
      container[key] = input.checked;
    });
  });
  return input;
}

function selectControl(
  node: { options: readonly { value: string; label: string }[]; xref?: FormNode['xref'] },
  container: Record<string, unknown>,
  key: string,
  touch: Commit,
): HTMLElement {
  const select = document.createElement('select');
  select.className = 'input';
  const current = typeof container[key] === 'string' ? (container[key] as string) : '';
  for (const option of node.options) {
    select.append(optionEl(option.value, option.label, option.value === current));
  }
  if (current !== '' && !node.options.some((option) => option.value === current)) {
    select.append(optionEl(current, current, true));
  }
  if (node.options.length <= 1) {
    select.disabled = true; // 单值判别字段（分支内 type）。
  }
  select.addEventListener('change', () => {
    touch(() => {
      container[key] = select.value;
    });
  });
  return select;
}

/* ==================== 数组控件（非节数组：drops/materials 列表等） ==================== */

function arrayControl(
  node: ArrayNode,
  container: Record<string, unknown>,
  key: string,
  path: string,
  touch: Commit,
  onStructure: () => void,
): HTMLElement {
  const wrap = el('div', 'array-block');
  const list = Array.isArray(container[key]) ? (container[key] as unknown[]) : [];
  const itemsWrap = el('div', 'array-items');
  list.forEach((_, index) => {
    itemsWrap.append(arrayItemRow(node, list, index, path, touch, onStructure));
  });
  wrap.append(itemsWrap);
  const addBtn = el('button', 'btn btn-mini', '+ 添加');
  addBtn.type = 'button';
  addBtn.disabled = node.maxItems !== undefined && list.length >= node.maxItems;
  addBtn.addEventListener('click', () => {
    touch(() => {
      list.push(skeletonOf(node.item));
    });
    onStructure();
  });
  wrap.append(addBtn);
  return wrap;
}

function arrayItemRow(
  node: ArrayNode,
  list: unknown[],
  index: number,
  path: string,
  touch: Commit,
  onStructure: () => void,
): HTMLElement {
  const row = el('div', 'array-item');
  row.dataset.path = `${path.replace(/\*$/, '')}/${index}`;
  const itemNode = node.item;

  const removeBtn = el('button', 'btn btn-mini', '✕');
  removeBtn.type = 'button';
  removeBtn.title = '移除该项';
  removeBtn.addEventListener('click', () => {
    touch(() => {
      list.splice(index, 1);
    });
    onStructure();
  });
  const upBtn = el('button', 'btn btn-mini', '↑');
  upBtn.type = 'button';
  upBtn.title = '上移';
  upBtn.addEventListener('click', () => {
    if (index === 0) return;
    touch(() => {
      [list[index - 1], list[index]] = [list[index]!, list[index - 1]!];
    });
    onStructure();
  });
  const downBtn = el('button', 'btn btn-mini', '↓');
  downBtn.type = 'button';
  downBtn.title = '下移';
  downBtn.addEventListener('click', () => {
    if (index >= list.length - 1) return;
    touch(() => {
      [list[index + 1], list[index]] = [list[index]!, list[index + 1]!];
    });
    onStructure();
  });

  const content = el('div', 'array-item-content');
  if (typeof list[index] === 'object' && list[index] !== null && !Array.isArray(list[index])) {
    const record = list[index] as Record<string, unknown>;
    const itemPath = `${path.replace(/\*$/, String(index))}`;
    if (itemNode.kind === 'object') {
      renderObjectFields(content, itemNode, record, itemPath, touch, onStructure);
    } else if (itemNode.kind === 'oneOf') {
      renderOneOfInline(content, itemNode, record, itemPath, touch, onStructure);
    }
  } else {
    // 标量数组条目（pool 的物品 id、reset 的键等）：行内 input。
    content.append(scalarItemInput(itemNode, list, index, touch));
  }
  row.append(el('span', 'array-item-index', String(index + 1)), content, upBtn, downBtn, removeBtn);
  return row;
}

function scalarItemInput(node: FormNode, list: unknown[], index: number, touch: Commit): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.value = typeof list[index] === 'string' ? (list[index] as string) : '';
  if (node.xref !== undefined) {
    attachXrefDatalist(input, node.xref);
  }
  input.addEventListener('input', () => {
    touch(() => {
      list[index] = input.value;
    });
  });
  return input;
}

/* ==================== oneOf 内嵌（非条目级） ==================== */

function renderOneOfInline(
  wrap: HTMLElement,
  node: OneOfNode,
  value: Record<string, unknown>,
  path: string,
  touch: Commit,
  onStructure: () => void,
): void {
  const current = typeof value['type'] === 'string' ? value['type'] : '';
  const branch = node.branches.find((candidate) => candidate.discriminator === current) ?? node.branches[0];
  if (branch !== undefined && branch.node.kind === 'object') {
    renderObjectFields(wrap, branch.node, value, path, touch, onStructure);
  }
}

/* ==================== 开放键值字典 ==================== */

interface DictShapeView {
  readonly keyPattern?: string;
  readonly keyXref?: XrefTarget;
  readonly valueNode: FormNode;
}

function dictBlock(
  dict: DictShapeView,
  value: Record<string, unknown>,
  path: string,
  touch: Commit,
  onStructure: () => void,
  requiredKeys: readonly string[] = [],
): HTMLElement {
  const wrap = el('div', 'dict-block');
  const keys = Object.keys(value ?? {});
  const rows = el('div', 'dict-rows');
  for (const key of keys) {
    rows.append(dictRow(dict, value, key, path, touch, onStructure, requiredKeys.includes(key)));
  }
  wrap.append(rows);
  const addBtn = el('button', 'btn btn-mini', '+ 添加键');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    let candidate = 'key1';
    let n = 1;
    while (candidate in value) {
      n += 1;
      candidate = `key${n}`;
    }
    touch(() => {
      value[candidate] = skeletonOf(dict.valueNode);
    });
    onStructure();
  });
  wrap.append(addBtn);
  return wrap;
}

function dictRow(
  dict: DictShapeView,
  value: Record<string, unknown>,
  key: string,
  path: string,
  touch: Commit,
  onStructure: () => void,
  locked: boolean,
): HTMLElement {
  const row = el('div', 'dict-row');
  row.dataset.path = `${path}/${key}`;
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'input dict-key';
  keyInput.value = key;
  keyInput.placeholder = dict.keyPattern !== undefined ? `键格式 ${dict.keyPattern}` : '键';
  if (dict.keyXref !== undefined) {
    attachXrefDatalist(keyInput, dict.keyXref);
  }
  keyInput.addEventListener('change', () => {
    const next = keyInput.value.trim();
    if (next === '' || next === key || next in value) {
      keyInput.value = key;
      return;
    }
    touch(() => {
      value[next] = value[key];
      delete value[key];
    });
    onStructure();
  });

  const removeBtn = el('button', 'btn btn-mini', '✕');
  removeBtn.type = 'button';
  removeBtn.title = locked ? '语义恒需键（删除将无法过校验）' : '移除该键';
  removeBtn.addEventListener('click', () => {
    touch(() => {
      delete value[key];
    });
    onStructure();
  });

  const valueWrap = el('div', 'dict-value');
  const valueNode = dict.valueNode;
  const childValue = value[key];
  if (typeof childValue === 'object' && childValue !== null && !Array.isArray(childValue)) {
    if (valueNode.kind === 'array') {
      valueWrap.append(
        arrayControl(valueNode, value, key, `${path}/*`, touch, onStructure),
      );
    } else if (valueNode.kind === 'object') {
      renderObjectFields(valueWrap, valueNode, childValue as Record<string, unknown>, `${path}/${key}`, touch, onStructure);
    }
  } else {
    // 标量值（reasonMap 的字符串等）。
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.value = typeof childValue === 'string' ? childValue : String(childValue ?? '');
    input.addEventListener('input', () => {
      touch(() => {
        value[key] = input.value;
      });
    });
    valueWrap.append(input);
  }

  row.append(keyInput, valueWrap, removeBtn);
  return row;
}

/* ==================== xref 池接线 ==================== */

/** 当前包快照（renderSection 入口更新；datalist focus 时读取）。 */
let xrefPack: Record<string, unknown> = {};

function currentXrefPool(target: XrefTarget | undefined): readonly string[] {
  return target !== undefined ? xrefOptions(xrefPack, target) : [];
}
