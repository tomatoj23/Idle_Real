/**
 * UI 层（issue #3）：只消费 engine 事件流 + snapshot，不触碰引擎内部。
 *
 * 结构一次搭建，点击走事件委托；动态区域按状态签名差量重绘，
 * 活动进度条/百分比每帧轻量更新。事件→日志/浮提示/重绘的接线
 * 在此统一完成（烟测走同一套路径）。
 */
import type { ContentPack } from '@wendao/content';
import {
  EventBus,
  expBase,
  expToNext,
  levelFromXp,
  playerMaxHp,
  type GameAction,
  type GameState,
  type SaveData,
} from '@wendao/engine';

export type TabId = 'skills' | 'bag' | 'shop';

export interface Ui {
  bindActions(handler: (action: GameAction) => void): void;
  /** 立即按 snapshot 重绘。 */
  render(): void;
  /** 事件驱动的合并重绘（rAF 去抖）。 */
  scheduleRender(): void;
  log(text: string, cls?: string): void;
  toast(text: string, kind?: 'gold' | 'red'): void;
}

const MAX_LOG = 40;

const fmtSeconds = (ms: number): string => {
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s} 秒` : `${s.toFixed(1)} 秒`;
};

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );

export function buildUi(
  root: HTMLElement,
  content: ContentPack,
  getSnapshot: () => SaveData,
  events: EventBus,
): Ui {
  const itemById = new Map(content.items.map((item) => [item.id, item]));
  const skillById = new Map(content.skills.map((skill) => [skill.id, skill]));
  const gatherSkills = content.skills.filter((skill) => skill.kind === 'gather');

  let activeTab: TabId = 'skills';
  let selectedSkillId = gatherSkills[0]?.id ?? '';
  let handler: ((action: GameAction) => void) | null = null;
  let lastSig = '';
  let rafId = 0;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="sigil sigil-brand">道</span><span class="brand-name">问道长生</span></div>
      <div class="res">
        <div class="res-item" title="灵石"><span class="sigil sigil-res">石</span><b id="res-gp">0</b></div>
        <div class="res-item" title="气血"><span class="sigil sigil-res sigil-hp">血</span><div class="hpbar"><i id="res-hp"></i></div><span id="res-hp-text"></span></div>
      </div>
    </header>
    <nav class="tabs" id="tabs">
      <button class="tab" data-act="tab" data-tab="skills">修炼</button>
      <button class="tab" data-act="tab" data-tab="bag">乾坤袋</button>
      <button class="tab" data-act="tab" data-tab="shop">坊市</button>
    </nav>
    <div class="layout">
      <main class="page-root" id="page-root"></main>
      <aside class="side">
        <h3 class="side-title">修行录</h3>
        <ul class="log" id="log"></ul>
      </aside>
    </div>
    <div class="toasts" id="toasts"></div>
  `;

  const $ = <T extends HTMLElement>(selector: string): T => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`UI 缺少节点 ${selector}`);
    return el;
  };
  const gpEl = $<HTMLElement>('#res-gp');
  const hpFill = $<HTMLElement>('#res-hp');
  const hpText = $<HTMLElement>('#res-hp-text');
  const pageEl = $<HTMLElement>('#page-root');
  const logEl = $<HTMLElement>('#log');
  const toastsEl = $<HTMLElement>('#toasts');
  const tabButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('#tabs .tab'));

  const nameOf = (id: unknown): string => itemById.get(String(id))?.name ?? String(id);

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !handler) return;
    switch (el.dataset.act) {
      case 'tab':
        activeTab = (el.dataset.tab ?? 'skills') as TabId;
        lastSig = '';
        render();
        break;
      case 'skill':
        if (el.dataset.disabled === 'y') break;
        selectedSkillId = el.dataset.skill ?? selectedSkillId;
        lastSig = '';
        render();
        break;
      case 'start':
        handler({
          type: 'activity:start',
          payload: { skillId: el.dataset.skill, index: Number(el.dataset.index) },
        });
        break;
      case 'stop':
        handler({ type: 'activity:stop' });
        break;
      case 'sell':
        handler({
          type: 'bag:sell',
          payload: { item: el.dataset.item, count: Number(el.dataset.count) },
        });
        break;
      case 'buy':
        handler({ type: 'shop:buy', payload: { item: el.dataset.item } });
        break;
    }
  });

  /* ---------- 事件流消费：日志 + 浮提示 + 合并重绘 ---------- */

  function scheduleRender(): void {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      render();
    });
  }

  events.subscribe((event) => {
    const data = event.data ?? {};
    switch (event.type) {
      case 'loot':
        if (data.source === 'byproduct') {
          log(`偶得 ${nameOf(data.item)}×${data.count}`, 't-jade');
        } else {
          log(`得 ${nameOf(data.item)}×${data.count}`);
        }
        break;
      case 'levelup':
        toast(`【${data.skillName}】修为精进，升至 ${data.level} 层`);
        log(`【${data.skillName}】升至 ${data.level} 层`, 't-gold');
        break;
      case 'sell':
        log(`卖出 ${data.itemName}×${data.count}，得 ${data.gained} 灵石`);
        break;
      case 'buy':
        log(`购入 ${data.itemName}×${data.count}，花去 ${data.cost} 灵石`);
        break;
      case 'reject':
        toast(String(data.message ?? '此路不通'), 'red');
        break;
      case 'offline-settled': {
        const seconds = Math.max(0, Math.floor(Number(data.seconds) || 0));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const away = h > 0 ? `${h} 时 ${m} 分` : m > 0 ? `${m} 分` : `${seconds} 秒`;
        const items = Object.entries((data.items ?? {}) as Record<string, number>)
          .map(([id, n]) => `${nameOf(id)}×${n}`)
          .join('、');
        toast(`离线 ${away}归来：${data.activityName} ×${data.cycles}`);
        log(
          `离线修行 ${away}：${items || '无所获'}${data.exp ? `，修为 +${data.exp}` : ''}`,
          't-gold',
        );
        break;
      }
    }
    scheduleRender();
  });

  /* ---------- 渲染 ---------- */

  const signature = (st: GameState): string =>
    JSON.stringify([
      activeTab,
      selectedSkillId,
      Math.floor(st.gp),
      Object.entries(st.items).sort(),
      Object.entries(st.skills).map(([id, p]) => [id, p.xp]).sort(),
      st.activity ? [st.activity.skillId, st.activity.index] : null,
    ]);

  function render(): void {
    const st = getSnapshot().state as unknown as GameState;

    gpEl.textContent = Math.floor(st.gp).toLocaleString('zh-CN');
    const cap = playerMaxHp(content, st.skills);
    hpFill.style.width = `${Math.max(0, Math.min(100, (st.hp / cap) * 100))}%`;
    hpText.textContent = `${Math.floor(st.hp)}/${cap}`;

    for (const el of tabButtons) {
      el.classList.toggle('active', el.dataset.tab === activeTab);
    }

    const sig = signature(st);
    if (sig !== lastSig) {
      lastSig = sig;
      renderPage(st);
    }
    updateActivityBars(st);
  }

  function renderPage(st: GameState): void {
    if (activeTab === 'skills') pageEl.innerHTML = renderSkills(st);
    else if (activeTab === 'bag') pageEl.innerHTML = renderBag(st);
    else pageEl.innerHTML = renderShop(st);
  }

  function renderSkills(st: GameState): string {
    const skill = skillById.get(selectedSkillId) ?? gatherSkills[0];
    if (!skill) return '<section class="page"><p class="empty">内容包中没有可修的技艺。</p></section>';

    const xp = st.skills[skill.id]?.xp ?? 0;
    const level = levelFromXp(xp);
    const need = expToNext(level);
    const into = xp - expBase(level);
    const expPct = Number.isFinite(need) ? Math.min(100, (into / need) * 100) : 100;

    const act = st.activity;
    const actSkill = act ? skillById.get(act.skillId) : undefined;
    const actDef = act ? actSkill?.activities?.[act.index] : undefined;
    const actPct = act && actDef ? Math.min(100, (act.progress / actDef.interval) * 100) : 0;

    const chips = content.skills
      .map((s) => {
        const locked = s.kind !== 'gather';
        const selected = s.id === skill.id;
        const lv = levelFromXp(st.skills[s.id]?.xp ?? 0);
        return `<button class="chip${selected ? ' selected' : ''}${locked ? ' locked' : ''}"
          data-act="skill" data-skill="${s.id}"${locked ? ' data-disabled="y"' : ''}>
          <span class="sigil sigil-sm">${esc(s.icon)}</span><span>${esc(s.name)}</span>
          ${locked ? '<em class="chip-lock">未开放</em>' : `<b class="chip-lv">${lv} 层</b>`}
        </button>`;
      })
      .join('');

    const statusCard = `
      <section class="status-card">
        <span class="sigil sigil-big">${esc(skill.icon)}</span>
        <div class="status-main">
          <div class="status-head">
            <b>${esc(skill.name)}</b><span class="status-lv">${level} 层</span>
            ${skill.description ? `<span class="status-desc">${esc(skill.description)}</span>` : ''}
          </div>
          <div class="bar"><i style="width:${expPct}%"></i></div>
          <div class="status-sub">${
            Number.isFinite(need)
              ? `修为 ${into}/${need} · 距下一层还需 ${Math.max(0, Math.ceil(need - into))}`
              : '修为已臻化境'
          }</div>
        </div>
        <div class="status-act">
          ${
            act && actDef
              ? `<div class="act-now"><span>当前 · ${esc(actDef.name)}</span><b data-act-pct data-key="${act.skillId}:${act.index}">${Math.floor(actPct)}%</b></div>
                 <div class="bar bar-jade"><i data-bar="activity" data-key="${act.skillId}:${act.index}" style="width:${actPct}%"></i></div>
                 <button class="btn btn-ghost" data-act="stop">收功</button>`
              : '<div class="act-now idle"><span>闲坐蒲团，未修行</span></div>'
          }
        </div>
      </section>`;

    const cards = (skill.activities ?? [])
      .map((a, i) => {
        const unlocked = level >= a.unlockLevel;
        const running = act?.skillId === skill.id && act.index === i;
        const out = itemById.get(a.output.item);
        const bonus = a.byproduct ? itemById.get(a.byproduct.item) : undefined;
        const pct = running && act ? Math.min(100, (act.progress / a.interval) * 100) : 0;
        return `<article class="act-card${running ? ' running' : ''}${unlocked ? '' : ' locked'}">
          <header><b>${esc(a.name)}</b>${running ? '<em class="act-badge">进行中</em>' : ''}</header>
          <div class="act-yield">
            <span class="sigil sigil-sm">${esc(out?.icon ?? '？')}</span> ${esc(out?.name ?? a.output.item)} ×${a.output.count}
            ${a.byproduct ? `<span class="act-bonus">偶得 ${esc(bonus?.icon ?? '？')} ${esc(bonus?.name ?? a.byproduct.item)} ${Math.round(a.byproduct.chance * 100)}%</span>` : ''}
          </div>
          <div class="act-meta">${fmtSeconds(a.interval)} / 次 · 修为 +${a.exp} · 需 ${a.unlockLevel} 层</div>
          <div class="bar bar-thin"><i data-bar="activity" data-key="${skill.id}:${i}" style="width:${pct}%"></i></div>
          ${
            unlocked
              ? running
                ? ''
                : `<button class="btn" data-act="start" data-skill="${skill.id}" data-index="${i}">开始</button>`
              : `<span class="act-lockmsg">需 ${a.unlockLevel} 层</span>`
          }
        </article>`;
      })
      .join('');

    return `
      <section class="page">
        <div class="chips">${chips}</div>
        ${statusCard}
        <div class="act-grid">${cards}</div>
      </section>`;
  }

  function renderBag(st: GameState): string {
    const owned = content.items.filter((item) => (st.items[item.id] ?? 0) > 0);
    const groups: Array<{ title: string; types: readonly string[] }> = [
      { title: '材料', types: ['mat'] },
      { title: '丹药', types: ['pill'] },
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
              <span class="bag-price">每件 ${item.sell} 灵石</span>
              <span class="bag-ops">
                <button class="btn" data-act="sell" data-item="${item.id}" data-count="1">卖一</button>
                <button class="btn btn-ghost" data-act="sell" data-item="${item.id}" data-count="${count}">全卖</button>
              </span>
            </div>`;
          })
          .join('');
        return rows ? `<h3 class="group-title">${title}</h3>${rows}` : '';
      })
      .join('');
    return `<section class="page"><h2 class="page-title">乾坤袋</h2>${body || '<p class="empty">乾坤袋空空如也——先去「修炼」采些灵材。</p>'}</section>`;
  }

  function renderShop(st: GameState): string {
    const rows = content.shop
      .map((entry) => {
        const item = itemById.get(entry.item);
        const owned = st.items[entry.item] ?? 0;
        const afford = st.gp >= entry.price;
        return `<div class="bag-row">
          <span class="sigil sigil-sm">${esc(item?.icon ?? '？')}</span>
          <span class="bag-name">${esc(item?.name ?? entry.item)}<small>${esc(item?.description ?? '')}</small></span>
          <b class="bag-price">${entry.price} 灵石</b>
          <span class="bag-count">持有 ${owned}</span>
          <span class="bag-ops"><button class="btn${afford ? '' : ' btn-disabled'}" data-act="buy" data-item="${entry.item}">买一</button></span>
        </div>`;
      })
      .join('');
    return `<section class="page"><h2 class="page-title">坊市</h2><p class="page-sub">以灵石易物，解燃眉之需。</p>${rows}</section>`;
  }

  function updateActivityBars(st: GameState): void {
    // 进度条按 活动 键控：只有正在进行的卡片充能，其余归零。
    let key = '';
    let pct = 0;
    if (st.activity) {
      const def = skillById.get(st.activity.skillId)?.activities?.[st.activity.index];
      if (def) {
        key = `${st.activity.skillId}:${st.activity.index}`;
        pct = Math.min(100, (st.activity.progress / def.interval) * 100);
      }
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-bar="activity"]')) {
      el.style.width = `${el.dataset.key === key ? pct : 0}%`;
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-act-pct]')) {
      el.textContent = `${el.dataset.key === key ? Math.floor(pct) : 0}%`;
    }
  }

  /* ---------- 日志与浮提示 ---------- */

  function log(text: string, cls = ''): void {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.textContent = text;
    logEl.prepend(li);
    while (logEl.children.length > MAX_LOG) logEl.lastElementChild?.remove();
  }

  function toast(text: string, kind: 'gold' | 'red' = 'gold'): void {
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = text;
    toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  return {
    bindActions(fn) {
      handler = fn;
    },
    render,
    scheduleRender,
    log,
    toast,
  };
}
