/**
 * 乾坤袋（#46 页面注册表）：材料/丹药行组 + 装备实例卡（佩戴/卸下/卖出/熔炼/重铸）。
 *
 * 装备倍率投影走引擎 projectGearBase（#26 三处复算债收敛）；铭纹行数值直读
 * 内容三阶表；展示名走引擎 gearName。纯展示页，无实况刷新（无 update）。
 */
import { findInscription, gearName, projectGearBase } from '@wendao/engine';
import type { GearInstance } from '@wendao/engine';
import { esc } from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createBagPage(env: PageEnv): PageView {
  const render = (ctx: PageCtx): string => {
    const { st, content, T } = ctx;
    const owned = content.items.filter((item) => (st.items[item.id] ?? 0) > 0);
    const groups: Array<{ title: string; types: readonly string[] }> = [
      { title: T('pages.bag.matGroup'), types: ['mat'] },
      { title: T('pages.bag.consumableGroup'), types: ['consumable'] },
    ];
    const body = groups
      .map(({ title, types }) => {
        const rows = owned
          .filter((item) => types.includes(item.type))
          .map((item) => {
            const count = st.items[item.id] ?? 0;
            return `<div class="bag-row">
              <span class="sigil sigil-sm">${esc(item.icon)}</span>
              <span class="bag-name">${esc(item.name)}<small>${esc(item.description ?? '')}</small></span>
              <b class="bag-count">×${count}</b>
              <span class="bag-price">${esc(T('pages.bag.priceEach', { price: item.sell }))}</span>
              <span class="bag-ops">
                <button class="btn" data-act="sell" data-item="${item.id}" data-count="1">${esc(T('pages.bag.sellOneBtn'))}</button>
                <button class="btn btn-ghost" data-act="sell" data-item="${item.id}" data-count="${count}">${esc(T('pages.bag.sellAllBtn'))}</button>
              </span>
            </div>`;
          })
          .join('');
        return rows ? `<h3 class="group-title">${esc(title)}</h3>${rows}` : '';
      })
      .join('');
    const worn = Object.values(st.equips)
      .map((uid) => st.gear.find((entry) => entry.uid === uid))
      .filter((gear): gear is NonNullable<typeof gear> => gear !== undefined)
      .map((gear) => gearCardHtml(ctx, gear))
      .join('');
    const loose = st.gear
      .filter((gear) => !Object.values(st.equips).includes(gear.uid))
      .map((gear) => gearCardHtml(ctx, gear))
      .join('');
    const gearSection =
      worn || loose
        ? `<h3 class="group-title">${esc(T('pages.bag.gearWorn'))}</h3>${worn || `<p class="empty">${esc(T('pages.bag.emptyWorn'))}</p>`}
           <h3 class="group-title">${esc(T('pages.bag.gearLoose'))}</h3>${loose || `<p class="empty">${esc(T('pages.bag.emptyLoose'))}</p>`}`
        : '';
    return `<section class="page"><h2 class="page-title">${esc(T('pages.bag.title'))}</h2>${body}${gearSection || `<p class="empty">${esc(T('pages.bag.emptyAll'))}</p>`}</section>`;
  };

  /** 装备实例卡：着色类 = `r-${档位 id}`（def 驱动）；倍率投影/展示名走引擎。 */
  const gearCardHtml = (ctx: PageCtx, gear: GearInstance): string => {
    const { st, content, T } = ctx;
    const item = env.itemById.get(gear.itemId);
    const worn = Object.entries(st.equips).find(([, uid]) => uid === gear.uid);
    // 倍率投影走引擎 projectGearBase（#26 三处复算债收敛）：round(基础 × 档位倍率)
    // 与实例化/属性聚合同式同源，UI 零 ×mult 公式；标签/量纲查 statLabels。
    const baseRows = projectGearBase(content, item?.bonuses ?? {}, gear.rarity)
      .map(({ stat, value }) => esc(env.statBonusText(stat, value)));
    const affixRows = gear.affixes.map(
      (a) => `<span class="txt-dim">${esc(a.name)}</span> ${esc(env.statBonusText(a.stat, a.val))}`,
    );
    // 铭纹行（#14）：纹阶徽标着色（t1 起，深阶复用末档色）+ 纹阶表数值直读
    //（内容数据，壳零公式；显示钳制随该铭纹 tiers 表长，#61 边界收口）
    // + 行内重铸入口（器屑经济可用才渲染；佩戴中引擎拒绝，按钮同禁）。
    const inscRows = (gear.inscriptions ?? [])
      .map((insc, index) => {
        const def = findInscription(content, insc.id);
        if (!def) return ''; // 内容已移除：防御跳过（引擎贡献侧同律静默）
        const inscTier = Math.max(1, Math.min(def.tiers.length, Math.floor(insc.tier)));
        const toneTier = Math.min(inscTier, 3); // 深阶（T4+）复用 t3 色：样式表只备 t1~t3
        const parts = (def.tiers[inscTier - 1] ?? []).map((mod) => {
          const cond =
            mod.condition?.element !== undefined
              ? esc(T('pages.bag.inscCondition', { element: env.elementNameOf(mod.condition.element) }))
              : '';
          return `${esc(env.inscModText(mod))}${cond}`;
        });
        const reforgeBtn =
          env.canSmelt && !worn
            ? ` <button class="btn btn-mini" data-act="reforge" data-uid="${gear.uid}" data-index="${index}">${esc(T('pages.bag.reforgeBtn'))}</button>`
            : '';
        return `<span class="insc insc-t${toneTier}"><b class="insc-tier">${esc(T('pages.bag.inscTier', { tier: inscTier }))}</b>${esc(def.name)}</span> ${parts.join(esc(T('common.itemListSep')))}${reforgeBtn}`;
      })
      .filter((row) => row !== '');
    const rows =
      [...baseRows, ...affixRows, ...inscRows].join(esc(T('common.itemListSep'))) ||
      esc(T('pages.bag.noAffix'));
    // 展示名走引擎 gearName（#26：「档名·物品名」拼接单一来源；缺档名省略前缀）。
    const displayName = gearName(content, item?.name ?? gear.itemId, gear.rarity);
    return `<div class="gear-card ${env.rarityClass(gear.rarity)}">
      <span class="sigil sigil-sm">${esc(item?.icon ?? T('icons.gear'))}</span>
      <span class="gear-name">${esc(displayName)}<small>${rows}</small></span>
      <span class="bag-ops">
        ${worn
          ? `<button class="btn btn-ghost" data-act="take-off" data-slot="${worn[0]}">${esc(T('pages.bag.takeOffBtn'))}</button>`
          : `<button class="btn" data-act="wear" data-uid="${gear.uid}">${esc(T('pages.bag.wearBtn'))}</button>`}
        ${worn ? '' : `<button class="btn btn-ghost" data-act="sell-gear" data-uid="${gear.uid}">${esc(T('pages.bag.sellBtn'))}</button>`}
        ${worn ? '' : (env.canSmelt ? `<button class="btn btn-ghost" data-act="smelt-gear" data-uid="${gear.uid}">${esc(T('pages.bag.smeltBtn'))}</button>` : '')}
      </span>
    </div>`;
  };

  return {
    id: 'bag',
    label: 'tabs.bag',
    render,
    handleAction(action, target) {
      switch (action) {
        case 'sell':
          env.dispatch({
            type: 'bag:sell',
            payload: { item: target.dataset.item, count: Number(target.dataset.count) },
          });
          return;
        case 'wear':
          env.dispatch({ type: 'gear:equip', payload: { uid: Number(target.dataset.uid) } });
          return;
        case 'take-off':
          env.dispatch({ type: 'gear:unequip', payload: { slot: target.dataset.slot } });
          return;
        case 'sell-gear':
          env.dispatch({ type: 'gear:sell', payload: { uid: Number(target.dataset.uid) } });
          return;
        case 'smelt-gear':
          env.dispatch({ type: 'gear:smelt', payload: { uid: Number(target.dataset.uid) } });
          return;
        case 'reforge':
          env.dispatch({
            type: 'gear:reforge',
            payload: { uid: Number(target.dataset.uid), index: Number(target.dataset.index) },
          });
          return;
      }
    },
  };
}
