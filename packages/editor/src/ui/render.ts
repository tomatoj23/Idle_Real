/**
 * 控件树 → DOM（#11 表单渲染）。
 *
 * 写回策略（#49 收敛为 Commit 控制器单门）：标量输入经 touch 直改引用
 * （不重渲染，焦点保持）；条目结构操作（新增/删除/上下移/拖拽/oneOf 换支）
 * 全部经 mutate 的类型化 EntryOp——数据变更、expanded 单点重映射
 * （remapExpanded 纯函数）、整节重渲染一体完成；嵌套结构（字段添加、
 * 非节数组、字典行）走 touch + rerender，不涉条目下标故无重映射。
 * store.update 的直接调用面仅剩控制器一处。校验由外层回调 debounce 重跑。
 *
 * data-path 标注与 validateContentPack 错误 path 同构（`/节/…/字段`），
 * 错误点击定位靠它。
 */

import { sectionSchemas, type JsonSchema } from '@wendao/content';
import { skeletonOf, switchBranch } from '../core/defaults.js';
import { buildFormNode, sectionTitle, type ArrayNode, type FormNode, type ObjectNode, type OneOfNode } from '../core/model.js';
import type { EditorStore } from '../core/state.js';
import { xrefOptions, type XrefTarget } from '../core/xref.js';

/**
 * 条目结构操作（#49 D2）：手风琴条目列表（节数组顶层）的全部合法结构写。
 * 下标均为操作前口径；插入默认展开新条目（作者就地续填）。
 */
export type EntryOp =
  | { readonly kind: 'insert'; readonly at: number; readonly value: unknown }
  | { readonly kind: 'remove'; readonly at: number }
  | { readonly kind: 'move'; readonly from: number; readonly to: number }
  | { readonly kind: 'replace'; readonly at: number; readonly value: unknown };

/** 写回通道（#49 D2）：「一切变更过 store.update」从注释变类型。 */
export interface Commit {
  /** 条目是否展开（expanded 所有权在控制器，渲染树只读）。 */
  isExpanded(index: number): boolean;
  /** 切换条目展开态（纯 UI 态：不触数据/标脏，仅重渲染）。 */
  toggleEntry(index: number): void;
  /** 标量写：直改引用 + 标脏 + onData，不重渲染（焦点保持）。 */
  touch(fn: () => void): void;
  /** 条目结构写：数据变更 + expanded 单点重映射 + 整节重渲染。 */
  mutate(op: EntryOp): void;
  /** 嵌套结构重渲染（非节数组/字典行/字段添加——不涉条目下标，无重映射）。 */
  rerender(): void;
  /** 跨引用候选池（datalist focus 时按当前包快照求值，#49 D3 参数化）。 */
  xrefPool(target: XrefTarget): readonly string[];
}

export interface SectionRenderOpts {
  /** 结构性变更后回调（默认整节重渲染由内部完成；外层接校验刷新）。 */
  readonly onStructure?: () => void;
  /** 标量数据变更后回调（外层 debounce 校验）。 */
  readonly onData?: () => void;
}

/** 节渲染控制器（#49 D2）：expanded 所有权收进控制器，调用方不再持有。 */
export interface SectionController {
  /** 渲染指定节（结构性操作内部自渲染）。 */
  render(container: HTMLElement, section: string): void;
  /** 清空展开态（换节/换包）。 */
  collapseAll(): void;
  /** 展开指定条目（错误定位跳转）。 */
  expandEntry(index: number): void;
}

