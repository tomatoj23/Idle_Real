/**
 * 页框零件（#46 架构评审二轮·卡1 D5）：实证 ≥2 份拷贝的六件同构零件单一来源。
 *
 * 纯函数收参出 HTML 串；引擎官方视图（dungeonGateOf/findBossOf/expToNext 等）
 * 内部直调——视图组装单点化，非公式复算，不违 snapshot 零公式义务（#26）。
 * 文案一律页面侧经 T 解析后传入（或传 T 本身），零件零题材字符串。
 */
import type { ContentPack } from '@wendao/content';
import {
  dungeonGateOf,
  expBase,
  expToNext,
  findBossOf,
  levelFromXp,
  type GameState,
  type ProgressionParams,
  type SaveData,
} from '@wendao/engine';
import type { ShellText } from './pages/types';

export const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );

/* ---------- 件6 · activity-pct：活动进度百分比 ---------- */

/** 活动寻址键（#40）：activityIntervals 映射与活动卡 data-key 共用的单一拼装式。 */
export const actKeyOf = (act: { readonly skillId: string; readonly index: number }): string =>
  `${act.skillId}:${act.index}`;

/** 活动进度百分比：有效间隔缺失/非正 → 0；封顶 100（五处散抄收敛）。 */
export const actPctOf = (progress: number, interval: number | undefined): number =>
  interval !== undefined && interval > 0 ? Math.min(100, (progress / interval) * 100) : 0;

/** 比例读数封顶钳制（血条/经验条共用；total ≤ 0 时按 1 兜底防除零）。 */
export const pctClamped = (value: number, total: number): number =>
  Math.max(0, Math.min(100, (value / (total > 0 ? total : 1)) * 100));

/* ---------- 件3 · xp 头 + chips ---------- */

/** xp 读数一次算清：层数/需求/已入/百分比（expToNext/expBase 引擎同源）。 */
export interface XpRead {
  readonly level: number;
  readonly need: number;
  readonly into: number;
  readonly pct: number;
}

export const xpReadOf = (xp: number, prog: ProgressionParams): XpRead => {
  const level = levelFromXp(xp, prog);
  const need = expToNext(level, prog);
  const into = xp - expBase(level, prog);
  return { level, need, into, pct: Number.isFinite(need) ? Math.min(100, (into / need) * 100) : 100 };
};

/** 修为副行文案：need 有限 → expSub 模板；无限 → expMax（keyBase = pages.<tab>）。 */
export const xpSubTextOf = (T: ShellText, keyBase: string, read: XpRead): string =>
  Number.isFinite(read.need)
    ? T(`${keyBase}.expSub`, { into: read.into, need: read.need, left: Math.max(0, Math.ceil(read.need - read.into)) })
    : T(`${keyBase}.expMax`);

/** 技能 chip（修炼页 locked 态 / 炼制页平态两份拷贝收敛）。 */
export function skillChipHtml(parts: {
  readonly T: ShellText;
  readonly id: string;
  readonly icon: string;
  readonly name: string;
  readonly level: number;
  readonly selected: boolean;
  readonly action: 'skill' | 'craftskill';
  readonly locked?: boolean;
  readonly lockText?: string;
}): string {
  const { T, id, icon, name, level, selected, action, locked, lockText } = parts;
  return `<button class="chip${selected ? ' selected' : ''}${locked ? ' locked' : ''}"
          data-act="${action}" data-skill="${id}"${locked ? ' data-disabled="y"' : ''}>
          <span class="sigil sigil-sm">${esc(icon)}</span><span>${esc(name)}</span>
          ${locked ? `<em class="chip-lock">${esc(lockText ?? '')}</em>` : `<b class="chip-lv">${esc(T('units.level', { v: level }))}</b>`}
        </button>`;
}

/* ---------- 件1 · statusCard（修炼/炼制状态卡骨架） ---------- */

