// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { validateContentPack, type ContentError } from '@wendao/content';
import type { EditorStore } from '../src/core/state.js';
import { xiuxianStore } from './helpers.js';
import { createSectionController } from '../src/ui/render.js';
import { exportJsonBytes } from '../src/io/files.js';

/**
 * 端到端冒烟（验收 1 的自动化面）：渲染 enemies 表单 → 改一个敌人血量
 * → 导出包 → 整包校验通过且新值生效。（真机浏览器首跑另行人手验收。）
 */

function mount(): HTMLElement {
  document.body.replaceChildren(); // 清掉上一用例的挂载，避免跨用例查询串场。
  const area = document.createElement('main');
  document.body.append(area);
  return area;
}

/** 经控制器渲染（expanded 所有权在控制器，#49 D2）：返回挂载容器。 */
function renderWith(store: EditorStore, section: string, expand: readonly number[] = []): HTMLElement {
  const area = mount();
  const controller = createSectionController(store);
  for (const index of expand) {
    controller.expandEntry(index);
  }
  controller.render(area, section);
  return area;
}

function fieldInput(path: string): HTMLInputElement {
  const row = document.querySelector(`[data-path="${path}"]`);
  if (row === null) {
    throw new Error(`找不到字段行 ${path}（渲染缺失）`);
  }
  const input = row.querySelector('input');
  if (input === null) {
    throw new Error(`字段行 ${path} 无 input 控件`);
  }
  return input;
}

function typeValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('渲染 → 改值 → 导出（端到端）', () => {
  it('enemies 表单渲染 8 条，改首个敌人 hp 后导出包校验通过且值生效', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies', [0]);

    // 条目卡数量与真包一致，首卡展开。
    expect(document.querySelectorAll('.entry-card')).toHaveLength(8);
    expect(document.querySelector('[data-path="/enemies/0/hp"]')).not.toBeNull();

    const hpInput = fieldInput('/enemies/0/hp');
    const before = ((store.state.pack['enemies'] as { hp: number }[])[0])!.hp;
    expect(hpInput.value).toBe(String(before));

    typeValue(hpInput, '777');
    expect(((store.state.pack['enemies'] as { hp: number }[])[0])!.hp).toBe(777);
    expect(store.state.dirty).toBe(true);

    // 导出 → 整包校验 → 值生效。
    const exported = JSON.parse(new TextDecoder().decode(exportJsonBytes(store.state.pack)));
    const check = validateContentPack(exported);
    expect(check.ok ? '' : JSON.stringify(check.errors, null, 1)).toBe('');
    expect(((exported['enemies'] as { hp: number }[])[0])!.hp).toBe(777);
  });

  it('items 条目渲染 oneOf 分支选择器（五形态）', () => {
    const store = xiuxianStore();
    renderWith(store, 'items', [0]);
    const branchSelect = document.querySelector<HTMLSelectElement>('.branch-select');
    expect(branchSelect).not.toBeNull();
    expect(branchSelect!.options).toHaveLength(5);
  });

  it('combatText 对象节直接展开，moves 字典行可增删', () => {
    const store = xiuxianStore();
    renderWith(store, 'combatText');
    // moves 字典的既有键渲染为 dict 行。
    expect(document.querySelectorAll('.dict-row').length).toBeGreaterThan(3);
  });

  it('新增条目：骨架入列且整包仍合法', () => {
    const store = xiuxianStore();
    renderWith(store, 'enemies');
    const before = (store.state.pack['enemies'] as unknown[]).length;
    const addBtn = document.querySelector<HTMLButtonElement>('.btn-add')!;
    addBtn.click();
    const enemies = store.state.pack['enemies'] as { id: string }[];
    expect(enemies).toHaveLength(before + 1);
    expect(enemies[enemies.length - 1]!.id).toBe('placeholder');
    const check = validateContentPack(store.state.pack);
    // 真断言（原式 `check.ok || (!ok && errors>0)` 恒真，骨架合法性实际无人
    // 验证；#49 D5 / #74-5 语义白名单）：占位骨架必须过结构关卡——整包
    // 校验只允许新条目自身的语义提示（xref：占位 id 未注册 moves / 占位
    // kind 未入动词池，作者续填放行），required 缺字段 / pattern 不中 /
    // 未知键等任何结构错误都算骨架非法。
    const allowed = (error: ContentError): boolean =>
      error.keyword === 'xref' && error.path.startsWith(`/enemies/${before}`);
    expect(check.ok ? [] : check.errors.filter((error) => !allowed(error))).toEqual([]);
  });
});