export function createSectionController(
  store: EditorStore,
  opts: SectionRenderOpts = {},
): SectionController {
  const expanded = new Set<number>();
  const render = (container: HTMLElement, section: string): void => {
    const rerender = (): void => {
      render(container, section);
      opts.onStructure?.();
    };
    const commit: Commit = {
      isExpanded: (index) => expanded.has(index),
      toggleEntry: (index) => {
        if (expanded.has(index)) {
          expanded.delete(index);
        } else {
          expanded.add(index);
        }
        rerender();
      },
      touch: (fn) => {
        store.update(fn);
        opts.onData?.();
      },
      mutate: (op) => {
        store.update((pack) => applyEntryOp(pack, section, op));
        // expanded 单点重映射（#49 D1）：按操作前集合求映射后回填。
        const remapped = remapExpanded(expanded, op);
        expanded.clear();
        for (const index of remapped) {
          expanded.add(index);
        }
        if (op.kind === 'insert') {
          expanded.add(op.at);
        }
        rerender();
      },
      rerender,
      xrefPool: (target) => xrefOptions(store.state.pack, target),
    };
    renderSectionInto(container, store, section, commit);
  };
  return {
    render,
    collapseAll: () => expanded.clear(),
    expandEntry: (index) => expanded.add(index),
  };
}

/**
 * 结构操作后的条目下标重映射（#49 D1 单点纯函数）：旧展开集 → 新展开集，
 * 返回新 Set 不改传入。删除 → 大于被删位的全部 -1；插入 → ≥插入位的全部
 * +1；移动 → 区间旋转。原三例错位（新增 off-by-one / 删除只删单下标 /
 * 拖拽只迁 from→to 一对）全部收进此函数，配单测钉住。
 */
export function remapExpanded(expanded: ReadonlySet<number>, op: EntryOp): Set<number> {
  const next = new Set<number>();
  for (const index of expanded) {
    const mapped = remappedIndex(op, index);
    if (mapped !== null) {
      next.add(mapped);
    }
  }
  return next;
}

/** 单下标映射：null = 该条目已随操作删除，展开态随之移除。 */
function remappedIndex(op: EntryOp, index: number): number | null {
  switch (op.kind) {
    case 'insert':
      return index >= op.at ? index + 1 : index;
    case 'remove':
      if (index === op.at) {
        return null;
      }
      return index > op.at ? index - 1 : index;
    case 'move':
      if (index === op.from) {
        return op.to;
      }
      if (op.from < op.to) {
        return index > op.from && index <= op.to ? index - 1 : index;
      }
      return index >= op.to && index < op.from ? index + 1 : index;
    case 'replace':
      return index;
  }
}

/** EntryOp 的数据面：对节顶层数组就地应用（expanded 面由 mutate 负责）。 */
function applyEntryOp(pack: Record<string, unknown>, section: string, op: EntryOp): void {
  const list = pack[section] as unknown[];
  switch (op.kind) {
    case 'insert':
      list.splice(op.at, 0, op.value);
      break;
    case 'remove':
      list.splice(op.at, 1);
      break;
    case 'move': {
      const [moved] = list.splice(op.from, 1);
      list.splice(op.to, 0, moved!);
      break;
    }
    case 'replace':
      list[op.at] = op.value;
      break;
  }
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

/** 渲染当前节到容器（结构性操作由 Commit 控制器自渲染）。 */
function renderSectionInto(
  container: HTMLElement,
  store: EditorStore,
  section: string,
  commit: Commit,
): void {
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
  const title = el('h2', 'section-title', sectionTitle(section));
  title.dataset.path = `/${section}`;
  container.append(title);

  if (Array.isArray(value)) {
    renderArraySection(container, section, schema, value, commit);
  } else if (typeof value === 'object' && value !== null) {
    const node = buildFormNode(schema, schema, '', section, true);
    if (node.kind === 'object') {
      const body = el('div', 'object-body');
      renderObjectFields(body, node, value as Record<string, unknown>, `/${section}`, commit);
      container.append(body);
    }
  } else {
    container.append(el('p', 'empty-hint', `内容节 ${section} 缺失（坏包？重导入）。`));
  }
}

/* ==================== 数组节（手风琴条目列表） ==================== */

function renderArraySection(
  container: HTMLElement,
  section: string,
  schema: JsonSchema,
  value: unknown[],
  commit: Commit,
): void {
  const node = buildFormNode(schema, schema, '', section, true);
  if (node.kind !== 'array') {
    return;
  }
  const list = el('div', 'entry-list');
  value.forEach((entry, index) => {
    list.append(entryCard(node, section, value, index, commit));
  });

  const addBtn = el('button', 'btn btn-add', '+ 新增条目');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    // at 取点击时活引用长度（渲染后无未重渲染的结构变更，二者恒一致）；
    // 新条目展开由 mutate 的 insert 策略负责。
    commit.mutate({ kind: 'insert', at: value.length, value: skeletonOf(node.item) });
  });
  container.append(list, addBtn);
}