/** 状态卡右栏（进行中活动/挂机空闲）：label 为页面侧组装好的 actNow 文案。 */
export function statusActHtml(parts: {
  readonly running: { readonly label: string; readonly key: string; readonly pct: number; readonly stopLabel: string } | null;
  readonly idleText: string;
}): string {
  if (!parts.running) {
    return `<div class="act-now idle"><span>${esc(parts.idleText)}</span></div>`;
  }
  const { label, key, pct, stopLabel } = parts.running;
  return `<div class="act-now"><span>${esc(label)}</span><b data-act-pct data-key="${key}">${Math.floor(pct)}%</b></div>
           <div class="bar bar-jade"><i data-bar="activity" data-key="${key}" style="width:${pct}%"></i></div>
           ${actStopBtnHtml(stopLabel)}`;
}

/** 状态卡骨架：境界行/描述行可选；expSub 与 actHtml 由页面组装传入。 */
export function statusCardHtml(parts: {
  readonly T: ShellText;
  readonly icon: string;
  readonly name: string;
  readonly level: number;
  readonly desc?: string;
  /** 境界行（修炼页；包无 realms 词表时整行省略——零降级路径）。 */
  readonly realmHtml?: string;
  readonly expPct: number;
  readonly expSub: string;
  readonly actHtml: string;
}): string {
  const p = parts;
  return `<section class="status-card">
        <span class="sigil sigil-big">${esc(p.icon)}</span>
        <div class="status-main">
          <div class="status-head"><b>${esc(p.name)}</b><span class="status-lv">${esc(p.T('units.level', { v: p.level }))}</span>${p.desc ? `<span class="status-desc">${esc(p.desc)}</span>` : ''}</div>
          ${p.realmHtml ?? ''}
          <div class="bar"><i style="width:${p.expPct}%"></i></div>
          <div class="status-sub">${esc(p.expSub)}</div>
        </div>
        <div class="status-act">
          ${p.actHtml}
        </div>
      </section>`;
}

/* ---------- 件2 · act 卡（活动/配方卡骨架） ---------- */

export function actCardHtml(parts: {
  readonly title: string;
  readonly running?: boolean;
  readonly locked?: boolean;
  readonly runningBadge?: string;
  /** 产出/材料/元信息区（页面组装）。 */
  readonly body: string;
  /** 底部操作区（开工/停工/锁定句）。 */
  readonly op?: string;
}): string {
  const p = parts;
  return `<article class="act-card${p.running ? ' running' : ''}${p.locked ? ' locked' : ''}">
          <header><b>${esc(p.title)}</b>${p.running ? `<em class="act-badge">${esc(p.runningBadge ?? '')}</em>` : ''}</header>
          ${p.body}
          ${p.op ?? ''}
        </article>`;
}

/** 产出行：图标 + 名称 ×数量 + 附带徽标（副产物/成功率）。 */
export function actYieldHtml(parts: {
  readonly icon: string;
  readonly name: string;
  readonly count: number;
  readonly bonusHtml?: string;
}): string {
  return `<div class="act-yield">
            <span class="sigil sigil-sm">${esc(parts.icon)}</span> ${esc(parts.name)} ×${parts.count}
            ${parts.bonusHtml ?? ''}
          </div>`;
}

/** 活动细进度条（键控充能，update 差量刷新的锚点）。 */
export const actBarHtml = (key: string, pct: number): string =>
  `<div class="bar bar-thin"><i data-bar="activity" data-key="${key}" style="width:${pct}%"></i></div>`;

export const actStartBtnHtml = (skillId: string, index: number, label: string): string =>
  `<button class="btn" data-act="start" data-skill="${skillId}" data-index="${index}">${esc(label)}</button>`;

export const actStopBtnHtml = (label: string): string =>
  `<button class="btn btn-ghost" data-act="stop">${esc(label)}</button>`;

export const actLockHtml = (msg: string): string => `<span class="act-lockmsg">${esc(msg)}</span>`;

