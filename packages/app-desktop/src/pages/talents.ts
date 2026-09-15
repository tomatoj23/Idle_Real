/**
 * 天赋树页（#6，#46 页面注册表）：树数据 100% 来自 rebirth.talents。
 * 购买门控走引擎 talentGateOf（与 talent:buy 判定同式同源，N4 收敛）。
 */
import { talentGateOf } from '@wendao/engine';
import { esc } from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createTalentsPage(env: PageEnv): PageView {
  const render = (ctx: PageCtx): string => {
    const { st, content, T } = ctx;
    const talents = env.rebirthSection?.talents ?? [];
    if (talents.length === 0) {
      return `<section class="page"><p class="empty">${esc(T('pages.talents.empty'))}</p></section>`;
    }
    const cards = talents
      .map((node) => {
        // 购买门控走引擎 talentGateOf（与 talent:buy 判定同式同源，N4 收敛）。
        const gate = talentGateOf(content, st.daoYun, st.talents, node.id);
        let op: string;
        if (gate.owned) op = `<em class="act-badge">${esc(T('pages.talents.owned'))}</em>`;
        else if (gate.prereqMissing) op = `<span class="act-lockmsg">${esc(T('pages.talents.needPrereq'))}</span>`;
        else if (!gate.affordable)
          op = `<span class="act-lockmsg">${esc(T('pages.talents.needDaoYun', { cost: node.cost }))}</span>`;
        else
          op = `<button class="btn" data-act="talent-buy" data-node="${node.id}">${esc(T('pages.talents.buyBtn'))}</button>`;
        return `<article class="act-card talent-card${gate.owned ? ' owned' : ''}${!gate.owned && (gate.prereqMissing || !gate.affordable) ? ' locked' : ''}">
          <header><b><span class="sigil sigil-sm">${esc(node.icon ?? T('icons.unknown'))}</span> ${esc(node.name)}</b></header>
          ${node.description ? `<div class="talent-desc">${esc(node.description)}</div>` : ''}
          <div class="act-meta">${esc(T('pages.talents.costRow', { cost: node.cost }))}</div>
          ${op}
        </article>`;
      })
      .join('');
    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.talents.title'))}</h2>
        <p class="page-sub">${esc(T('pages.talents.subtitle', { daoYun: st.daoYun }))}</p>
        <div class="act-grid">${cards}</div>
      </section>`;
  };

  return {
    id: 'talents',
    label: 'tabs.talents',
    render,
    handleAction(action, target) {
      if (action === 'talent-buy') {
        env.dispatch({ type: 'talent:buy', payload: { nodeId: target.dataset.node } });
      }
    },
  };
}