function entryCard(
  node: ArrayNode,
  section: string,
  value: unknown[],
  index: number,
  commit: Commit,
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
      commit.mutate({ kind: 'move', from: index, to: index - 1 });
    }),
    makeBtn('↓', '下移', () => {
      if (index >= value.length - 1) return;
      commit.mutate({ kind: 'move', from: index, to: index + 1 });
    }),
    makeBtn('✕', '删除', () => {
      if (!window.confirm(`删除条目 ${entrySummary(value[index])}？`)) return;
      commit.mutate({ kind: 'remove', at: index });
    }),
  );

  const isOpen = commit.isExpanded(index);
  const toggle = makeBtn(isOpen ? '收起' : '编辑', '展开编辑', () => {
    commit.toggleEntry(index);
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
    commit.mutate({ kind: 'move', from, to: index });
  });

  card.append(header);
  if (isOpen) {
    const body = el('div', 'entry-body');
    const entryNode = node.item;
    const entry = value[index] as Record<string, unknown>;
    const entryPath = `/${section}/${index}`;
    if (entryNode.kind === 'oneOf') {
      renderOneOfBody(body, entryNode, entry, entryPath, section, index, commit, syncSummary);
    } else if (entryNode.kind === 'object') {
      renderObjectFields(body, entryNode, entry, entryPath, commit, syncSummary);
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
  section: string,
  index: number,
  commit: Commit,
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
    // 保留面取自旧值，必须先算后写（value 是活引用）。
    const next = switchBranch(value, node, select.value);
    commit.mutate({ kind: 'replace', at: index, value: next });
  });
  branchRow.append(branchLabel, select);
  body.append(branchRow);

  const branch = node.branches.find((candidate) => candidate.discriminator === current) ?? node.branches[0];
  if (branch !== undefined && branch.node.kind === 'object') {
    renderObjectFields(body, branch.node, value, path, commit, syncSummary);
  }
}

/* ==================== 封闭对象字段表 ==================== */

function renderObjectFields(
  body: HTMLElement,
  node: ObjectNode,
  value: Record<string, unknown>,
  path: string,
  commit: Commit,
  syncSummary?: () => void,
): void {
  for (const field of node.fields) {
    if (!field.required && !(field.field in value)) {
      continue; // 可选字段未启用不渲染（「添加字段」入口补）。
    }
    body.append(fieldRow(field, value, path, commit, syncSummary));
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
      commit.touch(() => {
        value[field.field] = skeletonOf(field);
      });
      commit.rerender();
    });
    addRow.append(addSelect);
    body.append(addRow);
  }

  // 附加开放键值容器（bonuses 的 patternProperties 等）。
  if (node.dict !== undefined) {
    body.append(dictBlock(node.dict, value, path, commit));
  }
}

function fieldRow(
  field: FormNode,
  value: Record<string, unknown>,
  path: string,
  commit: Commit,
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
  row.append(controlOf(field, value, field.field, fullPath, commit, syncSummary));
  return row;
}

/* ==================== 控件分派 ==================== */

function controlOf(
  node: FormNode,
  container: Record<string, unknown>,
  key: string,
  path: string,
  commit: Commit,
  syncSummary?: () => void,
): HTMLElement {
  switch (node.kind) {
    case 'string':
      return stringControl(node, container, key, commit, syncSummary);
    case 'integer':
    case 'number':
      return numberControl(node, container, key, commit);
    case 'boolean':
      return checkboxControl(container, key, commit);
    case 'select':
      return selectControl(node, container, key, commit);
    case 'object': {
      const wrap = el('div', 'nested-object');
      const child = container[key];
      if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
        renderObjectFields(wrap, node, child as Record<string, unknown>, path, commit);
      }
      return wrap;
    }
    case 'array':
      return arrayControl(node, container, key, path, commit);
    case 'dict':
      return dictBlock(
        { keyPattern: node.keyPattern, keyXref: node.keyXref, valueNode: node.valueNode },
        container[key] as Record<string, unknown>,
        path,
        commit,
        node.requiredKeys,
      );
    case 'oneOf': {
      const wrap = el('div', 'nested-object');
      const child = container[key];
      if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
        renderOneOfInline(wrap, node, child as Record<string, unknown>, path, commit);
      }
      return wrap;
    }
  }
}

