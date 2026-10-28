// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { EditorStore } from '../src/core/state.js';
import { createSectionController, remapExpanded } from '../src/ui/render.js';
import { xiuxianStore } from './helpers.js';

/**
 * 写回收敛单门（#49）：remapExpanded 纯函数单测 + 六处结构写回（增/删/
 * 移/拖/换支/展开切换）的 DOM 级行为——含 expanded 跟随回归（删中间
 * 条目→展开态不错位、拖拽区间旋转、新增就地展开）与 xref datalist
 * 参数化活体（D3）。
 *
 * 变异对照（交付前经 scripts/mutation-check.mjs 验红，改完必须验红再
 * 还原，别信「测试在场」）：
 * - remapExpanded 删除分支只删单下标（上方条目不平移）→「删中间条目」
 *   纯函数用例与 DOM 回归用例双红；
 * - remapExpanded 移动分支只迁 from→to（区间不旋转）→ 拖拽用例红；
 * - mutate 丢 insert 展开（或改回 value.length off-by-one）→ 新增用例红；
 * - replace 改为写错下标 / switchBranch 后丢 replace 落空 → 换支用例红；
 * - #56 项 3：清空态标红丢 input-pending → 清空用例红；blur 回填断链
 *   （恒空串）→ 失焦回填断言红。
 */

function renderWith(store: EditorStore, section: string, expand: readonly number[] = []): void {
  document.body.replaceChildren(); // happy-dom 清场：防跨用例查询串场。
  const area = document.createElement('main');
  document.body.append(area);
  const controller = createSectionController(store);
  for (const index of expand) {
    controller.expandEntry(index);
  }
  controller.render(area, section);
}

/** 展开中的条目卡 data-path（展开 = 卡内有 entry-body）。 */
function expandedPaths(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.entry-card')]
    .filter((card) => card.querySelector('.entry-body') !== null)
    .map((card) => card.dataset.path!);
}

function cardButton(cardIndex: number, title: string): HTMLButtonElement {
  const button = document.querySelectorAll<HTMLElement>('.entry-card')[cardIndex]?.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (button === undefined || button === null) {
    throw new Error(`第 ${cardIndex} 卡无 ${title} 按钮`);
  }
  return button;
}

/** 展开切换按钮（label 随状态在 收起/编辑 间切换，title 恒为 展开编辑）。 */
function cardToggle(cardIndex: number): HTMLButtonElement {
  return cardButton(cardIndex, '展开编辑');
}

function enemiesOf(store: EditorStore): { id: string }[] {
  return store.state.pack['enemies'] as { id: string }[];
}

describe('#49 · remapExpanded 重映射纯函数（D1）', () => {
  it('删除中间位：被删位移除，上方条目全部 -1', () => {
    expect(remapExpanded(new Set([0, 2, 4]), { kind: 'remove', at: 2 })).toEqual(new Set([0, 3]));
  });

  it('删除首位与删被展开条目本体：展开态随删除消失', () => {
    expect(remapExpanded(new Set([0, 3]), { kind: 'remove', at: 0 })).toEqual(new Set([2]));
    expect(remapExpanded(new Set([2]), { kind: 'remove', at: 2 })).toEqual(new Set());
  });

  it('插入中间位：≥插入位全部 +1；尾部插入不动既有下标', () => {
    expect(remapExpanded(new Set([0, 2]), { kind: 'insert', at: 1, value: null })).toEqual(new Set([0, 3]));
    expect(remapExpanded(new Set([0]), { kind: 'insert', at: 3, value: null })).toEqual(new Set([0]));
  });

  it('移动后移（from<to）：区间 (from,to] 整体 -1，from 落 to', () => {
    expect(remapExpanded(new Set([0, 1, 3, 4]), { kind: 'move', from: 3, to: 1 })).toEqual(new Set([0, 2, 1, 4]));
  });

  it('移动前移（from>to）：区间 [to,from) 整体 +1，from 落 to', () => {
    expect(remapExpanded(new Set([0, 1, 2, 3]), { kind: 'move', from: 1, to: 3 })).toEqual(new Set([0, 3, 1, 2]));
  });

  it('换支（replace）下标恒等；纯函数不改传入集合', () => {
    const expanded = new Set([1, 2]);
    expect(remapExpanded(expanded, { kind: 'replace', at: 1, value: null })).toEqual(new Set([1, 2]));
    expect(expanded).toEqual(new Set([1, 2]));
  });
});

