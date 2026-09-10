/**
 * 内容编辑器装配（#11）：三栏布局——左节导航（计数+错误徽标）、
 * 中表单编辑区、右校验+LLM 面板。数据面全部走 core/llm/io 模块。
 */

import './style.css';
import { sectionSchemas } from '@wendao/content';
import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import { SECTION_LABELS } from './core/labels.js';
import { createStore } from './core/state.js';
import { exportJsonDownload, exportZipDownload, readPackFile } from './io/files.js';
import { exportToGame } from './io/gameBridge.js';
import { createValidatePanel } from './ui/panel.js';
import { createLlmPanel } from './ui/llmPanel.js';
import { renderSection, type SectionRenderOpts } from './ui/render.js';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <header class="topbar">
      <h1 class="brand">问道 · 内容编辑器</h1>
      <label class="version-field">包版本 <input id="pack-version" class="input input-inline" type="text" placeholder="1.0.0" /></label>
      <span id="dirty-badge" class="dirty-badge" hidden>未导出改动</span>
      <span class="spacer"></span>
      <button id="btn-sample" class="btn" type="button">载入示例包</button>
      <button id="btn-import" class="btn" type="button">导入 json/zip</button>
      <input id="file-input" type="file" accept=".json,.zip" hidden />
      <button id="btn-export-json" class="btn" type="button">导出 JSON</button>
      <button id="btn-export-zip" class="btn" type="button">导出 zip</button>
      <button id="btn-to-game" class="btn btn-primary" type="button">一键导入游戏</button>
    </header>
    <div class="layout">
      <nav id="section-nav" class="section-nav" aria-label="内容节"></nav>
      <main id="form-area" class="form-area"></main>
      <aside class="side">
        <section id="validate-panel" class="panel"></section>
        <section id="llm-panel" class="panel"></section>
      </aside>
    </div>
    <div id="toast" class="toast" hidden></div>
  `;

  const store = createStore();
  const expanded = new Set<number>();

  const nav = document.querySelector<HTMLElement>('#section-nav')!;
  const formArea = document.querySelector<HTMLElement>('#form-area')!;
  const versionInput = document.querySelector<HTMLInputElement>('#pack-version')!;
  const dirtyBadge = document.querySelector<HTMLElement>('#dirty-badge')!;
  const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
  const toast = document.querySelector<HTMLElement>('#toast')!;

  const sectionOpts: SectionRenderOpts = {
    expanded,
    onData: () => scheduleValidate(),
    onStructure: () => scheduleValidate(),
  };

  /* —— 校验面板（错误点击 → goto 定位） —— */
  const validatePanel = createValidatePanel(document.querySelector('#validate-panel')!, store, {
    onGoto: (path) => gotoError(path),
  });
  const llmPanel = createLlmPanel(document.querySelector('#llm-panel')!, store, {
    onApplied: () => scheduleValidate(),
  });

  /* —— 节导航 —— */
  function repaintNav(): void {
    const errors = validatePanel.errorsBySection();
    nav.replaceChildren();
    for (const section of Object.keys(sectionSchemas)) {
      const value = store.state.pack[section];
      const count = Array.isArray(value)
        ? value.length
        : typeof value === 'object' && value !== null
          ? Object.keys(value as object).length
          : 0;
      const errorCount = errors.get(section)?.length ?? 0;
      const item = document.createElement('button');
      item.type = 'button';
      item.className =
        'nav-item' +
        (store.state.section === section ? ' active' : '') +
        (errorCount > 0 ? ' has-errors' : '');
      item.innerHTML =
        `<span class="nav-label">${SECTION_LABELS[section] ?? section}</span>` +
        `<span class="nav-badges">${count > 0 ? `<i class="nav-count">${count}</i>` : ''}${errorCount > 0 ? `<i class="nav-errors">${errorCount}</i>` : ''}</span>`;
      item.addEventListener('click', () => {
        expanded.clear();
        store.setSection(section);
        repaintNav();
        repaintForm();
      });
      nav.append(item);
    }
  }

  /* —— 编辑区 —— */
  function repaintForm(): void {
    versionInput.value = typeof store.state.pack['version'] === 'string' ? (store.state.pack['version'] as string) : '';
    dirtyBadge.hidden = !store.state.dirty;
    if (store.state.section === null) {
      formArea.replaceChildren();
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = store.hasPack()
        ? '← 从左侧选择内容节开始编辑。'
        : '导入 .json / .zip 内容包，或点「载入示例包」体验。';
      formArea.append(hint);
      return;
    }
    renderSection(formArea, store, store.state.section, sectionOpts);
  }

  /* —— 错误定位 —— */
  function gotoError(path: string): void {
    if (!store.hasPack()) return;
    const segments = path.split('/').filter((segment) => segment !== '');
    const section = segments[0];
    if (section === undefined || !(section in sectionSchemas)) {
      return;
    }
    if (store.state.section !== section) {
      expanded.clear();
      store.setSection(section);
    }
    const entryIndex = Number.parseInt(segments[1] ?? '', 10);
    if (!Number.isNaN(entryIndex)) {
      expanded.add(entryIndex);
    }
    repaintForm();
    // 渲染后定位：节标题或字段行。
    const target =
      document.querySelector<HTMLElement>(`[data-path="${cssEscape(path)}"]`) ??
      document.querySelector<HTMLElement>('.section-title');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.classList.add('flash');
    window.setTimeout(() => target?.classList.remove('flash'), 1200);
  }

  function cssEscape(value: string): string {
    return value.replace(/"/g, '\\"');
  }

  /* —— 校验调度（输入 debounce，结构性变更立即） —— */
  let validateTimer = 0;
  function refreshAll(): void {
    validatePanel.refresh();
    repaintNav();
    dirtyBadge.hidden = !store.state.dirty;
  }
  function scheduleValidate(immediate = false): void {
    window.clearTimeout(validateTimer);
    validateTimer = window.setTimeout(refreshAll, immediate ? 0 : 400);
  }

  store.subscribe((_state, event) => {
    if (event === 'pack') {
      expanded.clear();
      // 加载后默认落第一个节。
      store.setSection(Object.keys(sectionSchemas)[0] ?? null);
      refreshAll();
      repaintForm();
      showToast('内容包已加载并通过校验');
      return;
    }
    // data 事件由 scheduleValidate 驱动；这里同步标题/徽标轻量面。
    dirtyBadge.hidden = !store.state.dirty;
  });

  store.setSection(Object.keys(sectionSchemas)[0] ?? null);
  refreshAll();
  repaintForm();

  /* —— 顶栏动作 —— */
  document.querySelector('#btn-sample')?.addEventListener('click', () => {
    const result = store.loadPack(JSON.parse(JSON.stringify(xiuxianPackJson)));
    showToast(result.ok ? '示例包（修仙）已载入' : `示例包校验失败：${result.errors.length} 错`);
    refreshAll();
    repaintForm();
  });

  document.querySelector('#btn-import')?.addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file === undefined) return;
    await importFile(file);
  });

  async function importFile(file: File): Promise<void> {
    try {
      const info = await readPackFile(file);
      const result = store.loadPack(info.json);
      if (result.ok) {
        refreshAll();
        repaintForm();
        showToast(`已导入 ${info.sourceName}（校验通过）`);
      } else {
        // 坏包不应用（验收 3）：字段级错误以拒绝块呈现在校验面板；
        // 不跑 refreshAll，避免面板重绘抹掉拒绝块。
        showRejectedErrors(result.errors);
        repaintForm();
        showToast(`导入被拒：${info.sourceName} 有 ${result.errors.length} 处错误（详见校验面板）`);
      }
    } catch (cause) {
      showToast(`导入失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /** 坏包字段级错误（验收 3）：包不被应用，错误可见可定位检查。 */
  function showRejectedErrors(errors: readonly { path: string; keyword: string; message: string }[]): void {
    const list = document.querySelector('.validate-list');
    if (list === null) return;
    const banner = document.createElement('div');
    banner.className = 'validate-group rejected';
    const head = document.createElement('div');
    head.className = 'validate-group-head';
    head.textContent = `被拒导入的包（${errors.length} 处错误，未应用）`;
    banner.append(head);
    for (const error of errors.slice(0, 50)) {
      const item = document.createElement('div');
      item.className = 'validate-item static';
      item.innerHTML = `<span class="validate-path">${error.path || '/'}</span><span class="validate-msg">[${error.keyword}] ${error.message}</span>`;
      banner.append(item);
    }
    list.prepend(banner);
  }

  document.querySelector('#btn-export-json')?.addEventListener('click', () => {
    if (!requirePack()) return;
    showToast(`已导出 ${exportJsonDownload(store)}`);
  });
  document.querySelector('#btn-export-zip')?.addEventListener('click', () => {
    if (!requirePack()) return;
    showToast(`已导出 ${exportZipDownload(store)}`);
  });
  document.querySelector('#btn-to-game')?.addEventListener('click', () => {
    if (!requirePack()) return;
    void exportToGame(store).then((result) => {
      if (!result.ok) {
        showToast(`✗ 写入失败：${result.error}`);
        return;
      }
      showToast(result.via === 'desktop' ? `已写入游戏 content 目录：${result.fileName}` : `桌面桥未接入，已下载包：${result.fileName}`);
    });
  });

  function requirePack(): boolean {
    if (!store.hasPack()) {
      showToast('请先加载内容包');
      return false;
    }
    return true;
  }

  versionInput.addEventListener('change', () => {
    if (!store.hasPack()) return;
    store.update((pack) => {
      pack['version'] = versionInput.value.trim();
    });
    scheduleValidate(true);
  });

  let toastTimer = 0;
  function showToast(message: string): void {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  }
}
