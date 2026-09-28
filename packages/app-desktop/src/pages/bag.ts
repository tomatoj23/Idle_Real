/**
 * 乾坤袋（#46 页面注册表）：材料/丹药行组 + 装备实例卡（佩戴/卸下/卖出/熔炼/重铸/锁定）
 * + 一键清存量工具条（#37）。
 *
 * 装备倍率投影走引擎 projectGearBase（#26 三处复算债收敛）；铭纹行数值直读
 * 内容三阶表；展示名走引擎 gearName。堆叠 = **视图分组非数据堆叠**（#37）：
 * 散件按引擎 gearStackKeyOf 完全同质合并一行 ×N（任一差异含纹阶/锁定态即分开），
 * 实例 uid 模型、佩戴、重铸不动——同质实例挑哪件等价（佩戴/重铸走堆内首件）。
 * 批量处置判定走引擎 planGearBatch（按钮计数/禁用态与动作面单一来源）。
 * 纯展示页，无实况刷新（无 update）。
 */
import {
  findInscription,
  gearName,
  gearStackKeyOf,
  planGearBatch,
  projectGearBase,
} from '@wendao/engine';
import type { GearInstance } from '@wendao/engine';
import { esc } from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createBagPage(env: PageEnv): PageView {
  /** 一键清存量稀有度阈值（页自持 UI 状态；缺省最低档 = 只清寻常，高品绝不误卖）。 */
  let clearCapId = '';

  /**
   * data-uids 逗号表解析（批量动作载荷）：仅收纯数字段（Number 会认 '1e3'/
   * '0x2' 类进制/指数形——dataset 自产可控但不留歧义），坏段静默剔除，
   * 存在性守卫归引擎。
   */
  const uidsOf = (target: HTMLElement): number[] =>
    (target.dataset.uids ?? '')
      .split(',')
      .filter((seg) => /^\d+$/.test(seg))
      .map(Number)
      .filter((n) => n > 0);

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
      .map((gear) => gearCardHtml(ctx, [gear]))
      .join('');
    // 散件堆叠分组（#37）：按堆叠身份键（模板×稀有度×词条×铭纹×锁定态）合并
    // 同质实例；佩戴件上文已出（豁免面不进堆）。
    const stacks = new Map<string, GearInstance[]>();
    for (const gear of st.gear) {
      if (Object.values(st.equips).includes(gear.uid)) continue;
      const key = gearStackKeyOf(gear);
      const bucket = stacks.get(key);
      if (bucket) bucket.push(gear);
      else stacks.set(key, [gear]);
    }
    const loose = [...stacks.values()].map((stack) => gearCardHtml(ctx, stack)).join('');
    // 一键清存量工具条（#37）：有散件才在场（处置目标存在才有可操作面）；
    // 可处置数经引擎 planGearBatch（与动作面同一判定），零可处置 = 按钮禁用。
    const rarities = content.rarities;
    const cap = rarities.some((r) => r.id === clearCapId) ? clearCapId : (rarities[0]?.id ?? '');
    clearCapId = cap;
    const eligible = planGearBatch(content, st.gear, Object.values(st.equips), {
      maxRarity: cap,
    }).targets.length;
    const capOptions = rarities
      .map(
        (r) =>
          `<option value="${esc(r.id)}"${r.id === cap ? ' selected' : ''}>${esc(T('pages.bag.clearCap', { rarity: r.name }))}</option>`,
      )
      .join('');
    const clearBtn = (act: string, label: string, ghost: boolean): string =>
      `<button class="btn${ghost ? ' btn-ghost' : ''}${eligible === 0 ? ' btn-disabled' : ''}"${eligible === 0 ? ' disabled' : ''} data-act="${act}">${esc(label)}</button>`;
    const toolbar =
      stacks.size > 0
        ? `<div class="bag-clear">
            <select class="clear-cap" data-act="clear-cap">${capOptions}</select>
            ${clearBtn('clear-sell', T('pages.bag.clearSellBtn'), false)}
            ${env.canSmelt ? clearBtn('clear-smelt', T('pages.bag.clearSmeltBtn'), true) : ''}
          </div>`
        : '';
    const gearSection =
      worn || loose
        ? `${toolbar}<h3 class="group-title">${esc(T('pages.bag.gearWorn'))}</h3>${worn || `<p class="empty">${esc(T('pages.bag.emptyWorn'))}</p>`}
           <h3 class="group-title">${esc(T('pages.bag.gearLoose'))}</h3>${loose || `<p class="empty">${esc(T('pages.bag.emptyLoose'))}</p>`}`
        : '';
    return `<section class="page"><h2 class="page-title">${esc(T('pages.bag.title'))}</h2>${body}${gearSection || `<p class="empty">${esc(T('pages.bag.emptyAll'))}</p>`}</section>`;
  };

  /**
   * 装备实例卡：着色类 = `r-${档位 id}`（def 驱动）；倍率投影/展示名走引擎。
   * stack = 同质实例堆（×N 合并展示，#37）：卖出/熔炼/锁定按整堆处置（uids 表），
   * 佩戴/重铸走堆内首件（同质等价）；锁定件卖出/熔炼按钮禁用（D2 防手滑）。
   */
  const gearCardHtml = (ctx: PageCtx, stack: readonly GearInstance[]): string => {
    const { st, content, T } = ctx;
    const gear = stack[0]!;
    const item = env.itemById.get(gear.itemId);
    const worn = Object.entries(st.equips).find(([, uid]) => uid === gear.uid);
    const locked = gear.locked === true;
    const disCls = locked ? ' btn-disabled' : '';
    const disAttr = locked ? ' disabled' : '';
    const uids = stack.map((entry) => entry.uid).join(',');
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
    // 堆叠行重铸走堆内首件（同质实例等价，#37 申报口径）。
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
        // 锁定件重铸同禁（#37 复核收口口径修正：重铸是更不可逆的改写面）。
        const reforgeBtn =
          env.canSmelt && !worn
            ? ` <button class="btn btn-mini${disCls}"${disAttr} data-act="reforge" data-uid="${gear.uid}" data-index="${index}">${esc(T('pages.bag.reforgeBtn'))}</button>`
            : '';
        return `<span class="insc insc-t${toneTier}"><b class="insc-tier">${esc(T('pages.bag.inscTier', { tier: inscTier }))}</b>${esc(def.name)}</span> ${parts.join(esc(T('common.itemListSep')))}${reforgeBtn}`;
      })
      .filter((row) => row !== '');
    const rows =
      [...baseRows, ...affixRows, ...inscRows].join(esc(T('common.itemListSep'))) ||
      esc(T('pages.bag.noAffix'));
    // 展示名走引擎 gearName（#26：「档名·物品名」拼接单一来源；缺档名省略前缀）。
    const displayName = gearName(content, item?.name ?? gear.itemId, gear.rarity);
    const countBadge = stack.length > 1 ? ` <b class="bag-count">×${stack.length}</b>` : '';
    // 锁定件的操作按钮保留可见但禁用（D2「先解锁再操作」）；整堆按钮只在 ≥2 时
    // 换批量动作（单件走既有单件动作，事件/飘字口径不变）。
    const sellAct = stack.length > 1 ? 'sell-stack' : 'sell-gear';
    const smeltAct = stack.length > 1 ? 'smelt-stack' : 'smelt-gear';
    const selAttrs = stack.length > 1 ? `data-uids="${uids}"` : `data-uid="${gear.uid}"`;
    const sellBtn = worn
      ? ''
      : `<button class="btn btn-ghost${disCls}"${disAttr} data-act="${sellAct}" ${selAttrs}>${esc(T(stack.length > 1 ? 'pages.bag.sellStackBtn' : 'pages.bag.sellBtn'))}</button>`;
    const smeltBtn =
      worn || !env.canSmelt
        ? ''
        : `<button class="btn btn-ghost${disCls}"${disAttr} data-act="${smeltAct}" ${selAttrs}>${esc(T(stack.length > 1 ? 'pages.bag.smeltStackBtn' : 'pages.bag.smeltBtn'))}</button>`;
    return `<div class="gear-card ${env.rarityClass(gear.rarity)}">
      <span class="sigil sigil-sm">${esc(item?.icon ?? T('icons.gear'))}</span>
      <span class="gear-name"><span>${esc(displayName)}${countBadge}</span><small>${rows}</small></span>
      <span class="bag-ops">
        ${worn
          ? `<button class="btn btn-ghost" data-act="take-off" data-slot="${worn[0]}">${esc(T('pages.bag.takeOffBtn'))}</button>`
          : `<button class="btn" data-act="wear" data-uid="${gear.uid}">${esc(T('pages.bag.wearBtn'))}</button>`}
        ${sellBtn}
        ${smeltBtn}
        <button class="btn btn-mini" data-act="${locked ? 'unlock' : 'lock'}" data-uids="${uids}">${esc(T(locked ? 'pages.bag.unlockBtn' : 'pages.bag.lockBtn'))}</button>
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
        case 'sell-stack':
          // 整堆卖/熔（#37）：单动作原子批量（uids 白名单），非逐件派发。
          env.dispatch({ type: 'gear:sell-all', payload: { uids: uidsOf(target) } });
          env.render();
          return;
        case 'smelt-stack':
          env.dispatch({ type: 'gear:smelt-all', payload: { uids: uidsOf(target) } });
          env.render();
          return;
        case 'lock':
          // 锁定/解锁（#37）：实例 uid 级动作，整堆按钮逐 uid 派发（设置类动作
          // 不发事件不记账，无汇总语义）；派发后强刷（无事件驱动的重绘路径）。
          for (const uid of uidsOf(target)) env.dispatch({ type: 'gear:lock', payload: { uid } });
          env.render();
          return;
        case 'unlock':
          for (const uid of uidsOf(target)) env.dispatch({ type: 'gear:unlock', payload: { uid } });
          env.render();
          return;
        case 'clear-cap':
          // 阈值变更（#37）：页自持 UI 状态回写 + 强刷（按钮禁用态随阈值联动）。
          clearCapId = (target as HTMLSelectElement).value;
          env.render();
          return;
        case 'clear-sell':
          env.dispatch({ type: 'gear:sell-all', payload: { maxRarity: clearCapId } });
          env.render();
          return;
        case 'clear-smelt':
          env.dispatch({ type: 'gear:smelt-all', payload: { maxRarity: clearCapId } });
          env.render();
          return;
      }
    },
  };
}
