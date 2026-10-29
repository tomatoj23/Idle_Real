/**
 * 设置页（#62 P1-1 旧版保真回迁）：存档管理（手动保存/散功重修两段式确认）+
 * 携档云游（导出密文/导入读档）+ 玩法说明。
 *
 * 存档字节面（导出编码/导入门禁/槽位写入/受控重载）全在 ShellSaveService
 * （main.ts 装配）——引擎零平台依赖，本页只渲染与转发。散功重修走引擎
 * game:reset 动作（整态重置），两段式 arm 住本页、换页即撤防（rebirth 同律）。
 * 服务未装配（测试/轻量装配面）= 只渲染玩法说明。
 */
import { esc } from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createSettingsPage(env: PageEnv): PageView {
  /** 散功重修两段式确认（#6 rebirth 同款 arm 形）。 */
  let resetArmed = false;
  /** 导入密文草稿（跨重绘保留：render 先回读现存 textarea，防活动心跳换血吞字）。 */
  let importDraft = '';
  /** 导入失败内联报错（toast 面留给要紧事，格式错就在框边说清）。 */
  let importBad = false;

  const render = (ctx: PageCtx): string => {
    const { T } = ctx;
    // 草稿回读：现存 DOM 里有未落草稿的输入（重绘打断打字）以现值为准。
    const live = env.pageEl.querySelector<HTMLTextAreaElement>('#imp-box');
    if (live) importDraft = live.value;
    const guide = T('pages.settings.guide')
      .split('\n')
      .map((line) => esc(line))
      .join('<br>');
    const saveOps = resetArmed
      ? `<p class="page-sub settings-tip">${esc(T('pages.settings.resetConfirmTip'))}</p>
         <div class="card-actions">
           <button class="btn btn-danger" data-act="reset-confirm">${esc(T('pages.settings.resetConfirmBtn'))}</button>
           <button class="btn btn-ghost" data-act="reset-cancel">${esc(T('pages.settings.resetCancelBtn'))}</button>
         </div>`
      : `<div class="card-actions">
           <button class="btn" data-act="save-now">${esc(T('pages.settings.saveNowBtn'))}</button>
           <button class="btn btn-danger" data-act="reset-go">${esc(T('pages.settings.resetBtn'))}</button>
         </div>`;
    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.settings.title'))}</h2>
        <p class="page-sub">${esc(T('pages.settings.subtitle'))}</p>
        ${
          env.saveService === undefined
            ? ''
            : `<section class="status-card settings-card">
                 <h3 class="group-title">${esc(T('pages.settings.saveTitle'))}</h3>
                 <p class="page-sub">${esc(T('pages.settings.saveHint'))}</p>
                 ${saveOps}
               </section>
               <section class="status-card settings-card">
                 <h3 class="group-title">${esc(T('pages.settings.transferTitle'))}</h3>
                 <p class="page-sub">${esc(T('pages.settings.transferHint'))}</p>
                 <p class="settings-label">${esc(T('pages.settings.exportLabel'))}</p>
                 <textarea id="exp-box" readonly rows="3">${esc(env.saveService.exportText())}</textarea>
                 <div class="card-actions">
                   <button class="btn btn-ghost" data-act="copy-save">${esc(T('pages.settings.copyBtn'))}</button>
                 </div>
                 <p class="settings-label">${esc(T('pages.settings.importLabel'))}</p>
                 <textarea id="imp-box" rows="3">${esc(importDraft)}</textarea>
                 ${importBad ? `<p class="act-lockmsg">${esc(T('pages.settings.importBad'))}</p>` : ''}
                 <div class="card-actions">
                   <button class="btn" data-act="import-save">${esc(T('pages.settings.importBtn'))}</button>
                 </div>
               </section>`
        }
        <section class="status-card settings-card">
          <h3 class="group-title">${esc(T('pages.settings.guideTitle'))}</h3>
          <p class="page-sub settings-guide">${guide}</p>
        </section>
      </section>`;
  };

  return {
    id: 'settings',
    label: 'tabs.settings',
    render,
    deactivate() {
      resetArmed = false;
      importBad = false;
    },
    handleAction(action, target) {
      switch (action) {
        case 'save-now':
          env.saveService?.saveNow();
          env.toast?.(env.T('pages.settings.savedToast'));
          return;
        case 'reset-go':
          resetArmed = true;
          env.render();
          return;
        case 'reset-cancel':
          resetArmed = false;
          env.render();
          return;
        case 'reset-confirm':
          resetArmed = false;
          env.dispatch({ type: 'game:reset' });
          return;
        case 'copy-save': {
          const box = env.pageEl.querySelector<HTMLTextAreaElement>('#exp-box');
          const text = box?.value ?? env.saveService?.exportText() ?? '';
          // 复制成败如实呈现（#62 评审收口）：clipboard 与 execCommand 双败
          // = 不弹「已复制」（头注承诺的全败静默），成功才 toast。
          void copyText(env.pageEl, text).then((ok) => {
            if (ok) env.toast?.(env.T('pages.settings.copiedToast'));
          });
          return;
        }
        case 'import-save': {
          const box = env.pageEl.querySelector<HTMLTextAreaElement>('#imp-box');
          importDraft = box?.value ?? importDraft;
          importBad = !(env.saveService?.importText(importDraft) ?? false);
          env.render();
          return;
        }
      }
    },
  };
}

/** 密文复制：clipboard API 优先，execCommand 兜底；返回是否确已复制（全败 false，不误报）。 */
async function copyText(scope: ParentNode, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = scope.querySelector<HTMLTextAreaElement>('#exp-box');
    if (box) {
      box.select();
      return document.execCommand('copy');
    }
    return false;
  }
}
