/**
 * 修行录页（#33）：随档记录资产（行为段环形流水）的独立呈现页。
 *
 * 数据面：引擎 snapshot.state.journal（records 判别联合条目）/ ledgerCounters /
 * journalAnchor；净收获走引擎 journalAnchorNet 投影（壳零公式复算）。条目引用
 * 全存 id——查表渲染（物品/技能/敌人/秘境/成就 → 内容包展示名），查无回显 id
 * （内容包变更兜底，AC）。
 *
 * 渲染面：列表按追加序（环形序）增量追加（seq 差量，AC：挂页时连续掉落不触发
 * 整页重建——signature 对本页只比 journal 低频字段，见 ui.ts）；类型过滤为页面
 * 自持 UI 状态（按 data-kind 显示/隐藏，零重拼）；锚点按钮 dispatch
 * 'journal:anchor'。进行中聚合段（journalOpen 双槽）单行轻刷。
 *
 * 转义纪律：esc 只做一次——变量裸传 T 填槽，模板结果整体 esc（与 bag.ts 先例
 * 一致；名字先 esc 再进槽会双重转义出 &amp;）。
 */
import {
  gearName,
  journalAnchorNet,
  JOURNAL_CAP,
  type GameState,
  type JournalLine,
  type JournalRecord,
  type LedgerSource,
} from '@wendao/engine';
import { esc } from '../pageFrame';
import type { PageCtx, PageEnv, PageView } from './types';

/** 页面自持 UI 状态：类型过滤键（条目级 kind 归组见 filterKeyOf）。 */
type JournalFilter = 'all' | 'combat' | 'dungeon' | 'craft' | 'visit' | 'offline' | 'milestone';

const FILTER_KEYS: readonly JournalFilter[] = [
  'all',
  'combat',
  'dungeon',
  'craft',
  'visit',
  'offline',
  'milestone',
];

/** 条目 → 过滤键归组（交易 = 访问段 + 买卖点条目；纪事 = 升级/成就/兵解/其余点条目）。 */
function filterKeyOf(rec: JournalRecord): Exclude<JournalFilter, 'all'> {
  switch (rec.kind) {
    case 'combat':
      return 'combat';
    case 'dungeon':
      return 'dungeon';
    case 'gather':
    case 'craft':
      return 'craft';
    case 'visit':
      return 'visit';
    case 'offline':
      return 'offline';
    case 'levelup':
    case 'achievement':
    case 'rebirth':
      return 'milestone';
    case 'point':
      return rec.source === 'sell' || rec.source === 'buy' ? 'visit' : 'milestone';
  }
}