/* ---------- 件4 · gate+lockMsg 行 ---------- */

/** 道韵/层数双门锁定句：道韵优先（修炼卡/配方卡/敌卡三处散抄收敛）。 */
export const levelLockMsgOf = (
  T: ShellText,
  yunGate: { readonly locked: boolean; readonly requiredDaoYun: number },
  needLevel: number,
): string =>
  yunGate.locked
    ? T('common.needDaoYun', { daoYun: yunGate.requiredDaoYun })
    : T('common.needLevel', { level: needLevel });

/** 秘境门锁句：锁因走引擎 dungeonGateOf 单一来源；道韵复用 needDaoYun，钥匙用 entryKey。 */
export const dungeonLockMsgOf = (T: ShellText, content: ContentPack, st: GameState, dungeonId: string): string => {
  const gate = dungeonGateOf(content, dungeonId, { daoYunEarned: st.daoYunEarned, items: st.items });
  if (gate.daoYunLocked) {
    return T('common.needDaoYun', { daoYun: gate.requiredDaoYun });
  }
  const keyItem = gate.keyItem ?? '';
  return T('pages.dungeon.entryKey', { item: content.items.find((item) => item.id === keyItem)?.name ?? keyItem });
};

/* ---------- 件5 · 战斗敌卡（斗法/秘境交战信息面） ---------- */

/** Boss 徽标与血条分段刻度（非 Boss = 空串；刻度位置 = 阶段阈值，content 数据）。 */
export const bossDecoOf = (content: ContentPack, st: GameState): { badge: string; ticks: string } => {
  const combat = st.combat;
  const boss = combat ? findBossOf(content, combat.enemyId) : undefined;
  if (!boss) return { badge: '', ticks: '' };
  const idx = combat!.bossPhase;
  const phase = idx >= 0 ? boss.phases[idx] : undefined;
  const badge = phase ? `<em class="act-badge boss-phase">${esc(phase.name ?? '')}</em>` : '';
  const ticks = boss.phases
    .map((p) => `<i class="tick" style="left:${Math.round((p.threshold ?? 0) * 100)}%"></i>`)
    .join('');
  return { badge, ticks };
};

/**
 * 召唤物行（斗法页/秘境页共用）：首槽 = 集火目标（集火序 = 引擎先入先出，壳零
 * 排序复算）；槽位视图 = 引擎快照投影组（#40），投影失效槽位已被引擎剔除。
 */
export const minionsHtml = (T: ShellText, snap: SaveData): string =>
  (snap.minions ?? [])
    .map(({ minion, view }, index) => {
      const pct = pctClamped(minion.hp, view.hp);
      return `<div class="minion-row${index === 0 ? ' focus' : ''}">
              <span class="sigil sigil-sm">${esc(view.icon)}</span>
              <b>${esc(view.name)}</b>
              ${index === 0 ? `<em class="act-badge">${esc(T('pages.combat.engagedBadge'))}</em>` : ''}
              <span class="minion-hp">${esc(T('pages.combat.enemyHp', { ehp: Math.max(0, Math.ceil(minion.hp)), hp: view.hp }))}</span>
              <div class="bar bar-red bar-thin minion-bar"><i data-bar="minion" style="width:${pct}%"></i></div>
            </div>`;
    })
    .join('');

/** 自身属性行文案（{hp}/{max}/{atk}/{def}/{crit} 槽；量纲查 statLabels）。 */
export const selfStatsTextOf = (
  T: ShellText,
  statValueText: (stat: string, value: number | string) => string,
  st: GameState,
  snap: SaveData,
): string =>
  T('pages.combat.selfStats', {
    hp: Math.floor(st.hp),
    max: snap.stats?.maxHp ?? '—',
    atk: statValueText('atk', snap.stats?.atk ?? '—'),
    def: statValueText('def', snap.stats?.def ?? '—'),
    crit: statValueText('crit', snap.stats?.crit ?? '—'),
  });

