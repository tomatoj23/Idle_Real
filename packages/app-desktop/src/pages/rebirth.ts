/**
 * 转生页（#6，#46 页面注册表）：兵解预览 + 两段式确认。
 * 预览结算走引擎 rebirthPreviewOf（与 rebirth:perform 判定同源，壳零公式）。
 * 两段式 arm 状态住本页；换页即撤防（#6 不跨页存续）经 deactivate 钩子保持。
 */
import { rebirthPreviewOf } from '@wendao/engine';
import { esc } from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createRebirthPage(env: PageEnv): PageView {
  /** 兵解两段式确认：先 arm 展示后果预览，再 confirm 发动作（#6）。 */
  let rebirthArmed = false;

  const render = (ctx: PageCtx): string => {
    const { st, content, T } = ctx;
    const rebirthSection = env.rebirthSection;
    if (!rebirthSection) {
      return `<section class="page"><p class="empty">${esc(T('pages.rebirth.empty'))}</p></section>`;
    }
    // 预览结算走引擎 rebirthPreviewOf（与 rebirth:perform 判定同源，壳零公式）。
    const preview = rebirthPreviewOf(content, st.skills);
    const resetChips = (rebirthSection.reset ?? [])
      .map((key) => T(`pages.rebirth.resetLabels.${key}`))
      .join(T('common.itemListSep'));
    const keepChips = (rebirthSection.keep ?? [])
      .map((key) => T(`pages.rebirth.keepLabels.${key}`))
      .join(T('common.itemListSep'));
    const gate = preview.eligible
      ? ''
      : `<p class="act-lockmsg">${esc(T('pages.rebirth.gateLine', { need: preview.minProgress }))}</p>`;
    const ops = !preview.eligible
      ? ''
      : rebirthArmed
        ? `<p class="page-sub rebirth-tip">${esc(T('pages.rebirth.confirmTip'))}</p>
           <button class="btn btn-danger" data-act="rebirth-confirm">${esc(T('pages.rebirth.confirmBtn'))}</button>
           <button class="btn btn-ghost" data-act="rebirth-cancel">${esc(T('pages.rebirth.cancelBtn'))}</button>`
        : `<button class="btn btn-danger" data-act="rebirth-go">${esc(T('pages.rebirth.performBtn'))}</button>`;
    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.rebirth.title'))}</h2>
        <p class="page-sub">${esc(T('pages.rebirth.subtitle', { rebirths: st.rebirths }))}</p>
        <section class="status-card rebirth-card">
          <div class="status-main">
            <div class="status-head"><b>${esc(T('pages.rebirth.xpLine', { xp: preview.totalXp }))}</b></div>
            <div class="status-head rebirth-gain"><b>${esc(T('pages.rebirth.gainLine', { daoYun: preview.gain }))}</b></div>
          </div>
          ${gate}
        </section>
        <div class="rebirth-lists">
          <div class="rebirth-list"><h3 class="group-title">${esc(T('pages.rebirth.resetTitle'))}</h3><p>${esc(resetChips)}</p></div>
          <div class="rebirth-list"><h3 class="group-title">${esc(T('pages.rebirth.keepTitle'))}</h3><p>${esc(keepChips)}</p></div>
        </div>
        <div class="rebirth-ops">${ops}</div>
      </section>`;
  };

  return {
    id: 'rebirth',
    label: 'tabs.rebirth',
    render,
    // 换页即撤防（#6）：兵解确认不跨页存续（壳核换页统一调 deactivate）。
    deactivate() {
      rebirthArmed = false;
    },
    handleAction(action) {
      switch (action) {
        case 'rebirth-go':
          rebirthArmed = true;
          env.render();
          return;
        case 'rebirth-cancel':
          rebirthArmed = false;
          env.render();
          return;
        case 'rebirth-confirm':
          rebirthArmed = false;
          env.dispatch({ type: 'rebirth:perform' });
          return;
      }
    },
  };
}