/** 带符号数量串（明细行/净收获行的方向感）。 */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function createJournalPage(env: PageEnv): PageView {
  const { T, content, nameOf } = env;

  let filter: JournalFilter = 'all';
  /** 增量游标：已渲染到的流水 seq（render 全量时同步为尾部）。 */
  let lastSeq = 0;
  let lastNetHtml: string | null = null;
  let lastOpenHtml: string | null = null;

  /* ---------- 查名链（条目引用 id → 内容包展示名；查无回显 id） ---------- */

  const skillNameOf = (id: string): string => content.skills.find((s) => s.id === id)?.name ?? id;
  const enemyNameOf = (id: string): string =>
    (content.enemies ?? []).find((e) => e.id === id)?.name ?? id;
  const dungeonNameOf = (id: string): string =>
    ((content as { dungeons?: readonly { id: string; name: string }[] }).dungeons ?? []).find(
      (d) => d.id === id,
    )?.name ?? id;
  const achievementNameOf = (id: string): string =>
    (content.achievements ?? []).find((a) => a.id === id)?.name ?? id;

  const itemDisplayOf = (id: string, rarity?: string): string => {
    const name = nameOf(id);
    return rarity ? gearName(content, name, rarity) : name;
  };

  /** 净收获行的对象展示名（currency/exp 分支走文案键与技能表）。 */
  const netNameOf = (kind: string, id: string): string => {
    if (kind === 'currency') {
      if (id === 'gold') return T('pages.journal.goldName');
      if (id === 'daoYun') return T('pages.journal.daoYunName');
      return id;
    }
    if (kind === 'exp') return skillNameOf(id);
    return nameOf(id);
  };

  const pageNameOf = (page: string): string =>
    page === 'shop'
      ? T('pages.journal.pageShop')
      : page === 'bag'
        ? T('pages.journal.pageBag')
        : page;

  function timeMark(t0: number, t1: number): string {
    const fmt = (t: number): string => new Date(t).toLocaleTimeString(env.locale);
    return t0 === t1 ? fmt(t0) : `${fmt(t0)} – ${fmt(t1)}`;
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return T('units.hourMinute', { h, m });
    if (m > 0) return T('units.minute', { m });
    return T('units.seconds', { v: seconds });
  }

  function badgeOf(rec: JournalRecord): string {
    const key = (k: string): string => T(`pages.journal.${k}`);
    switch (rec.kind) {
      case 'combat':
        return key('badgeCombat');
      case 'dungeon':
        return key('badgeDungeon');
      case 'gather':
        return key('badgeGather');
      case 'craft':
        return key('badgeCraft');
      case 'visit':
        return key('badgeVisit');
      case 'offline':
        return key('badgeOffline');
      case 'levelup':
        return key('badgeLevelup');
      case 'achievement':
        return key('badgeAchievement');
      case 'rebirth':
        return key('badgeRebirth');
      case 'point':
        // 点条目按归组显示：买卖归交易，其余（服用/熔炼/重铸/点亮/兜底）归纪事。
        return key(
          filterKeyOf(rec) === 'visit' ? 'badgeVisit' : 'filterMilestone',
        );
    }
  }

  /** 点条目动作词（ledger source → 文案键；行为来源兜底 = pointFallback）。 */
  function pointWordOf(source: LedgerSource): string {
    const key =
      source === 'sell'
        ? 'pointSell'
        : source === 'buy'
          ? 'pointBuy'
          : source === 'eat'
            ? 'pointEat'
            : source === 'smelt'
              ? 'pointSmelt'
              : source === 'reforge'
                ? 'pointReforge'
                : source === 'talent'
                  ? 'pointTalent'
                  : 'pointFallback';
    return T(`pages.journal.${key}`);
  }

  /** 段条目标题 + 副行（副行缺省省略；模板槽裸传，结果整体 esc 一次）。 */
  function titleOf(rec: JournalRecord): { title: string; sub: string } {
    const jt = (key: string, vars?: Readonly<Record<string, string | number>>): string =>
      esc(T(`pages.journal.${key}`, vars));
    switch (rec.kind) {
      case 'combat':
        return {
          title: jt('combatTitle', { wins: rec.wins, losses: rec.losses }),
          sub: esc(rec.enemyIds.map((id) => enemyNameOf(id)).join(T('common.itemListSep'))),
        };
      case 'gather':
        return {
          title: jt('gatherTitle', { activity: rec.activityName ?? skillNameOf(rec.skillId), cycles: rec.cycles }),
          sub: rec.exp > 0 ? jt('expSuffix', { exp: rec.exp }) : '',
        };
      case 'craft':
        return {
          title:
            jt('craftTitle', { activity: rec.activityName ?? skillNameOf(rec.skillId), cycles: rec.cycles }) +
            (rec.fails > 0 ? ' ' + jt('craftFails', { fails: rec.fails }) : ''),
          sub: rec.exp > 0 ? jt('expSuffix', { exp: rec.exp }) : '',
        };
      case 'dungeon':
        return {
          title: jt('dungeonTitle', { name: dungeonNameOf(rec.dungeonId) }),
          sub:
            jt('dungeonDeepest', { deepest: rec.deepest }) +
            (rec.cleared > 0 ? ' · ' + jt('dungeonCleared', { cleared: rec.cleared }) : ''),
        };
      case 'visit':
        return { title: jt('visitTitle', { page: pageNameOf(rec.page) }), sub: '' };
      case 'offline': {
        // 离线上限钳制时双口径区分（awaySeconds=真实离开 / seconds=结算时长）。
        const capped = rec.capped
          ? jt('offlineCapped', {
              away: formatDuration(rec.awaySeconds ?? rec.seconds),
              settled: formatDuration(rec.seconds),
            })
          : '';
        return {
          title: jt('offlineTitle', { activity: rec.activityName ?? skillNameOf(rec.skillId), cycles: rec.cycles }),
          sub: (rec.exp > 0 ? jt('offlineExp', { exp: rec.exp }) : '') + capped,
        };
      }
      case 'point':
        return { title: esc(pointWordOf(rec.source)), sub: '' };
      case 'levelup':
        return {
          title: jt('levelupTitle', { skill: skillNameOf(rec.skillId), level: rec.level }),
          sub: '',
        };
      case 'achievement':
        return { title: jt('achievementTitle', { name: achievementNameOf(rec.id) }), sub: '' };
      case 'rebirth':
        return {
          title: jt('rebirthTitle', { count: rec.rebirths, daoYun: rec.daoYun }),
          sub: '',
        };
    }
  }

  /** 明细行文案（auto 标记行 = 折叠补注「已自动售卖/熔炼 被折物」；折得物另行走常觧行）。 */
  function lineText(line: JournalLine): string {
    if (line.auto !== undefined) {
      const act = T(`pages.journal.${line.auto === 'sell' ? 'autoSell' : 'autoSmelt'}`);
      return esc(T('pages.journal.autoNote', { act, name: itemDisplayOf(line.id, line.rarity) }));
    }
    switch (line.kind) {
      case 'item':
      case 'gear':
        return esc(T('pages.journal.lineItem', { name: itemDisplayOf(line.id, line.rarity), count: signed(line.count) }));
      case 'currency':
        return esc(
          T(line.id === 'daoYun' ? 'pages.journal.lineDaoYun' : 'pages.journal.lineGold', {
            count: signed(line.count),
          }),
        );
      case 'exp':
        return esc(T('pages.journal.lineExp', { count: signed(line.count) }));
    }
  }

  /** 单条条目 → 行 HTML（data-seq 供增量测试定位）。 */
  function rowHtml(rec: JournalRecord): string {
    const { title, sub } = titleOf(rec);
    const lines = ('lines' in rec ? rec.lines : [])
      .map((line) => lineText(line))
      .filter((text) => text.length > 0);
    const linesHtml = lines.join(`<span class="jr-sep">${esc(T('common.itemListSep'))}</span>`);
    return `<div class="jr-row" data-seq="${rec.seq}" data-kind="${filterKeyOf(rec)}">
      <span class="jr-badge jr-${filterKeyOf(rec)}">${esc(badgeOf(rec))}</span>
      <div class="jr-body">
        <div class="jr-title">${title}${sub ? `<span class="jr-sub">${sub}</span>` : ''}</div>
        ${linesHtml ? `<div class="jr-lines">${linesHtml}</div>` : ''}
      </div>
      <time class="jr-time" title="${esc(timeMark(rec.t0, rec.t1))}">${esc(timeMark(rec.t0, rec.t1))}</time>
    </div>`;
  }

  /* ---------- 净收获区 / 进行中段（轻刷区域） ---------- */

  function netHtml(st: GameState): string {
    const rows = journalAnchorNet(st.ledgerCounters ?? {}, st.journalAnchor ?? null);
    const head = st.journalAnchor
      ? `<div class="jr-anchor-at">${esc(T('pages.journal.anchorAt', { time: new Date(st.journalAnchor.at).toLocaleString(env.locale) }))}</div>`
      : '';
    const body = !st.journalAnchor
      ? `<p class="jr-net-empty">${esc(T('pages.journal.netHint'))}</p>`
      : rows.length === 0
        ? `<p class="jr-net-empty">${esc(T('pages.journal.netEmpty'))}</p>`
        : rows
            .map((row) =>
              esc(
                T('pages.journal.netRow', {
                  name: netNameOf(row.kind, row.id),
                  count: signed(row.count),
                }),
              ),
            )
            .map((text) => `<span class="jr-net-row">${text}</span>`)
            .join('');
    return head + body;
  }

  /** 进行中聚合段行（行为段/访问段双槽并行展示）。 */
  function openRowsHtml(st: GameState): string[] {
    const rows: string[] = [];
    const behavior = st.journalOpen?.behavior;
    if (behavior && behavior.kind !== 'visit') {
      const name =
        behavior.kind === 'combat'
          ? enemyNameOf(behavior.enemyIds[behavior.enemyIds.length - 1] ?? '')
          : behavior.kind === 'dungeon'
            ? dungeonNameOf(behavior.dungeonId)
            : (behavior.activityName ?? skillNameOf(behavior.skillId));
      rows.push(
        `<div class="jr-row jr-open"><span class="jr-badge">${esc(T('pages.journal.openNow', { name }))}</span></div>`,
      );
    }
    const visit = st.journalOpen?.visit;
    if (visit) {
      rows.push(
        `<div class="jr-row jr-open"><span class="jr-badge">${esc(T('pages.journal.openNow', { name: pageNameOf(visit.page) }))}</span></div>`,
      );
    }
    return rows;
  }

  /* ---------- PageView ---------- */

  /** 流水列表 HTML（render 全量与过滤切换共用一份拼装）。 */
  const renderList = (records: readonly JournalRecord[]): string => {
    const rows = records
      .filter((rec) => filter === 'all' || filterKeyOf(rec) === filter)
      .map((rec) => rowHtml(rec))
      .join('');
    return rows || `<p class="empty">${esc(T('pages.journal.empty'))}</p>`;
  };

  const render = (ctx: PageCtx): string => {
    const { st } = ctx;
    const records = st.journal?.records ?? [];
    lastSeq = records.length > 0 ? records[records.length - 1]!.seq : lastSeq;
    lastNetHtml = null;
    lastOpenHtml = null;

    const chips = FILTER_KEYS.map(
      (key) =>
        `<button class="chip${filter === key ? ' selected' : ''}" data-act="jr-filter" data-filter="${key}">${esc(
          T(`pages.journal.filter${key[0]!.toUpperCase()}${key.slice(1)}`),
        )}</button>`,
    ).join('');
    const anchorBtn = `<button class="btn btn-ghost" id="jr-anchor-btn" data-act="jr-anchor">${
      st.journalAnchor ? esc(T('pages.journal.anchorBtn')) : esc(T('pages.journal.anchorNew'))
    }</button>`;

    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.journal.title'))}</h2>
        <p class="page-sub">${esc(T('pages.journal.subtitle', { count: records.length }))}</p>
        <div class="jr-top">
          <div class="jr-net">
            <h3 class="group-title">${esc(T('pages.journal.netTitle'))}</h3>
            <div class="jr-net-body" id="jr-net">${netHtml(st)}</div>
          </div>
          <div class="jr-anchor">${anchorBtn}</div>
        </div>
        <div class="chips jr-filters">${chips}</div>
        <div class="jr-open-row" id="jr-open">${openRowsHtml(st).join('')}</div>
        <div class="jr-list" id="jr-list">${renderList(records)}</div>
      </section>`;
  };

  const update = (ctx: PageCtx): void => {
    const { st } = ctx;
    const list = env.pageEl.querySelector<HTMLElement>('#jr-list');
    if (!list) return;

    // 增量追加：seq 差量从尾部反扫（流水不变时 O(1)，无整页重建）。
    const records = st.journal?.records ?? [];
    let i = records.length - 1;
    while (i >= 0 && records[i]!.seq > lastSeq) i -= 1;
    const fresh = records.slice(i + 1);
    if (fresh.length > 0) {
      const emptyEl = list.querySelector('.empty');
      if (emptyEl) emptyEl.remove();
      for (const rec of fresh) {
        if (filter !== 'all' && filterKeyOf(rec) !== filter) continue;
        list.insertAdjacentHTML('beforeend', rowHtml(rec));
      }
      while (list.children.length > JOURNAL_CAP) list.firstElementChild?.remove();
      lastSeq = records.length > 0 ? records[records.length - 1]!.seq : lastSeq;
      list.scrollTop = list.scrollHeight;
    }

    // 轻刷区：净收获 / 进行中段 / 锚点按钮（文本 diff 才写 DOM）。
    const net = netHtml(st);
    const netEl = env.pageEl.querySelector<HTMLElement>('#jr-net');
    if (netEl && net !== lastNetHtml) {
      lastNetHtml = net;
      netEl.innerHTML = net;
    }
    const openHtml = openRowsHtml(st).join('');
    const openEl = env.pageEl.querySelector<HTMLElement>('#jr-open');
    if (openEl && openHtml !== lastOpenHtml) {
      lastOpenHtml = openHtml;
      openEl.innerHTML = openHtml;
    }
    const anchorBtn = st.journalAnchor ? T('pages.journal.anchorBtn') : T('pages.journal.anchorNew');
    const btnEl = env.pageEl.querySelector<HTMLButtonElement>('#jr-anchor-btn');
    if (btnEl && btnEl.textContent !== anchorBtn) {
      btnEl.textContent = anchorBtn;
    }
  };

  const handleAction = (action: string, target: HTMLElement): void => {
    if (action === 'jr-filter') {
      const next = target.dataset.filter as JournalFilter | undefined;
      if (next === undefined || !FILTER_KEYS.includes(next)) return;
      filter = next;
      // 过滤 = 现有行按 data-kind 显示/隐藏（零重拼、页面自持 UI 状态不整页重建）；
      // 此后增量追加的新行由 update 按同一 filter 把关。
      const list = env.pageEl.querySelector<HTMLElement>('#jr-list');
      if (list) {
        for (const el of Array.from(list.children) as HTMLElement[]) {
          const kind = el.dataset.kind ?? '';
          el.style.display = filter === 'all' || kind === filter ? '' : 'none';
        }
      }
      for (const chip of env.pageEl.querySelectorAll<HTMLElement>('.jr-filters .chip')) {
        chip.classList.toggle('selected', chip.dataset.filter === filter);
      }
      return;
    }
    if (action === 'jr-anchor') {
      // 锚点重设：dispatch 后净收获/按钮文案由下一帧 update 轻刷（不整页重建）。
      env.dispatch({ type: 'journal:anchor' });
      env.render();
    }
  };

  return { id: 'journal', label: 'tabs.journal', render, update, handleAction };
}