function stringControl(
  node: { pattern?: string; minLength?: number; maxLength?: number; xref?: FormNode['xref'] },
  container: Record<string, unknown>,
  key: string,
  commit: Commit,
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
    attachXrefDatalist(input, node.xref, commit);
  }
  input.addEventListener('input', () => {
    commit.touch(() => {
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
  commit: Commit,
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
    commit.touch(() => {
      container[key] = parsed;
    });
  });
  return input;
}

function checkboxControl(
  container: Record<string, unknown>,
  key: string,
  commit: Commit,
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = container[key] === true;
  input.addEventListener('change', () => {
    commit.touch(() => {
      container[key] = input.checked;
    });
  });
  return input;
}

function selectControl(
  node: { options: readonly { value: string; label: string }[]; xref?: FormNode['xref'] },
  container: Record<string, unknown>,
  key: string,
  commit: Commit,
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
    commit.touch(() => {
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
  commit: Commit,
): HTMLElement {
  const wrap = el('div', 'array-block');
  const list = Array.isArray(container[key]) ? (container[key] as unknown[]) : [];
  const itemsWrap = el('div', 'array-items');
  list.forEach((_, index) => {
    itemsWrap.append(arrayItemRow(node, list, index, path, commit));
  });
  wrap.append(itemsWrap);
  const addBtn = el('button', 'btn btn-mini', '+ 添加');
  addBtn.type = 'button';
  addBtn.disabled = node.maxItems !== undefined && list.length >= node.maxItems;
  addBtn.addEventListener('click', () => {
    commit.touch(() => {
      list.push(skeletonOf(node.item));
    });
    commit.rerender();
  });
  wrap.append(addBtn);
  return wrap;
}

function arrayItemRow(
  node: ArrayNode,
  list: unknown[],
  index: number,
  path: string,
  commit: Commit,
): HTMLElement {
  const row = el('div', 'array-item');
  row.dataset.path = `${path.replace(/\*$/, '')}/${index}`;
  const itemNode = node.item;

  const removeBtn = el('button', 'btn btn-mini', '✕');
  removeBtn.type = 'button';
  removeBtn.title = '移除该项';
  removeBtn.addEventListener('click', () => {
    commit.touch(() => {
      list.splice(index, 1);
    });
    commit.rerender();
  });
  const upBtn = el('button', 'btn btn-mini', '↑');
  upBtn.type = 'button';
  upBtn.title = '上移';
  upBtn.addEventListener('click', () => {
    if (index === 0) return;
    commit.touch(() => {
      [list[index - 1], list[index]] = [list[index]!, list[index - 1]!];
    });
    commit.rerender();
  });
  const downBtn = el('button', 'btn btn-mini', '↓');
  downBtn.type = 'button';
  downBtn.title = '下移';
  downBtn.addEventListener('click', () => {
    if (index >= list.length - 1) return;
    commit.touch(() => {
      [list[index + 1], list[index]] = [list[index]!, list[index + 1]!];
    });
    commit.rerender();
  });

  const content = el('div', 'array-item-content');
  if (typeof list[index] === 'object' && list[index] !== null && !Array.isArray(list[index])) {
    const record = list[index] as Record<string, unknown>;
    const itemPath = `${path.replace(/\*$/, String(index))}`;
    if (itemNode.kind === 'object') {
      renderObjectFields(content, itemNode, record, itemPath, commit);
    } else if (itemNode.kind === 'oneOf') {
      renderOneOfInline(content, itemNode, record, itemPath, commit);
    }
  } else {
    // 标量数组条目（pool 的物品 id、reset 的键等）：行内 input。
    content.append(scalarItemInput(itemNode, list, index, commit));
  }
  row.append(el('span', 'array-item-index', String(index + 1)), content, upBtn, downBtn, removeBtn);
  return row;
}

function scalarItemInput(node: FormNode, list: unknown[], index: number, commit: Commit): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.value = typeof list[index] === 'string' ? (list[index] as string) : '';
  if (node.xref !== undefined) {
    attachXrefDatalist(input, node.xref, commit);
  }
  input.addEventListener('input', () => {
    commit.touch(() => {
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
  commit: Commit,
): void {
  const current = typeof value['type'] === 'string' ? value['type'] : '';
  const branch = node.branches.find((candidate) => candidate.discriminator === current) ?? node.branches[0];
  if (branch !== undefined && branch.node.kind === 'object') {
    renderObjectFields(wrap, branch.node, value, path, commit);
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
  commit: Commit,
  requiredKeys: readonly string[] = [],
): HTMLElement {
  const wrap = el('div', 'dict-block');
  const keys = Object.keys(value ?? {});
  const rows = el('div', 'dict-rows');
  for (const key of keys) {
    rows.append(dictRow(dict, value, key, path, commit, requiredKeys.includes(key)));
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
    commit.touch(() => {
      value[candidate] = skeletonOf(dict.valueNode);
    });
    commit.rerender();
  });
  wrap.append(addBtn);
  return wrap;
}

function dictRow(
  dict: DictShapeView,
  value: Record<string, unknown>,
  key: string,
  path: string,
  commit: Commit,
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
    attachXrefDatalist(keyInput, dict.keyXref, commit);
  }
  keyInput.addEventListener('change', () => {
    const next = keyInput.value.trim();
    if (next === '' || next === key || next in value) {
      keyInput.value = key;
      return;
    }
    commit.touch(() => {
      value[next] = value[key];
      delete value[key];
    });
    commit.rerender();
  });

  const removeBtn = el('button', 'btn btn-mini', '✕');
  removeBtn.type = 'button';
  removeBtn.title = locked ? '语义恒需键（删除将无法过校验）' : '移除该键';
  removeBtn.addEventListener('click', () => {
    commit.touch(() => {
      delete value[key];
    });
    commit.rerender();
  });

  const valueWrap = el('div', 'dict-value');
  const valueNode = dict.valueNode;
  const childValue = value[key];
  if (typeof childValue === 'object' && childValue !== null && !Array.isArray(childValue)) {
    if (valueNode.kind === 'array') {
      valueWrap.append(
        arrayControl(valueNode, value, key, `${path}/*`, commit),
      );
    } else if (valueNode.kind === 'object') {
      renderObjectFields(valueWrap, valueNode, childValue as Record<string, unknown>, `${path}/${key}`, commit);
    }
  } else {
    // 标量值（reasonMap 的字符串等）。
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.value = typeof childValue === 'string' ? childValue : String(childValue ?? '');
    input.addEventListener('input', () => {
      commit.touch(() => {
        value[key] = input.value;
      });
    });
    valueWrap.append(input);
  }

  row.append(keyInput, valueWrap, removeBtn);
  return row;
}

/* ==================== xref 池接线 ==================== */

/**
 * 给输入框挂跨引用 datalist（focus 时经 commit.xrefPool 按当前包快照重建
 * 候选池——#49 D3：池求值参数化，模块级单例退役）。
 * datalist 是输入辅助不是硬约束——引用目标可能尚未建条目（先建敌人后建
 * 掉落物品），自由输入 + 校验面板兜底是有意裁断。
 */
function attachXrefDatalist(input: HTMLInputElement, xref: XrefTarget, commit: Commit): void {
  input.classList.add('xref-input');
  const listId = `dl-${(datalistSeq += 1)}`;
  input.setAttribute('list', listId);
  const datalist = document.createElement('datalist');
  datalist.id = listId;
  input.append(datalist);
  input.addEventListener('focus', () => {
    datalist.replaceChildren();
    for (const option of commit.xrefPool(xref)) {
      datalist.append(optionEl(option, option));
    }
  });
}
