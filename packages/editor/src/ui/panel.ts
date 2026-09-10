/**
 * 校验面板（#11）：复用 content 包 validateContentPack（同一份代码），
 * 错误按节分组展示、点击定位到表单字段（data-path 同构）。
 */

import { validateContentPack, type ContentError } from '@wendao/content';
import { SECTION_LABELS } from '../core/labels.js';
import type { EditorStore } from '../core/state.js';

export interface ValidatePanel {
  /** 重跑整包校验并重绘（数据变更 / 换包后调用）。 */
  refresh(): void;
  /** 最近一次校验的错误按节分组（nav 徽标复用）。 */
  errorsBySection(): ReadonlyMap<string, readonly ContentError[]>;
}

/** 错误按首段节名分组（面板分组与 nav 徽标共用一份分法）。 */
export function groupErrorsBySection(
  errors: readonly ContentError[],
): Map<string, ContentError[]> {
  const bySection = new Map<string, ContentError[]>();
  for (const error of errors) {
    const section = error.path.split('/')[1] ?? '(包)';
    const bucket = bySection.get(section) ?? [];
    bucket.push(error);
    bySection.set(section, bucket);
  }
  return bySection;
}

export function createValidatePanel(
  root: HTMLElement,
  store: EditorStore,
  opts: { readonly onGoto: (path: string) => void },
): ValidatePanel {
  let lastErrors: readonly ContentError[] = [];

  const status = document.createElement('div');
  status.className = 'validate-status';
  const list = document.createElement('div');
  list.className = 'validate-list';
  root.append(status, list);

  const panel: ValidatePanel = {
    refresh() {
      if (!store.hasPack()) {
        status.className = 'validate-status';
        status.textContent = '未加载内容包';
        list.replaceChildren();
        lastErrors = [];
        return;
      }
      const result = validateContentPack(store.state.pack);
      if (result.ok) {
        lastErrors = [];
        status.className = 'validate-status valid';
        status.textContent = '✓ 内容包合法';
        list.replaceChildren();
        return;
      }
      lastErrors = result.errors;
      status.className = 'validate-status invalid';
      status.textContent = `✗ ${result.errors.length} 处校验错误`;
      list.replaceChildren(...errorGroups(result.errors, opts.onGoto));
    },
    errorsBySection() {
      return groupErrorsBySection(lastErrors);
    },
  };
  panel.refresh();
  return panel;
}

function errorGroups(
  errors: readonly ContentError[],
  onGoto: (path: string) => void,
): HTMLElement[] {
  const groups: HTMLElement[] = [];
  for (const [section, sectionErrors] of groupErrorsBySection(errors)) {
    const block = document.createElement('div');
    block.className = 'validate-group';
    const head = document.createElement('div');
    head.className = 'validate-group-head';
    head.textContent = `${SECTION_LABELS[section] ?? section}（${sectionErrors.length}）`;
    block.append(head);
    for (const error of sectionErrors) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'validate-item';
      item.innerHTML = `<span class="validate-path">${escapeHtml(error.path || '/')}</span><span class="validate-msg">${escapeHtml(`[${error.keyword}] ${error.message}`)}</span>`;
      item.title = '点击定位到字段';
      item.addEventListener('click', () => onGoto(error.path));
      block.append(item);
    }
    groups.push(block);
  }
  return groups;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
