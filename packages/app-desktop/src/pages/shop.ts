/**
 * 坊市页（#46 页面注册表）：商品行 + 购买入口。
 * 购买力走引擎 shopAffordOf（#26 三处复算债收敛）：与 shop:buy 判定同式同源。
 */
import { shopAffordOf } from '@wendao/engine';
import { esc } from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createShopPage(env: PageEnv): PageView {
  const render = (ctx: PageCtx): string => {
    const { st, content, T } = ctx;
    const rows = content.shop
      .map((entry) => {
        const item = env.itemById.get(entry.item);
        const owned = st.items[entry.item] ?? 0;
        // 购买力走引擎 shopAffordOf（#26 三处复算债收敛）：与 shop:buy 判定同式同源。
        const afford = shopAffordOf(content, st.gold, entry.item);
        return `<div class="bag-row">
          <span class="sigil sigil-sm">${esc(item?.icon ?? T('icons.unknown'))}</span>
          <span class="bag-name">${esc(item?.name ?? entry.item)}<small>${esc(item?.description ?? '')}</small></span>
          <b class="bag-price">${esc(T('pages.shop.price', { price: entry.price }))}</b>
          <span class="bag-count">${esc(T('pages.shop.owned', { count: owned }))}</span>
          <span class="bag-ops"><button class="btn${afford ? '' : ' btn-disabled'}" data-act="buy" data-item="${entry.item}">${esc(T('pages.shop.buyBtn'))}</button></span>
        </div>`;
      })
      .join('');
    return `<section class="page"><h2 class="page-title">${esc(T('pages.shop.title'))}</h2><p class="page-sub">${esc(T('pages.shop.subtitle'))}</p>${rows}</section>`;
  };

  return {
    id: 'shop',
    label: 'tabs.shop',
    render,
    handleAction(action, target) {
      if (action === 'buy') {
        env.dispatch({ type: 'shop:buy', payload: { item: target.dataset.item } });
      }
    },
  };
}
