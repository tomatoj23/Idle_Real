/**
 * 成就页（#9，#46 页面注册表）：统计区（包声明呈现面）+ 成就卡（进度条/奖励）。
 * 进度投影走引擎 achievementProgressOf（与解锁判定同式同源，壳零公式复算）。
 * 纯展示页，无动作无实况刷新（无 handleAction/update）。
 */
import { achievementProgressOf } from '@wendao/engine';
import { esc } from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

export function createAchievementsPage(env: PageEnv): PageView {
  const render = (ctx: PageCtx): string => {
    const { st, content, T } = ctx;
    const defs = content.achievements ?? [];
    if (defs.length === 0) {
      return `<section class="page"><p class="empty">${esc(T('pages.achievements.empty'))}</p></section>`;
    }
    // 进度投影走引擎 achievementProgressOf（与解锁判定同式同源，壳零公式复算）。
    const stats = st.stats ?? {};
    const views = achievementProgressOf(content, stats, st.achievements ?? []);
    const unlockedCount = views.filter((view) => view.unlocked).length;
    const sep = T('common.itemListSep');

    // 统计区：呈现面由包 statLabels 声明（键 = 引擎统计注册表闭集），零记录读 0。
    const statLabelMap = env.shellRaw('pages.achievements.statLabels');
    const statRows =
      statLabelMap !== null && typeof statLabelMap === 'object'
        ? Object.entries(statLabelMap as Record<string, unknown>)
            .filter(([, label]) => typeof label === 'string' && label.length > 0)
            .map(
              ([key, label]) =>
                `<div class="stat-box"><b>${Math.floor(stats[key] ?? 0).toLocaleString(env.locale)}</b><span>${esc(String(label))}</span></div>`,
            )
            .join('')
        : '';

    const cards = views
      .map((view) => {
        const { def, unlocked, percent } = view;
        const concealed = def.hidden && !unlocked;
        const name = concealed ? T('pages.achievements.hiddenName') : def.name;
        const desc = concealed
          ? T('pages.achievements.hiddenDesc')
          : (def.description ?? '');
        // 进度条：已解锁不渲染（恒 100 无信息量）；布尔型（无 target）无进度可言。
        // 数值行另拆：lte 的 {current}/{target} 语义反直觉（「最快击杀」5/3 读作
        // 反向），只留进度条（真机验收裁决）。
        const progressBar =
          !unlocked && view.target !== undefined
            ? `<div class="bar bar-thin"><i style="width:${percent}%"></i></div>`
            : '';
        const progressRow =
          !unlocked && view.target !== undefined && def.condition.op !== 'lte'
            ? `<div class="act-meta">${esc(T('pages.achievements.progress', { current: view.current ?? 0, target: view.target }))}</div>`
            : '';
        // 奖励行：引擎入账结果的内容面直出（parts 由壳拼装，缺项省略）。
        const reward = def.reward;
        const parts: string[] = [];
        if (!concealed && reward) {
          if (reward.gold !== undefined) parts.push(T('pages.achievements.rewardGold', { gold: reward.gold }));
          if (reward.daoYun !== undefined)
            parts.push(T('pages.achievements.rewardDaoYun', { daoYun: reward.daoYun }));
          if (reward.items !== undefined && reward.items.length > 0) {
            parts.push(
              T('pages.achievements.rewardItems', {
                items: reward.items.map((stack) => `${env.nameOf(stack.item)}×${stack.count}`).join(sep),
              }),
            );
          }
        }
        return `<article class="act-card ach-card${unlocked ? ' owned' : ''}${concealed ? ' locked' : ''}">
          <header><b><span class="sigil sigil-sm">${esc(concealed ? T('icons.unknown') : (def.icon ?? T('icons.unknown')))}</span> ${esc(name)}</b>${unlocked ? `<em class="act-badge">${esc(T('pages.achievements.unlockedBadge'))}</em>` : ''}</header>
          ${desc ? `<div class="talent-desc">${esc(desc)}</div>` : ''}
          ${progressBar}
          ${progressRow}
          ${parts.length > 0 ? `<div class="act-meta ach-reward">${esc(parts.join(sep))}</div>` : ''}
        </article>`;
      })
      .join('');

    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.achievements.title'))}</h2>
        <p class="page-sub">${esc(T('pages.achievements.subtitle', { unlocked: unlockedCount, total: views.length }))}</p>
        <h3 class="group-title">${esc(T('pages.achievements.statsTitle'))}</h3>
        ${statRows ? `<div class="stat-grid">${statRows}</div>` : ''}
        <div class="act-grid">${cards}</div>
      </section>`;
  };

  return {
    id: 'achievements',
    label: 'tabs.achievements',
    render,
  };
}
