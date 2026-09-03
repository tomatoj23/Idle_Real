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
  findRarity,
  levelFromXp,
  type GameAction,
  type GameState,
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
  const combatSkillId = content.skills.find((skill) => skill.kind === 'combat')?.id ?? '';

  // 稀有度词表由内容包 rarities 节驱动（#018，ADR-016 裁决 ①/④）：
  // 档名/着色类/倍率来源/特判全部查内容 def，UI 零档位词、零引擎常量表；
  // 档位解析（命中→缺档回退第一档→空表 undefined）直接复用引擎 findRarity，
  // 空表按中性值降级（r-none 着色、省略档名前缀）。
  const rarityDefOf = (rarity: string) => findRarity(content, rarity);

  let activeTab: TabId = 'skills';
  let selectedSkillId = gatherSkills[0]?.id ?? '';
  let handler: ((action: GameAction) => void) | null = null;
  let lastSig = '';
  let rafId = 0;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="sigil sigil-brand">道</span><span class="brand-name">问道长生</span></div>
      <div class="res">
        <div class="res-item" title="攻 / 防 / 会心"><span class="sigil sigil-res">斗</span><b id="res-stats"></b></div>
        <div class="res-item" title="灵石"><span class="sigil sigil-res">石</span><b id="res-gp">0</b></div>
        <div class="res-item" title="气血"><span class="sigil sigil-res sigil-hp">血</span><div class="hpbar"><i id="res-hp"></i></div><span id="res-hp-text"></span></div>
      </div>
    </header>
    <div class="buffbar" id="buffbar"></div>
    <nav class="tabs" id="tabs">
      <button class="tab" data-act="tab" data-tab="skills">修炼</button>
      <button class="tab" data-act="tab" data-tab="combat">斗法</button>
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
        handler({ type: 'pill:eat', payload: { item: el.dataset.item } });
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
          flog(`妖物遗落【${data.itemName}】`, 't-gold');
          log(`夺得【${data.itemName}】`, 't-gold');
          // 天降异宝特判由内容 def 的 showcase bool 驱动（ADR-016 裁决 ④）。
          if (rarityDefOf(String(data.rarity))?.showcase) toast(`天降异宝！【${data.itemName}】`);
        } else if (data.source === 'byproduct') {
          log(`偶得 ${nameOf(data.item)}×${data.count}`, 't-jade');
        } else if (data.source === 'drop') {
          log(`得 ${nameOf(data.item)}×${data.count}`);
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
        const compare = data.compare ? `（${data.compare}）` : '';
        flog(`【${data.enemyName}】轰然倒地！${data.summary}${compare}`, 't-gold');
        log(`击倒【${data.enemyName}】：${data.summary}${compare}`, 't-gold');
        break;
      }
      case 'defeat':
        flog(`你不敌【${data.enemyName}】，真元耗尽，被同门救回`, 't-red');
        toast('斗法落败，幸得同门相救', 'red');
        break;
      case 'pill:eat':
        if (data.kind === 'heal') {
          flog(`服下【${data.itemName}】，回气 ${data.healed} 点`, 't-sys');
        } else {
          toast(`服下【${data.itemName}】`);
          log(`服下【${data.itemName}】，药力${data.minutes}分`, 't-jade');
        }
        break;
      case 'equip:wear':
        toast(`已佩【${data.name}】`);
        log(`佩上【${data.name}】`, 't-jade');
        break;
      case 'equip:remove':
        log(`卸下【${data.name ?? ''}】`);
        break;
      case 'exp':
        // 引擎 exp 事件的数值字段是 amount（grantExp 载荷），非 exp。
        if (data.skillId === combatSkillId) flog(`斗法修为 +${data.amount}`, 't-sys');
        break;
      case 'levelup':
        toast(`【${data.skillName}】修为精进，升至 ${data.level} 层`);
        log(`【${data.skillName}】升至 ${data.level} 层`, 't-gold');
        break;
      case 'sell':
        log(`卖出 ${data.itemName}，得 ${data.gained} 灵石`);
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

  const signature = (st: GameState, snap: SaveData): string =>
    JSON.stringify([
      activeTab,
      selectedSkillId,
      Math.floor(st.gp),
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

    gpEl.textContent = Math.floor(st.gp).toLocaleString('zh-CN');
    const cap = snap.stats?.maxHp ?? Math.max(1, Math.floor(st.hp));
    hpFill.style.width = `${Math.max(0, Math.min(100, (st.hp / cap) * 100))}%`;
    hpText.textContent = `${Math.floor(st.hp)}/${cap}`;
    if (snap.stats) {
      statsEl.textContent = `${snap.stats.atk}/${snap.stats.def}/${snap.stats.crit}%`;
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

  /** 顶栏丹药增益条：剩余时长轻量刷新（每帧），结构变化由 signature 驱动。 */
  function renderBuffbar(st: GameState, now: number): void {
    const entries = Object.entries(st.buffs);
    if (buffbarEl.childElementCount !== entries.length) {
      buffbarEl.innerHTML = entries
        .map(([id]) => {
          const item = itemById.get(id);
          return `<span class="buff-chip" data-buff="${id}">${esc(item?.icon ?? '丹')} ${esc(item?.name ?? id)} <b></b></span>`;
        })
        .join('');
    }
    for (const el of Array.from(buffbarEl.children) as HTMLElement[]) {
      const id = el.dataset.buff ?? '';
      const left = Math.max(0, Math.ceil(((st.buffs[id] ?? 0) - now) / 1000));
      const label = el.querySelector('b');
      if (label) label.textContent = left >= 60 ? `${Math.floor(left / 60)} 分` : `${left} 秒`;
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
    const clv = levelFromXp(st.skills[combatSkillId]?.xp ?? 0);

    const pills = content.items
      .filter((item) => item.type === 'pill' && (st.items[item.id] ?? 0) > 0)
      .map(
        (item) =>
          `<button class="btn btn-pill" data-act="eat" data-item="${item.id}">${esc(item.icon)} ${esc(item.name)} ×${st.items[item.id]}</button>`,
      )
      .join('');

    const toggles = `
      <div class="combat-toggles">
        <button class="btn btn-ghost${st.autoFight ? ' on' : ''}" data-act="toggle-auto">自动再战${st.autoFight ? ' · 开' : ' · 关'}</button>
        <button class="btn btn-ghost${st.autoEat ? ' on' : ''}" data-act="toggle-auto-eat">自动嗑丹${st.autoEat ? ' · 开' : ' · 关'}</button>
      </div>`;

    if (combat) {
      const enemy = content.enemies.find((entry) => entry.id === combat.enemyId);
      if (!enemy) return '<section class="page"><p class="empty">妖物不知所踪。</p></section>';
      const ehpPct = Math.max(0, Math.min(100, (combat.ehp / enemy.hp) * 100));
      const resting = combat.respT > 0;
      const hpPct = Math.max(0, Math.min(100, (st.hp / (snap.stats?.maxHp ?? enemy.hp)) * 100));
      return `
        <section class="page">
          <h2 class="page-title">斗法</h2>
          <article class="enemy-card fighting">
            <div class="enemy-face"><span class="sigil sigil-big">${esc(enemy.icon)}</span></div>
            <div class="enemy-main">
              <div class="enemy-head"><b>${esc(enemy.name)}</b><span class="enemy-lv">${enemy.level} 层</span>${resting ? '<em class="act-badge">休整中</em>' : ''}</div>
              <div class="bar bar-red"><i data-bar="enemy" style="width:${ehpPct}%"></i></div>
              <div class="enemy-sub">敌 ${Math.max(0, Math.ceil(combat.ehp))}/${enemy.hp}</div>
              <div class="bar bar-jade"><i style="width:${hpPct}%"></i></div>
              <div class="enemy-sub">己方 ${Math.floor(st.hp)}/${snap.stats?.maxHp ?? '—'} · 攻 ${snap.stats?.atk ?? '—'} 防 ${snap.stats?.def ?? '—'} 会心 ${snap.stats?.crit ?? '—'}%</div>
            </div>
            <div class="enemy-ops">
              <button class="btn btn-ghost" data-act="flee">撤退</button>
            </div>
          </article>
          ${toggles}
          ${pills ? `<div class="pill-bar">${pills}</div>` : '<p class="page-sub">囊中无丹。</p>'}
          <div class="flog" id="flog"></div>
        </section>`;
    }

    const cards = content.enemies
      .map((enemy) => {
        const locked = clv + 2 < enemy.level;
        const gold = enemy.gold ?? { min: 0, max: 0 };
        const drops = (enemy.drops ?? [])
          .map((drop) => itemById.get(drop.item)?.name ?? drop.item)
          .slice(0, 3)
          .join('、');
        return `<article class="enemy-card${locked ? ' locked' : ''}">
          <div class="enemy-face"><span class="sigil sigil-big">${esc(enemy.icon)}</span></div>
          <div class="enemy-main">
            <div class="enemy-head"><b>${esc(enemy.name)}</b><span class="enemy-lv">${enemy.level} 层</span></div>
            <div class="enemy-sub">气血 ${enemy.hp} · 攻 ${enemy.atk} · 防 ${enemy.def} · 修为 +${enemy.exp}</div>
            <div class="enemy-sub">灵石 ${gold.min}~${gold.max}${drops ? ` · 掉落 ${esc(drops)}` : ''}</div>
          </div>
          <div class="enemy-ops">
            ${
              locked
                ? `<span class="act-lockmsg">需 ${enemy.level - 2} 层</span>`
                : `<button class="btn" data-act="fight" data-enemy="${enemy.id}">挑战</button>`
            }
          </div>
        </article>`;
      })
      .join('');

    return `
      <section class="page">
        <h2 class="page-title">斗法</h2>
        <p class="page-sub">斩妖除魔，问道长生。当前斗法 ${clv} 层。</p>
        <div class="enemy-grid">${cards}</div>
        <div class="pill-bar">${pills || ''}</div>
      </section>`;
  }

  /* ---------- 乾坤袋：装备实例卡 ---------- */

  /** 着色类 = `r-${档位 id}`（def 驱动）；缺档回退第一档；空表 r-none。 */
  const rarityClass = (rarity: string): string => {
    const def = rarityDefOf(rarity);
    return def ? `r-${def.id}` : 'r-none';
  };
  const rarityName = (rarity: string): string => rarityDefOf(rarity)?.name ?? '';

  const STAT_LABEL: Readonly<Record<string, string>> = { atk: '攻', def: '防', hp: '血', crit: '暴' };

  function gearCardHtml(st: GameState, gear: { uid: number; itemId: string; rarity: string; affixes: readonly { name: string; stat: string; val: number }[] }): string {
    const item = itemById.get(gear.itemId);
    const worn = Object.entries(st.equips).find(([, uid]) => uid === gear.uid);
    const mult = rarityDefOf(gear.rarity)?.mult ?? 1;
    const baseRows = Object.entries(item?.bonuses ?? {})
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([stat, v]) => `${STAT_LABEL[stat] ?? stat}+${Math.round((v ?? 0) * mult)}`);
    const affixRows = gear.affixes.map((a) => `<span class="txt-dim">${esc(a.name)}</span> ${STAT_LABEL[a.stat] ?? a.stat}+${a.val}${a.stat === 'crit' ? '%' : ''}`);
    const rows = [...baseRows, ...affixRows].join('、') || '无属性';
    const displayName = rarityName(gear.rarity)
      ? `${rarityName(gear.rarity)}·${item?.name ?? gear.itemId}`
      : item?.name ?? gear.itemId;
    return `<div class="gear-card ${rarityClass(gear.rarity)}">
      <span class="sigil sigil-sm">${esc(item?.icon ?? '器')}</span>
      <span class="gear-name">${esc(displayName)}<small>${rows}</small></span>
      <span class="bag-ops">
        ${worn
          ? `<button class="btn btn-ghost" data-act="take-off" data-slot="${worn[0]}">卸下</button>`
          : `<button class="btn" data-act="wear" data-uid="${gear.uid}">佩戴</button>`}
        ${worn ? '' : `<button class="btn btn-ghost" data-act="sell-gear" data-uid="${gear.uid}">卖出</button>`}
      </span>
    </div>`;
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
        ? `<h3 class="group-title">法器 · 佩戴中</h3>${worn || '<p class="empty">未佩戴法器。</p>'}
           <h3 class="group-title">法器 · 囊中</h3>${loose || '<p class="empty">囊中别无长物。</p>'}`
        : '';
    return `<section class="page"><h2 class="page-title">乾坤袋</h2>${body}${gearSection || '<p class="empty">乾坤袋空空如也——先去「修炼」采些灵材。</p>'}</section>`;
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
