/**
 * UI 层（issue #3）：只消费 engine 事件流 + snapshot + content 包视图，不触碰引擎内部。
 *
 * 结构一次搭建，点击走事件委托；动态区域按状态签名差量重绘，
 * 活动进度条/百分比每帧轻量更新。事件→日志/浮提示/重绘的接线
 * 在此统一完成（烟测走同一套路径）。
 *
 * #26（ADR-017 裁决 9：壳零题材字符串、零公式复算）：
 * - 全部题材文案来自 content 包 texts.shell 节；缺键回显键名
 *   （ADR-016 裁决 ④ 防御路径，与引擎 rejectText 同策略）；
 * - 装备倍率投影走引擎 projectGearBase、坊市购买力走 shopAffordOf
 *   （与引擎判定同式同源，禁壳内复制公式）；
 * - stat 展示标签与量纲标记（percent）由 texts.shell.stats.labels
 *   显式声明，壳零量纲特判（#26 票评）。
 */
import type { ContentPack } from '@wendao/content';
import {
  EventBus,
  enemyGateOf,
  expBase,
  expToNext,
  fillTemplate,
  findRarity,
  gearName,
  levelFromXp,
  progressionParamsOf,
  projectGearBase,
  shopAffordOf,
  type GameAction,
  type GameState,
  type GearInstance,
  type ProgressionParams,
  type SaveData,
} from '@wendao/engine';

export type TabId = 'skills' | 'combat' | 'bag' | 'shop';

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
const MAX_FLOG = 60;