/** 交战敌卡骨架：头部徽标/操作区由页面组装（斗法=休整+逃跑，秘境=撤退）。 */
export function fightingEnemyCardHtml(parts: {
  readonly T: ShellText;
  readonly icon: string;
  readonly name: string;
  readonly level: number;
  /** 头部徽标串（休整徽标 + Boss 阶段徽标等）。 */
  readonly headBadges: string;
  readonly decoTicks: string;
  readonly ehpPct: number;
  /** 敌血行文案（pages.combat.enemyHp 填充结果）。 */
  readonly ehpText: string;
  readonly minions: string;
  readonly hpPct: number;
  /** 自身属性行文案（selfStatsTextOf 填充结果）。 */
  readonly selfStatsText: string;
  readonly opsHtml: string;
}): string {
  const p = parts;
  return `<article class="enemy-card fighting">
            <div class="enemy-face"><span class="sigil sigil-big">${esc(p.icon)}</span></div>
            <div class="enemy-main">
              <div class="enemy-head"><b>${esc(p.name)}</b><span class="enemy-lv">${esc(p.T('units.level', { v: p.level }))}</span>${p.headBadges}</div>
              <div class="bar bar-red">${p.decoTicks}<i data-bar="enemy" style="width:${p.ehpPct}%"></i></div>
              <div class="enemy-sub">${esc(p.ehpText)}</div>
              <div class="minion-rows">${p.minions}</div>
              <div class="bar bar-jade"><i style="width:${p.hpPct}%"></i></div>
              <div class="enemy-sub">${esc(p.selfStatsText)}</div>
            </div>
            <div class="enemy-ops">${p.opsHtml}</div>
          </article>`;
}

/* ---------- 页面共用小件 ---------- */

/** 背包中可服用的回气类消耗品按钮行（斗法页/秘境页共用）。 */
export const consumablesHtml = (content: ContentPack, st: GameState): string =>
  content.items
    .filter((item) => item.type === 'consumable' && (st.items[item.id] ?? 0) > 0)
    .map(
      (item) =>
        `<button class="btn btn-consumable" data-act="eat" data-item="${item.id}">${esc(item.icon)} ${esc(item.name)} ×${st.items[item.id]}</button>`,
    )
    .join('');

/* ---------- 实况刷新共用体（D3：页级 update 的单一实现） ---------- */

/**
 * 活动进度条每帧刷新（修炼/炼制页 update 委托此实现）：进度条按活动键控，
 * 只有正在进行的卡片充能，其余归零；有效间隔单一来源 = 引擎快照映射（#40）。
 */
export const refreshActivityBars = (pageEl: HTMLElement, st: GameState, snap: SaveData): void => {
  let key = '';
  let pct = 0;
  if (st.activity) {
    const interval = snap.activityIntervals?.[actKeyOf(st.activity)];
    if (interval !== undefined && interval > 0) {
      key = actKeyOf(st.activity);
      pct = Math.min(100, (st.activity.progress / interval) * 100);
    }
  }
  for (const el of pageEl.querySelectorAll<HTMLElement>('[data-bar="activity"]')) {
    el.style.width = `${el.dataset.key === key ? pct : 0}%`;
  }
  for (const el of pageEl.querySelectorAll<HTMLElement>('[data-act-pct]')) {
    el.textContent = `${el.dataset.key === key ? Math.floor(pct) : 0}%`;
  }
};

/** 敌方血条每帧刷新（斗法/秘境页 update 委托此实现；读引擎快照投影，#40）。 */
export const refreshEnemyBar = (pageEl: HTMLElement, st: GameState, snap: SaveData): void => {
  const bar = pageEl.querySelector<HTMLElement>('[data-bar="enemy"]');
  if (!bar || !st.combat) return;
  const enemy = snap.enemy;
  if (!enemy) return;
  bar.style.width = `${pctClamped(st.combat.ehp, enemy.hp)}%`;
};
