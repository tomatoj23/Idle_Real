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
import type { PageCtx, ShellText } from './pages/types';

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
              <span class="minion-hp">${esc(ehpTextOf(T, minion.hp, view.hp))}</span>
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

/** 敌血读数文案（{ehp}/{hp} 填槽）：render 与补丁两路同式同源的单一拼装式（#50）。 */
export const ehpTextOf = (T: ShellText, ehp: number, hpMax: number): string =>
  T('pages.combat.enemyHp', { ehp: Math.max(0, Math.ceil(ehp)), hp: hpMax });

/**
 * 自血条百分比单一来源（#50 复审收口：斗法/秘境两 render 旧兜底口径分叉——
 * `?? enemy.hp` vs `?? 1`，补丁再取其一必有一侧首帧跳变）。上限 = 属性面板
 * maxHp（运行时恒在）；缺失走 pctClamped 的 total≤0 → 1 兜底。
 */
export const selfHpPctOf = (st: Readonly<GameState>, snap: SaveData): number =>
  pctClamped(st.hp, snap.stats?.maxHp ?? 1);

/** 交战敌卡骨架：头部徽标/操作区由页面组装（斗法=休整+逃跑，秘境=撤退）。
 *  血条/读数行带 data 锚点（data-bar/…-text/…-stats），供 refreshCombatLive
 *  定点补丁（#50 D3）——实况值不再经整页重建携带。 */
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
  /** 召唤行组结构键（minionRowsKeyOf）：render 即落 data-minion-rows——
   *  重建帧首帧 update 直走补丁路径，不再幂等重挂行组（#50 复核收口）。 */
  readonly minionRowsKey: string;
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
              <div class="enemy-sub" data-ehp-text>${esc(p.ehpText)}</div>
              <div class="minion-rows" data-minion-rows="${esc(p.minionRowsKey)}">${p.minions}</div>
              <div class="bar bar-jade"><i data-bar="self" style="width:${p.hpPct}%"></i></div>
              <div class="enemy-sub" data-self-stats>${esc(p.selfStatsText)}</div>
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

/**
 * 交战敌卡实况补丁（#50 D3：updateEnemyBar 模式推广为页级 update，斗法/秘境
 * 页 update 共用单一实现）：敌血宽+读数 / 自血宽+属性行 / 召唤行组——全部定点
 * 补丁。签名已移除 ehp/summons/hp 项，实况值由本函数每帧轻刷，页面不再靠
 * 敌血逐击重建（旧「签名漏 st.hp、自血条搭敌血便车」的隐式契约在此了结）。
 * 补丁读数与 render 同式同源，重建后首帧零跳变。
 */
export const refreshCombatLive = (parts: {
  readonly pageEl: HTMLElement;
  readonly st: Readonly<GameState>;
  readonly snap: SaveData;
  readonly T: ShellText;
  readonly statValueText: (stat: string, value: number | string) => string;
}): void => {
  const { pageEl, st, snap, T, statValueText } = parts;
  const combat = st.combat;
  const enemy = snap.enemy;
  if (!combat || !enemy) return;
  const ehpPct = pctClamped(combat.ehp, enemy.hp);
  const enemyBar = pageEl.querySelector<HTMLElement>('[data-bar="enemy"]');
  if (enemyBar) enemyBar.style.width = `${ehpPct}%`;
  const ehpText = pageEl.querySelector<HTMLElement>('[data-ehp-text]');
  if (ehpText) {
    ehpText.textContent = ehpTextOf(T, combat.ehp, enemy.hp);
  }
  const selfBar = pageEl.querySelector<HTMLElement>('[data-bar="self"]');
  if (selfBar) selfBar.style.width = `${selfHpPctOf(st, snap)}%`;
  const selfStats = pageEl.querySelector<HTMLElement>('[data-self-stats]');
  if (selfStats) selfStats.textContent = selfStatsTextOf(T, statValueText, st, snap);
  refreshMinionRows(pageEl, snap, T);
};

/**
 * 召唤行组结构键（#50）：槽位身份（敌 id + 阶段 + 投影上限）按集火序拼装；
 * 血量是逐击活值不进键——键稳时行组节点存活，只补丁读数（行身份不变）。
 * JSON 编码防歧义（敌 id 若含 ':'/',' 拼接串会撞键；引擎视内容包为不透明，
 * 未过校验的包不受 schema id 字符集保护）——#50 复核收口 P3。
 */
export const minionRowsKeyOf = (snap: SaveData): string =>
  JSON.stringify((snap.minions ?? []).map(({ minion, view }) => [minion.enemyId, minion.phase, view.hp]));

/** 召唤行组定点补丁：结构键变（入场/阵亡/换阶段）→ 整组重挂；键稳 → 逐行补丁。 */
const refreshMinionRows = (pageEl: HTMLElement, snap: SaveData, T: ShellText): void => {
  const box = pageEl.querySelector<HTMLElement>('.minion-rows');
  if (!box) return;
  const key = minionRowsKeyOf(snap);
  if (box.dataset.minionRows !== key) {
    box.dataset.minionRows = key;
    box.innerHTML = minionsHtml(T, snap);
    return;
  }
  const rows = box.querySelectorAll<HTMLElement>('.minion-row');
  (snap.minions ?? []).forEach(({ minion, view }, index) => {
    const row = rows[index];
    if (!row) return;
    const bar = row.querySelector<HTMLElement>('[data-bar="minion"]');
    if (bar) bar.style.width = `${pctClamped(minion.hp, view.hp)}%`;
    const text = row.querySelector<HTMLElement>('.minion-hp');
    if (text) {
      text.textContent = ehpTextOf(T, minion.hp, view.hp);
    }
  });
};

/**
 * 页级 update 单一实现（#50 复审收口：斗法/秘境两页 update 体曾逐字节重复）：
 * 补丁零件组装的唯一入口，页面侧一行接线 `update: combatLiveUpdater(env)`。
 */
export const combatLiveUpdater =
  (env: {
    readonly pageEl: HTMLElement;
    readonly statValueText: (stat: string, value: number | string) => string;
  }) =>
  (ctx: PageCtx): void => {
    refreshCombatLive({
      pageEl: env.pageEl,
      st: ctx.st,
      snap: ctx.snap,
      T: ctx.T,
      statValueText: env.statValueText,
    });
  };