describe('#49 · 结构写回 DOM 级行为（增/删/移/拖/换支/展开切换）', () => {
  it('删除中间条目：上方条目展开态跟随平移，不错贴（AC3 回归）', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies', [0, 2]);
    expect(expandedPaths()).toEqual(['/enemies/0', '/enemies/2']);

    window.confirm = () => true;
    cardButton(1, '删除').click();

    expect(enemiesOf(store)).toHaveLength(7);
    expect(expandedPaths()).toEqual(['/enemies/0', '/enemies/1']);
    // 内容跟随：现 1 号卡展开的是旧 2 号条目（e3）。
    const summaries = [...document.querySelectorAll('.entry-summary')].map((node) => node.textContent);
    expect(summaries[1]).toContain('e3');
  });

  it('新增条目就地展开，连加不遗幽灵下标（off-by-one 回归）', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies');
    const addBtn = document.querySelector<HTMLButtonElement>('.btn-add')!;

    addBtn.click();
    expect(expandedPaths()).toEqual(['/enemies/8']);
    addBtn.click();
    expect(expandedPaths()).toEqual(['/enemies/8', '/enemies/9']);
    expect(enemiesOf(store)).toHaveLength(10);
  });

  it('上移/下移：条目与展开态同步对换', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies', [2]);

    cardButton(2, '上移').click();
    expect(expandedPaths()).toEqual(['/enemies/1']);
    expect(enemiesOf(store)[1]!.id).toBe('e3');

    cardButton(1, '下移').click();
    expect(expandedPaths()).toEqual(['/enemies/2']);
    expect(enemiesOf(store)[2]!.id).toBe('e3');
  });

  it('拖拽跨位：区间旋转，展开态整体迁移而非只迁 from→to', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies', [0, 1]);

    // 0 号（e1）拖到 2 号位：旧 1 号（展开的 e2）应平移到 0 号位。
    const headers = document.querySelectorAll<HTMLElement>('.entry-header');
    const dataTransfer = {
      getData: (type: string): string => (type === 'text/plain' ? '0' : ''),
    } as unknown as DataTransfer;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    headers[2]!.dispatchEvent(drop);

    expect(enemiesOf(store).map((entry) => entry.id)).toEqual(['e2', 'e3', 'e1', 'e4', 'e5', 'e6', 'e7', 'e8']);
    expect(expandedPaths()).toEqual(['/enemies/0', '/enemies/2']);
  });

  it('oneOf 换支：原位替换、公共字段保留、条目保持展开', () => {
    const store = xiuxianStore();
    renderWith(store, 'items', [0]);
    const select = document.querySelector<HTMLSelectElement>('.branch-select')!;
    expect(select.value).toBe('mat');

    select.value = 'equip';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const item = (store.state.pack['items'] as { id: string; type: string }[])[0]!;
    expect(item.type).toBe('equip');
    expect(item.id).toBe('qi1');
    expect(expandedPaths()).toEqual(['/items/0']);
    expect(document.querySelector('[data-path="/items/0/slot"]')).not.toBeNull();
  });

  it('展开切换走控制器（toggleEntry）：不触数据、仅重渲染', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies', [0]);
    expect(expandedPaths()).toEqual(['/enemies/0']);
    expect(store.state.dirty).toBe(false);

    cardToggle(0).click();
    expect(expandedPaths()).toEqual([]);
    cardToggle(0).click();
    expect(expandedPaths()).toEqual(['/enemies/0']);
    expect(store.state.dirty).toBe(false);
  });

  it('xref datalist focus 时按当前包快照求值（D3 参数化活体）', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies', [0]);
    // 嵌套数组条目行的 data-path 不含条目下标（arrayItemRow 既有口径），
    // 首个命中即 drops[0] 的 item 字段。
    const row = document.querySelector('[data-path="/enemies/0/drops/item"]');
    if (row === null) {
      throw new Error('drops[0].item 字段行未渲染');
    }
    const input = row.querySelector('input')!;
    input.dispatchEvent(new Event('focus'));
    const datalist = document.getElementById(input.getAttribute('list')!)!;
    const options = [...datalist.querySelectorAll('option')].map((option) => option.getAttribute('value'));
    expect(options.length).toBeGreaterThan(0);
    expect(options).toContain('core1');
  });
});

describe('#74-2 · 坏形态包的渲染守卫（update 旁门写坏后不 TypeError）', () => {
  it('条目非对象：展开落「形态异常」提示，不炸渲染', () => {
    const store = xiuxianStore();
    store.update((pack) => {
      (pack['enemies'] as unknown[])[0] = 'oops-scalar';
    });
    expect(() => renderWith(store, 'enemies', [0])).not.toThrow();
    expect(document.querySelector('.entry-body')!.textContent).toContain('形态异常');
  });

  it('节数组被旁门删除后点陈旧卡片的删除钮：可读错误经 update 回滚重抛', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies');
    store.update((pack) => {
      delete pack['enemies'];
    });
    const removeBtn = [...document.querySelectorAll<HTMLButtonElement>('.entry-card button')].find(
      (node) => node.textContent === '✕',
    )!;
    // mutate → applyEntryOp 守卫抛错 → store.update 回滚后原样重抛（装配层
    // 靠 'rollback' 事件 toast + 重绘；此处钉错误可读 + 回滚后包仍是删除态）。
    expect(() => removeBtn.click()).toThrow('包形态损坏');
    expect('enemies' in store.state.pack).toBe(false);
  });
});

describe('#56 项 3 · 数字清空态：标红提示 + 失焦回填（UI 与数据不再静默分叉）', () => {
  const hpOf = (store: EditorStore): unknown =>
    (store.state.pack['enemies'] as { hp: unknown }[])[0]!.hp;

  function hpInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('[data-path="/enemies/0/hp"] input');
    if (input === null) {
      throw new Error('hp 字段行未渲染');
    }
    return input;
  }

  it('清空输入：数据持旧值不破类型、输入框标红；失焦回填旧值并熄灭', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies', [0]);
    const input = hpInput();
    const before = hpOf(store);

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(hpOf(store)).toBe(before);
    expect(store.state.dirty).toBe(false);
    expect(input.classList.contains('input-pending')).toBe(true);

    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe(String(before));
    expect(input.classList.contains('input-pending')).toBe(false);
  });

  it('清空后续输合法值：标红即熄、数据写回；blur 后显示与数据一致', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies', [0]);
    const input = hpInput();

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('input-pending')).toBe(true);

    input.value = '77';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('input-pending')).toBe(false);
    expect(hpOf(store)).toBe(77);

    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('77');
  });
});