export const esc = (text: string): string =>
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
  const combatSkillId = content.skills.find((skill) => skill.kind === 'combat')?.id ?? '';

  // 稀有度词表由内容包 rarities 节驱动（#018，ADR-016 裁决 ①/④）：
  // 档名/着色类/倍率来源/特判全部查内容 def，UI 零档位词、零引擎常量表；
  // 档位解析（命中→缺档回退第一档→空表 undefined）直接复用引擎 findRarity，
  // 空表按中性值降级（r-none 着色、省略档名前缀）。
  const rarityDefOf = (rarity: string) => findRarity(content, rarity);

  // 修为曲线参数与内容包同源（#020）：UI 只传参，不复制曲线系数。
  const prog: ProgressionParams = progressionParamsOf(content);

  /* ---------- texts.shell 词表读取（#26） ---------- */

  const shellRoot = (content as { texts?: { shell?: unknown } }).texts?.shell;
  const shellGet = (path: string): unknown =>
    path.split('.').reduce<unknown>(
      (node, key) =>
        node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      shellRoot,
    );
  /** 取词 + {slot} 填槽（fillTemplate 同一约定）；缺键回显键名（防御可见）。 */
  const T = (key: string, vars?: Readonly<Record<string, string | number>>): string => {
    const raw = shellGet(key);
    if (typeof raw !== 'string' || raw.length === 0) return key;
    const slots: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars ?? {})) slots[k] = String(v);
    return fillTemplate(raw, slots);
  };

  // 展示 locale（brand.locale）：千分位格式化与文档语言的单一来源；
  // 非法值中性回落 'en'（防御路径，语言标签 schema 层已钉形态）。
  const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
  const rawLocale = shellGet('brand.locale');
  const locale = typeof rawLocale === 'string' && LOCALE_RE.test(rawLocale) ? rawLocale : 'en';

  /**
   * stat 展示标签与量纲（#26 票评，循 ADR-016 裁决 ④ 显式 bool 先例）：
   * label/percent 由 texts.shell.stats.labels 声明，壳零特判；
   * 未注册 stat 回退 stat 键名展示（开放键域防御路径）。
   */
  const statLabelOf = (stat: string): { label: string; percent: boolean } => {
    const def = shellGet(`stats.labels.${stat}`);
    const shape = def !== null && typeof def === 'object' ? (def as Record<string, unknown>) : undefined;
    const label = typeof shape?.label === 'string' && shape.label.length > 0 ? shape.label : stat;
    return { label, percent: shape?.percent === true };
  };
  /** 面板数值 + 量纲后缀（顶栏/斗法页属性行）。 */
  const statValueText = (stat: string, value: number | string): string =>
    `${value}${statLabelOf(stat).percent ? '%' : ''}`;
  /** 加成行「标签+值+量纲」（装备卡基础/词条行）。 */
  const statBonusText = (stat: string, value: number | string): string => {
    const { label, percent } = statLabelOf(stat);
    return `${label}+${value}${percent ? '%' : ''}`;
  };

  let activeTab: TabId = 'skills';
  let selectedSkillId = gatherSkills[0]?.id ?? '';
  let handler: ((action: GameAction) => void) | null = null;
  let lastSig = '';
  let rafId = 0;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="sigil sigil-brand">${esc(T('brand.sigil'))}</span><span class="brand-name">${esc(T('brand.name'))}</span></div>
      <div class="res">
        <div class="res-item" title="${esc(T('topbar.statsTitle'))}"><span class="sigil sigil-res">${esc(T('topbar.statsSigil'))}</span><b id="res-stats"></b></div>
        <div class="res-item" title="${esc(T('topbar.goldTitle'))}"><span class="sigil sigil-res">${esc(T('topbar.goldSigil'))}</span><b id="res-gold">0</b></div>
        <div class="res-item" title="${esc(T('topbar.hpTitle'))}"><span class="sigil sigil-res sigil-hp">${esc(T('topbar.hpSigil'))}</span><div class="hpbar"><i id="res-hp"></i></div><span id="res-hp-text"></span></div>
      </div>
    </header>
    <div class="buffbar" id="buffbar"></div>
    <nav class="tabs" id="tabs">
      <button class="tab" data-act="tab" data-tab="skills">${esc(T('tabs.skills'))}</button>
      <button class="tab" data-act="tab" data-tab="combat">${esc(T('tabs.combat'))}</button>
      <button class="tab" data-act="tab" data-tab="bag">${esc(T('tabs.bag'))}</button>
      <button class="tab" data-act="tab" data-tab="shop">${esc(T('tabs.shop'))}</button>
    </nav>
    <div class="layout">
      <main class="page-root" id="page-root"></main>
      <aside class="side">
        <h3 class="side-title">${esc(T('side.title'))}</h3>
        <ul class="log" id="log"></ul>
      </aside>
    </div>
    <div class="toasts" id="toasts"></div>
  `;

  const $ = <T extends HTMLElement>(selector: string): T => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`UI missing node ${selector}`);
    return el;
  };
  const goldEl = $<HTMLElement>('#res-gold');
  const statsEl = $<HTMLElement>('#res-stats');
  const hpFill = $<HTMLElement>('#res-hp');
  const hpText = $<HTMLElement>('#res-hp-text');
  const buffbarEl = $<HTMLElement>('#buffbar');
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
      case 'fight':
        handler({ type: 'combat:start', payload: { enemyId: el.dataset.enemy } });
        break;
      case 'flee':
        handler({ type: 'combat:stop' });
        break;
      case 'toggle-auto':
        handler({ type: 'combat:auto' });
        break;
      case 'toggle-auto-eat':
        handler({ type: 'combat:auto-eat' });
        break;
      case 'eat':
        handler({ type: 'consumable:eat', payload: { item: el.dataset.item } });
        break;
      case 'wear':
        handler({ type: 'gear:equip', payload: { uid: Number(el.dataset.uid) } });
        break;
      case 'take-off':
        handler({ type: 'gear:unequip', payload: { slot: el.dataset.slot } });
        break;
      case 'sell-gear':
        handler({ type: 'gear:sell', payload: { uid: Number(el.dataset.uid) } });
        break;
    }
  });

  /* ---------- 事件流消费：日志 + 浮提示 + 合并重绘 ---------- */

  /** 秒时长读数（units.seconds 模板，{v} 槽）。 */
  const fmtSeconds = (ms: number): string => {
    const s = ms / 1000;
    return T('units.seconds', { v: Number.isInteger(s) ? String(s) : s.toFixed(1) });
  };

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
        if (data.source === 'gear') {
          flog(T('events.lootGear', { name: String(data.itemName ?? '') }), 't-gold');
          log(T('events.lootGearLog', { name: String(data.itemName ?? '') }), 't-gold');
          // 天降异宝特判由内容 def 的 showcase bool 驱动（ADR-016 裁决 ④）。
          if (rarityDefOf(String(data.rarity))?.showcase) {
            toast(T('events.lootShowcase', { name: String(data.itemName ?? '') }));
          }
        } else if (data.source === 'byproduct') {
          log(T('events.lootByproduct', { name: nameOf(data.item), count: Number(data.count ?? 0) }));
        } else if (data.source === 'drop') {
          log(T('events.lootDrop', { name: nameOf(data.item), count: Number(data.count ?? 0) }));
        }
        break;
      case 'attack':
        // 战斗叙事：完整文案入战斗日志（伤害已嵌入 {d} 槽，非干瘪直出）
        flog(String(data.text ?? ''), data.side === 'player' ? (data.crit ? 't-gold' : 't-jade') : 't-red');
        break;
      case 'combat-note':
        flog(String(data.text ?? ''), 't-sys');
        break;
      case 'victory': {
        const compare = data.compare ? T('common.compareWrap', { compare: String(data.compare) }) : '';
        const victoryVars = { name: String(data.enemyName ?? ''), summary: String(data.summary ?? ''), compare };
        flog(T('events.victoryFlog', victoryVars), 't-gold');
        log(T('events.victoryLog', victoryVars), 't-gold');
        break;
      }
      case 'defeat':
        flog(T('events.defeatFlog', { name: String(data.enemyName ?? '') }), 't-red');
        toast(T('events.defeatToast'), 'red');
        break;
      case 'consumable:eat':
        if (data.kind === 'heal') {
          flog(T('events.eatHeal', { name: String(data.itemName ?? ''), healed: Number(data.healed ?? 0) }), 't-sys');
        } else {
          toast(T('events.eatBuffToast', { name: String(data.itemName ?? '') }));
          log(T('events.eatBuffLog', { name: String(data.itemName ?? ''), minutes: Number(data.minutes ?? 0) }), 't-jade');
        }
        break;
      case 'equip:wear':
        toast(T('events.equipWearToast', { name: String(data.name ?? '') }));
        log(T('events.equipWearLog', { name: String(data.name ?? '') }), 't-jade');
        break;
      case 'equip:remove':
        log(T('events.equipRemoveLog', { name: String(data.name ?? '') }));
        break;
      case 'exp':
        // 引擎 exp 事件的数值字段是 amount（grantExp 载荷），非 exp。
        if (data.skillId === combatSkillId) flog(T('events.expCombat', { amount: Number(data.amount ?? 0) }), 't-sys');
        break;
      case 'levelup':
        toast(T('events.levelupToast', { name: String(data.skillName ?? ''), level: Number(data.level ?? 0) }));
        log(T('events.levelupLog', { name: String(data.skillName ?? ''), level: Number(data.level ?? 0) }), 't-gold');
        break;
      case 'sell':
        log(T('events.sellLog', { name: String(data.itemName ?? ''), gained: Number(data.gained ?? 0) }));
        break;
      case 'buy':
        log(T('events.buyLog', { name: String(data.itemName ?? ''), count: Number(data.count ?? 0), cost: Number(data.cost ?? 0) }));
        break;
      case 'reject':
        toast(String(data.message ?? T('events.rejectFallback')), 'red');
        break;
      case 'offline-settled': {
        const seconds = Math.max(0, Math.floor(Number(data.seconds) || 0));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const away =
          h > 0
            ? T('units.hourMinute', { h, m })
            : m > 0
              ? T('units.minute', { m })
              : T('units.seconds', { v: seconds });
        const items = Object.entries((data.items ?? {}) as Record<string, number>)
          .map(([id, n]) => `${nameOf(id)}×${n}`)
          .join(T('common.itemListSep'));
        toast(T('events.offlineToast', { away, activity: String(data.activityName ?? ''), cycles: Number(data.cycles ?? 0) }));
        log(
          T('events.offlineLog', {
            away,
            items: items || T('events.offlineNoYield'),
            exp: data.exp ? T('events.offlineExpSuffix', { exp: Number(data.exp) }) : '',
          }),
          't-gold',
        );
        break;
      }
    }
    scheduleRender();
  });

  /* ---------- 渲染 ---------- */

  const signature = (st: GameState, snap: SaveData): string =>
    JSON.stringify([
      activeTab,
      selectedSkillId,
      Math.floor(st.gold),
      Object.entries(st.items).sort(),
      Object.entries(st.skills).map(([id, p]) => [id, p.xp]).sort(),
      st.activity ? [st.activity.skillId, st.activity.index] : null,
      st.combat ? [st.combat.enemyId, Math.floor(st.combat.ehp), st.combat.respT > 0] : null,
      Object.entries(st.equips),
      st.gear.length,
      st.gearSeq,
      Object.keys(st.buffs).sort(),
      st.autoFight,
      st.autoEat,
      Object.keys(st.lastEncounter).length,
      snap.stats ?? null,
    ]);

  function render(): void {
    const snap = getSnapshot();
    const st = snap.state as unknown as GameState;

    goldEl.textContent = Math.floor(st.gold).toLocaleString(locale);
    const cap = snap.stats?.maxHp ?? Math.max(1, Math.floor(st.hp));
    hpFill.style.width = `${Math.max(0, Math.min(100, (st.hp / cap) * 100))}%`;
    hpText.textContent = `${Math.floor(st.hp)}/${cap}`;
    if (snap.stats) {
      // 属性行读引擎快照 + 内容量纲标记（#26 票评：壳零量纲特判）。
      statsEl.textContent = [
        statValueText('atk', snap.stats.atk),
        statValueText('def', snap.stats.def),
        statValueText('crit', snap.stats.crit),
      ].join('/');
    }
    renderBuffbar(st, snap.time);

    for (const el of tabButtons) {
      el.classList.toggle('active', el.dataset.tab === activeTab);
    }

    const sig = signature(st, snap);
    if (sig !== lastSig) {
      lastSig = sig;
      renderPage(st, snap);
    }
    updateActivityBars(st);
    updateEnemyBar(st);
    syncFlogScroll();
  }

  /** 顶栏增益条：剩余时长轻量刷新（每帧），结构变化由 signature 驱动。 */
  function renderBuffbar(st: GameState, now: number): void {
    const entries = Object.entries(st.buffs);
    if (buffbarEl.childElementCount !== entries.length) {
      buffbarEl.innerHTML = entries
        .map(([id]) => {
          const item = itemById.get(id);
          return `<span class="buff-chip" data-buff="${id}">${esc(item?.icon ?? T('icons.buff'))} ${esc(item?.name ?? id)} <b></b></span>`;
        })
        .join('');
    }
    for (const el of Array.from(buffbarEl.children) as HTMLElement[]) {
      const id = el.dataset.buff ?? '';
      const left = Math.max(0, Math.ceil(((st.buffs[id] ?? 0) - now) / 1000));
      const label = el.querySelector('b');
      if (label) {
        label.textContent = left >= 60 ? T('units.minute', { m: Math.floor(left / 60) }) : T('units.seconds', { v: left });
      }
    }
  }

  function renderPage(st: GameState, snap: SaveData): void {
    if (activeTab === 'skills') pageEl.innerHTML = renderSkills(st);
    else if (activeTab === 'combat') pageEl.innerHTML = renderCombat(st, snap);
    else if (activeTab === 'bag') pageEl.innerHTML = renderBag(st);
    else pageEl.innerHTML = renderShop(st);
    if (activeTab === 'combat') {
      // 页面重建会丢滚动位置与日志内容：全量重放战斗日志并恢复到底部。
      const box = pageEl.querySelector<HTMLElement>('#flog');
      if (box) {
        box.innerHTML = '';
        for (const line of flogBuffer) appendFlogLine(box, line.text, line.cls);
      }
      syncFlogScroll();
    }
  }

  function renderSkills(st: GameState): string {
    const skill = skillById.get(selectedSkillId) ?? gatherSkills[0];
    if (!skill) return `<section class="page"><p class="empty">${esc(T('pages.skills.empty'))}</p></section>`;

    const xp = st.skills[skill.id]?.xp ?? 0;
    const level = levelFromXp(xp, prog);
    const need = expToNext(level, prog);
    const into = xp - expBase(level, prog);
    const expPct = Number.isFinite(need) ? Math.min(100, (into / need) * 100) : 100;

    const act = st.activity;
    const actSkill = act ? skillById.get(act.skillId) : undefined;
    const actDef = act ? actSkill?.activities?.[act.index] : undefined;
    const actPct = act && actDef ? Math.min(100, (act.progress / actDef.interval) * 100) : 0;

    const chips = content.skills
      .map((s) => {
        const locked = s.kind !== 'gather';
        const selected = s.id === skill.id;
        const lv = levelFromXp(st.skills[s.id]?.xp ?? 0, prog);
        return `<button class="chip${selected ? ' selected' : ''}${locked ? ' locked' : ''}"
          data-act="skill" data-skill="${s.id}"${locked ? ' data-disabled="y"' : ''}>
          <span class="sigil sigil-sm">${esc(s.icon)}</span><span>${esc(s.name)}</span>
          ${locked ? `<em class="chip-lock">${esc(T('pages.skills.chipLocked'))}</em>` : `<b class="chip-lv">${esc(T('units.level', { v: lv }))}</b>`}
        </button>`;
      })
      .join('');

    const statusCard = `
      <section class="status-card">
        <span class="sigil sigil-big">${esc(skill.icon)}</span>
        <div class="status-main">
          <div class="status-head">
            <b>${esc(skill.name)}</b><span class="status-lv">${esc(T('units.level', { v: level }))}</span>
            ${skill.description ? `<span class="status-desc">${esc(skill.description)}</span>` : ''}
          </div>
          <div class="bar"><i style="width:${expPct}%"></i></div>
          <div class="status-sub">${
            Number.isFinite(need)
              ? esc(T('pages.skills.expSub', { into, need, left: Math.max(0, Math.ceil(need - into)) }))
              : esc(T('pages.skills.expMax'))
          }</div>
        </div>
        <div class="status-act">
          ${
            act && actDef
              ? `<div class="act-now"><span>${esc(T('pages.skills.actNow', { name: actDef.name }))}</span><b data-act-pct data-key="${act.skillId}:${act.index}">${Math.floor(actPct)}%</b></div>
                 <div class="bar bar-jade"><i data-bar="activity" data-key="${act.skillId}:${act.index}" style="width:${actPct}%"></i></div>
                 <button class="btn btn-ghost" data-act="stop">${esc(T('pages.skills.stopBtn'))}</button>`
              : `<div class="act-now idle"><span>${esc(T('pages.skills.idle'))}</span></div>`
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
          <header><b>${esc(a.name)}</b>${running ? `<em class="act-badge">${esc(T('pages.skills.running'))}</em>` : ''}</header>
          <div class="act-yield">
            <span class="sigil sigil-sm">${esc(out?.icon ?? T('icons.unknown'))}</span> ${esc(out?.name ?? a.output.item)} ×${a.output.count}
            ${a.byproduct ? `<span class="act-bonus">${esc(T('pages.skills.byproduct', { icon: bonus?.icon ?? T('icons.unknown'), name: bonus?.name ?? a.byproduct.item, chance: Math.round(a.byproduct.chance * 100) }))}</span>` : ''}
          </div>
          <div class="act-meta">${esc(T('pages.skills.actMeta', { interval: fmtSeconds(a.interval), exp: a.exp, level: a.unlockLevel }))}</div>
          <div class="bar bar-thin"><i data-bar="activity" data-key="${skill.id}:${i}" style="width:${pct}%"></i></div>
          ${
            unlocked
              ? running
                ? ''
                : `<button class="btn" data-act="start" data-skill="${skill.id}" data-index="${i}">${esc(T('pages.skills.startBtn'))}</button>`
              : `<span class="act-lockmsg">${esc(T('common.needLevel', { level: a.unlockLevel }))}</span>`
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

  /* ---------- 斗法页（issue #4） ---------- */

  /** 战斗日志内存缓冲：页面未挂载时暂存，进页全量重放（容量受控）。 */
  const flogBuffer: Array<{ text: string; cls: string }> = [];

  function flog(text: string, cls = ''): void {
    flogBuffer.push({ text, cls });
    if (flogBuffer.length > MAX_FLOG) flogBuffer.splice(0, flogBuffer.length - MAX_FLOG);
    const el = pageEl.querySelector<HTMLElement>('#flog');
    if (el) {
      appendFlogLine(el, text, cls);
      syncFlogScroll();
    }
  }

  function appendFlogLine(box: HTMLElement, text: string, cls: string): void {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    box.appendChild(div);
    while (box.children.length > MAX_FLOG) box.firstElementChild?.remove();
  }

  /** 战斗日志自动滚底（旧版踩坑回归：页面重建后必须恢复到底部）。 */
  function syncFlogScroll(): void {
    const el = pageEl.querySelector<HTMLElement>('#flog');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function renderCombat(st: GameState, snap: SaveData): string {
    const combat = st.combat;
    // N2 修复（#018）：斗法修为读数按 combatSkillId 解析，禁硬编码内容 id。
    const clv = levelFromXp(st.skills[combatSkillId]?.xp ?? 0, prog);
    const sep = T('common.itemListSep');

    const consumables = content.items
      .filter((item) => item.type === 'consumable' && (st.items[item.id] ?? 0) > 0)
      .map(
        (item) =>
          `<button class="btn btn-consumable" data-act="eat" data-item="${item.id}">${esc(item.icon)} ${esc(item.name)} ×${st.items[item.id]}</button>`,
      )
      .join('');

    const toggles = `
      <div class="combat-toggles">
        <button class="btn btn-ghost${st.autoFight ? ' on' : ''}" data-act="toggle-auto">${esc(T(st.autoFight ? 'pages.combat.autoFightOn' : 'pages.combat.autoFightOff'))}</button>
        <button class="btn btn-ghost${st.autoEat ? ' on' : ''}" data-act="toggle-auto-eat">${esc(T(st.autoEat ? 'pages.combat.autoEatOn' : 'pages.combat.autoEatOff'))}</button>
      </div>`;

    if (combat) {
      const enemy = content.enemies.find((entry) => entry.id === combat.enemyId);
      if (!enemy) return `<section class="page"><p class="empty">${esc(T('pages.combat.enemyMissing'))}</p></section>`;
      const ehpPct = Math.max(0, Math.min(100, (combat.ehp / enemy.hp) * 100));
      const resting = combat.respT > 0;
      const hpPct = Math.max(0, Math.min(100, (st.hp / (snap.stats?.maxHp ?? enemy.hp)) * 100));
      return `
        <section class="page">
          <h2 class="page-title">${esc(T('pages.combat.title'))}</h2>
          <article class="enemy-card fighting">
            <div class="enemy-face"><span class="sigil sigil-big">${esc(enemy.icon)}</span></div>
            <div class="enemy-main">
              <div class="enemy-head"><b>${esc(enemy.name)}</b><span class="enemy-lv">${esc(T('units.level', { v: enemy.level }))}</span>${resting ? `<em class="act-badge">${esc(T('pages.combat.resting'))}</em>` : ''}</div>
              <div class="bar bar-red"><i data-bar="enemy" style="width:${ehpPct}%"></i></div>
              <div class="enemy-sub">${esc(T('pages.combat.enemyHp', { ehp: Math.max(0, Math.ceil(combat.ehp)), hp: enemy.hp }))}</div>
              <div class="bar bar-jade"><i style="width:${hpPct}%"></i></div>
              <div class="enemy-sub">${esc(T('pages.combat.selfStats', { hp: Math.floor(st.hp), max: snap.stats?.maxHp ?? '—', atk: statValueText('atk', snap.stats?.atk ?? '—'), def: statValueText('def', snap.stats?.def ?? '—'), crit: statValueText('crit', snap.stats?.crit ?? '—') }))}</div>
            </div>
            <div class="enemy-ops">
              <button class="btn btn-ghost" data-act="flee">${esc(T('pages.combat.fleeBtn'))}</button>
            </div>
          </article>
          ${toggles}
          ${consumables ? `<div class="consumable-bar">${consumables}</div>` : `<p class="page-sub">${esc(T('pages.combat.noConsumables'))}</p>`}
          <div class="flog" id="flog"></div>
        </section>`;
    }

    const cards = content.enemies
      .map((enemy) => {
        // 开战门控走引擎 enemyGateOf（N1 收敛，#020）：锁定判定与需层数展示
        // 与引擎 combat:start 判定同源，UI 零公式复算。
        const gate = enemyGateOf(content, st.skills, enemy.id);
        const gold = enemy.gold ?? { min: 0, max: 0 };
        const drops = (enemy.drops ?? [])
          .map((drop) => itemById.get(drop.item)?.name ?? drop.item)
          .slice(0, 3)
          .join(sep);
        return `<article class="enemy-card${gate.locked ? ' locked' : ''}">
          <div class="enemy-face"><span class="sigil sigil-big">${esc(enemy.icon)}</span></div>
          <div class="enemy-main">
            <div class="enemy-head"><b>${esc(enemy.name)}</b><span class="enemy-lv">${esc(T('units.level', { v: enemy.level }))}</span></div>
            <div class="enemy-sub">${esc(T('pages.combat.enemyStats', { hp: enemy.hp, atk: enemy.atk, def: enemy.def, exp: enemy.exp }))}</div>
            <div class="enemy-sub">${esc(T('pages.combat.enemyGold', { min: gold.min, max: gold.max }))}${drops ? esc(T('pages.combat.dropsSuffix', { drops })) : ''}</div>
          </div>
          <div class="enemy-ops">
            ${
              gate.locked
                ? `<span class="act-lockmsg">${esc(T('common.needLevel', { level: gate.requiredLevel }))}</span>`
                : `<button class="btn" data-act="fight" data-enemy="${enemy.id}">${esc(T('pages.combat.fightBtn'))}</button>`
            }
          </div>
        </article>`;
      })
      .join('');

    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.combat.title'))}</h2>
        <p class="page-sub">${esc(T('pages.combat.subtitle', { level: clv }))}</p>
        <div class="enemy-grid">${cards}</div>
        <div class="consumable-bar">${consumables || ''}</div>
      </section>`;
  }

  /* ---------- 乾坤袋：装备实例卡 ---------- */

  /** 着色类 = `r-${档位 id}`（def 驱动）；缺档回退第一档；空表 r-none。 */
  const rarityClass = (rarity: string): string => {
    const def = rarityDefOf(rarity);
    return def ? `r-${def.id}` : 'r-none';
  };
  const rarityName = (rarity: string): string => rarityDefOf(rarity)?.name ?? '';

  function gearCardHtml(st: GameState, gear: GearInstance): string {
    const item = itemById.get(gear.itemId);
    const worn = Object.entries(st.equips).find(([, uid]) => uid === gear.uid);
    // 倍率投影走引擎 projectGearBase（#26 三处复算债收敛）：round(基础 × 档位倍率)
    // 与实例化/属性聚合同式同源，UI 零 ×mult 公式；标签/量纲查 statLabels。
    const baseRows = projectGearBase(content, item?.bonuses ?? {}, gear.rarity)
      .map(({ stat, value }) => esc(statBonusText(stat, value)));
    const affixRows = gear.affixes.map(
      (a) => `<span class="txt-dim">${esc(a.name)}</span> ${esc(statBonusText(a.stat, a.val))}`,
    );
    const rows = [...baseRows, ...affixRows].join(esc(T('common.itemListSep'))) || esc(T('pages.bag.noAffix'));
    // 展示名走引擎 gearName（#26：「档名·物品名」拼接单一来源；缺档名省略前缀）。
    const displayName = gearName(content, item?.name ?? gear.itemId, gear.rarity);
    return `<div class="gear-card ${rarityClass(gear.rarity)}">
      <span class="sigil sigil-sm">${esc(item?.icon ?? T('icons.gear'))}</span>
      <span class="gear-name">${esc(displayName)}<small>${rows}</small></span>
      <span class="bag-ops">
        ${worn
          ? `<button class="btn btn-ghost" data-act="take-off" data-slot="${worn[0]}">${esc(T('pages.bag.takeOffBtn'))}</button>`
          : `<button class="btn" data-act="wear" data-uid="${gear.uid}">${esc(T('pages.bag.wearBtn'))}</button>`}
        ${worn ? '' : `<button class="btn btn-ghost" data-act="sell-gear" data-uid="${gear.uid}">${esc(T('pages.bag.sellBtn'))}</button>`}
      </span>
    </div>`;
  }

  function renderBag(st: GameState): string {
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
    const worn = Object.entries(st.equips)
      .map(([slot, uid]) => st.gear.find((entry) => entry.uid === uid))
      .filter((gear): gear is NonNullable<typeof gear> => gear !== undefined)
      .map((gear) => gearCardHtml(st, gear))
      .join('');
    const loose = st.gear
      .filter((gear) => !Object.values(st.equips).includes(gear.uid))
      .map((gear) => gearCardHtml(st, gear))
      .join('');
    const gearSection =
      worn || loose
        ? `<h3 class="group-title">${esc(T('pages.bag.gearWorn'))}</h3>${worn || `<p class="empty">${esc(T('pages.bag.emptyWorn'))}</p>`}
           <h3 class="group-title">${esc(T('pages.bag.gearLoose'))}</h3>${loose || `<p class="empty">${esc(T('pages.bag.emptyLoose'))}</p>`}`
        : '';
    return `<section class="page"><h2 class="page-title">${esc(T('pages.bag.title'))}</h2>${body}${gearSection || `<p class="empty">${esc(T('pages.bag.emptyAll'))}</p>`}</section>`;
  }

  function renderShop(st: GameState): string {
    const rows = content.shop
      .map((entry) => {
        const item = itemById.get(entry.item);
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
  }

  /** 敌方血条轻量更新（战斗页存在时每帧刷新）。 */
  function updateEnemyBar(st: GameState): void {
    const bar = pageEl.querySelector<HTMLElement>('[data-bar="enemy"]');
    if (!bar || !st.combat) return;
    const enemy = content.enemies.find((entry) => entry.id === st.combat?.enemyId);
    if (!enemy) return;
    bar.style.width = `${Math.max(0, Math.min(100, (st.combat.ehp / enemy.hp) * 100))}%`;
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
