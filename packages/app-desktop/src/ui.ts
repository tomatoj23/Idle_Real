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
  achievementProgressOf,
  bossEnemyOf,
  craftMissingOf,
  craftSuccessRateOf,
  dungeonFloorEnemyOf,
  dungeonGateOf,
  dungeonLayerOf,
  dungeonsOf,
  enemyGateOf,
  expBase,
  expToNext,
  fillTemplate,
  findBossOf,
  findDungeon,
  findRarity,
  gearName,
  levelFromXp,
  powerOf,
  progressionParamsOf,
  projectGearBase,
  rebirthGateOf,
  rebirthOf,
  rebirthPreviewOf,
  realmOf,
  shopAffordOf,
  talentGateOf,
  type EnemyView,
  type GameAction,
  type GameState,
  type GearInstance,
  type ProgressionParams,
  type RecipeView,
  type SaveData,
} from '@wendao/engine';

export type TabId =
  | 'skills'
  | 'craft'
  | 'combat'
  | 'dungeon'
  | 'bag'
  | 'shop'
  | 'rebirth'
  | 'talents'
  | 'achievements';

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
  const craftSkills = content.skills.filter((skill) => skill.kind === 'craft');
  const combatSkillId = content.skills.find((skill) => skill.kind === 'combat')?.id ?? '';
  // 转生玩法（#6）：包无 rebirth 节 = 无转生页签（引擎零降级路径的同款壳面）。
  const rebirthSection = rebirthOf(content);
  const hasRebirth = rebirthSection !== undefined;
  // 秘境玩法（#7）：包无 dungeons 节 = 无秘境页签与斗法页入口。
  const dungeonList = dungeonsOf(content);
  const hasDungeons = dungeonList.length > 0;
  // 成就玩法（#9）：包无 achievements 节 = 无成就页签（引擎零降级路径的同款壳面）。
  const hasAchievements = (content.achievements ?? []).length > 0;

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
  let selectedCraftSkillId = craftSkills[0]?.id ?? '';
  /** 兵解两段式确认：先 arm 展示后果预览，再 confirm 发动作（#6）。 */
  let rebirthArmed = false;
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
      <button class="tab" data-act="tab" data-tab="craft">${esc(T('tabs.craft'))}</button>
      <button class="tab" data-act="tab" data-tab="combat">${esc(T('tabs.combat'))}</button>
      ${hasDungeons ? `<button class="tab" data-act="tab" data-tab="dungeon">${esc(T('tabs.dungeon'))}</button>` : ''}
      <button class="tab" data-act="tab" data-tab="bag">${esc(T('tabs.bag'))}</button>
      <button class="tab" data-act="tab" data-tab="shop">${esc(T('tabs.shop'))}</button>
      ${hasRebirth ? `<button class="tab" data-act="tab" data-tab="rebirth">${esc(T('tabs.rebirth'))}</button>
      <button class="tab" data-act="tab" data-tab="talents">${esc(T('tabs.talents'))}</button>` : ''}
      ${hasAchievements ? `<button class="tab" data-act="tab" data-tab="achievements">${esc(T('tabs.achievements'))}</button>` : ''}
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
        rebirthArmed = false; // 换页即撤防（兵解确认不跨页存续）
        lastSig = '';
        render();
        break;
      case 'skill':
        if (el.dataset.disabled === 'y') break;
        selectedSkillId = el.dataset.skill ?? selectedSkillId;
        lastSig = '';
        render();
        break;
      case 'craftskill':
        selectedCraftSkillId = el.dataset.skill ?? selectedCraftSkillId;
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
      case 'dungeon-enter':
        // 秘境入口（#7，斗法页/秘境页共用）：入门 + 切到秘境页看层进度。
        handler({ type: 'dungeon:enter', payload: { dungeonId: el.dataset.dungeon } });
        activeTab = 'dungeon';
        lastSig = '';
        render();
        break;
      case 'dungeon-leave':
        handler({ type: 'dungeon:leave' });
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
      case 'rebirth-go':
        rebirthArmed = true;
        lastSig = '';
        render();
        break;
      case 'rebirth-cancel':
        rebirthArmed = false;
        lastSig = '';
        render();
        break;
      case 'rebirth-confirm':
        rebirthArmed = false;
        handler({ type: 'rebirth:perform' });
        break;
      case 'talent-buy':
        handler({ type: 'talent:buy', payload: { nodeId: el.dataset.node } });
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
        } else if (data.source === 'craft') {
          // 炼制产出（#5）：装备产出带档位名/稀有度，showcase 特判与掉落同律。
          log(T('events.lootCraft', { name: String(data.itemName ?? ''), count: Number(data.count ?? 0) }), 't-jade');
          if (rarityDefOf(String(data.rarity))?.showcase) {
            toast(T('events.lootShowcase', { name: String(data.itemName ?? '') }));
          }
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
      case 'craft-fail':
        log(T('events.craftFail', { name: String(data.recipeName ?? ''), exp: Number(data.exp ?? 0) }), 't-red');
        break;
      case 'craft-halt':
        toast(T('events.craftHalt', { name: String(data.recipeName ?? '') }), 'red');
        log(T('events.craftHalt', { name: String(data.recipeName ?? '') }), 't-red');
        break;
      case 'rebirth':
        toast(T('events.rebirthToast', { daoYun: Number(data.daoYun ?? 0) }));
        log(
          T('events.rebirthLog', {
            xp: Number(data.totalXp ?? 0),
            daoYun: Number(data.daoYun ?? 0),
            count: Number(data.rebirths ?? 0),
          }),
          't-gold',
        );
        break;
      case 'talent:buy':
        toast(T('events.talentBuyToast', { name: String(data.name ?? ''), cost: Number(data.cost ?? 0) }));
        log(T('events.talentBuyLog', { name: String(data.name ?? ''), daoYun: Number(data.daoYun ?? 0) }), 't-jade');
        break;
      case 'dungeon:enter':
        toast(T('events.dungeonEnter', {
          name: String(data.dungeonName ?? ''),
          floor: Number(data.floor ?? 0),
          floors: Number(data.floors ?? 0),
        }));
        break;
      case 'dungeon:floor': {
        // 层奖励行：{items} 槽由壳按 nameOf + itemListSep 拼装（offlineLog 同律）；
        // 道韵后缀（events.dungeonDaoYun）仅在实际入账时拼接。
        const items = Object.entries((data.items ?? {}) as Record<string, number>)
          .map(([id, n]) => `${nameOf(id)}×${n}`)
          .join(T('common.itemListSep'));
        const daoYunSuffix =
          Number(data.daoYun ?? 0) > 0 ? T('events.dungeonDaoYun', { daoYun: Number(data.daoYun) }) : '';
        log(
          T('events.dungeonFloor', {
            floor: Number(data.floor ?? 0),
            floors: Number(data.floors ?? 0),
            gold: Number(data.gold ?? 0),
            items,
          }) + daoYunSuffix,
          't-gold',
        );
        break;
      }
      case 'dungeon:clear':
        toast(T('events.dungeonClear', { name: String(data.dungeonName ?? ''), floors: Number(data.floors ?? 0) }));
        break;
      case 'dungeon:leave':
        log(
          T('events.dungeonLeave', {
            name: String(data.dungeonName ?? ''),
            floor: Number(data.floor ?? 0),
            best: Number(data.best ?? 0),
          }),
          't-sys',
        );
        break;
      case 'boss:phase':
        // Boss 阶段转场（#8）：{enemy} 敌名 / {name} 阶段名 / {phase} 阶段序号。
        toast(
          T('events.bossPhase', {
            enemy: String(data.enemyName ?? ''),
            name: String(data.name ?? ''),
            phase: Number(data.phase ?? 0),
          }),
        );
        log(
          T('events.bossPhase', {
            enemy: String(data.enemyName ?? ''),
            name: String(data.name ?? ''),
            phase: Number(data.phase ?? 0),
          }),
          't-red',
        );
        break;
      case 'achievement:unlock':
        // 成就达成（#9）：浮提示 + 修行录行；奖励已在引擎入账，页面卡片承载展示。
        toast(T('events.achievementToast', { name: String(data.name ?? '') }));
        log(T('events.achievementLog', { name: String(data.name ?? '') }), 't-gold');
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
      st.rebirths,
      st.daoYun,
      st.daoYunEarned,
      [...st.talents].sort(),
      st.dungeon ? [st.dungeon.dungeonId, st.dungeon.floor] : null,
      Object.entries(st.dungeonBest).sort(),
      Object.entries(st.stats ?? {}).sort(),
      [...(st.achievements ?? [])].sort(),
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
    updateActivityBars(st, snap);
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
    else if (activeTab === 'craft') pageEl.innerHTML = renderCraft(st);
    else if (activeTab === 'combat') pageEl.innerHTML = renderCombat(st, snap);
    else if (activeTab === 'dungeon') pageEl.innerHTML = renderDungeon(st, snap);
    else if (activeTab === 'bag') pageEl.innerHTML = renderBag(st);
    else if (activeTab === 'rebirth') pageEl.innerHTML = renderRebirth(st);
    else if (activeTab === 'talents') pageEl.innerHTML = renderTalents(st);
    else if (activeTab === 'achievements') pageEl.innerHTML = renderAchievements(st);
    else pageEl.innerHTML = renderShop(st);
    if (activeTab === 'combat' || activeTab === 'dungeon') {
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

    // 主页境界区（#6 + B2 词表收编）：境界词表归 content.rebirth.realms，
    // 引擎 realmOf 查表单一来源；包无词表时整行不渲染（零降级路径）。
    const clv = levelFromXp(st.skills[combatSkillId]?.xp ?? 0, prog);
    const realm = realmOf(content, clv);
    const realmHtml =
      realm !== undefined
        ? `<div class="status-realm">${esc(T('pages.skills.realmLine', { realm, rebirths: st.rebirths }))}</div>`
        : '';

    const act = st.activity;
    const actSkill = act ? skillById.get(act.skillId) : undefined;
    const actDef = act ? actSkill?.activities?.[act.index] : undefined;
    const actPct = act && actDef ? Math.min(100, (act.progress / actDef.interval) * 100) : 0;

    const chips = content.skills
      .map((s) => {
        // #5 起 craft 技能 chip 可选（修为/层数在炼制页消费），仅 combat 锁定。
        const locked = s.kind === 'combat';
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
          ${realmHtml}
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
        // 解锁双重门控（#6）：层数门槛 + 道韵解锁表（rebirthGateOf 同源）。
        const yunGate = rebirthGateOf(content, st.daoYunEarned, { skillId: skill.id });
        const unlocked = level >= a.unlockLevel && !yunGate.locked;
        const lockMsg = yunGate.locked
          ? T('common.needDaoYun', { daoYun: yunGate.requiredDaoYun })
          : T('common.needLevel', { level: a.unlockLevel });
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
              : `<span class="act-lockmsg">${esc(lockMsg)}</span>`
          }
        </article>`;
      })
      .join('');

    return `
      <section class="page">
        <div class="chips">${chips}</div>
        ${statusCard}
        ${cards ? `<div class="act-grid">${cards}</div>` : ''}
      </section>`;
  }

  /* ---------- 炼制页（#5）：配方卡 = 材料着色 + 成功率 + 进度条 ---------- */

  /** 活动槽 interval 解析（craft 动作归 recipes，index = 包内 recipes 下标）。 */
  const activityIntervalOf = (skillId: string, index: number): number | undefined => {
    const skill = skillById.get(skillId);
    if (!skill) return undefined;
    if (skill.kind === 'craft') return content.recipes[index]?.interval;
    return skill.activities?.[index]?.interval;
  };

  function renderCraft(st: GameState): string {
    if (craftSkills.length === 0 || content.recipes.length === 0) {
      return `<section class="page"><p class="empty">${esc(T('pages.craft.empty'))}</p></section>`;
    }
    const skill = craftSkills.find((s) => s.id === selectedCraftSkillId) ?? craftSkills[0]!;
    const xp = st.skills[skill.id]?.xp ?? 0;
    const level = levelFromXp(xp, prog);
    const need = expToNext(level, prog);
    const into = xp - expBase(level, prog);
    const expPct = Number.isFinite(need) ? Math.min(100, (into / need) * 100) : 100;

    const act = st.activity;
    const runningHere = act?.skillId === skill.id;
    const actInterval = act ? activityIntervalOf(act.skillId, act.index) : undefined;
    const actPct = act && actInterval ? Math.min(100, (act.progress / actInterval) * 100) : 0;

    const chips = craftSkills
      .map((s) => {
        const selected = s.id === skill.id;
        const lv = levelFromXp(st.skills[s.id]?.xp ?? 0, prog);
        return `<button class="chip${selected ? ' selected' : ''}" data-act="craftskill" data-skill="${s.id}">
          <span class="sigil sigil-sm">${esc(s.icon)}</span><span>${esc(s.name)}</span>
          <b class="chip-lv">${esc(T('units.level', { v: lv }))}</b>
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
              ? esc(T('pages.craft.expSub', { into, need, left: Math.max(0, Math.ceil(need - into)) }))
              : esc(T('pages.craft.expMax'))
          }</div>
        </div>
        <div class="status-act">
          ${
            act && runningHere
              ? `<div class="act-now"><span>${esc(T('pages.craft.actNow', { name: act.name }))}</span><b data-act-pct data-key="${act.skillId}:${act.index}">${Math.floor(actPct)}%</b></div>
                 <div class="bar bar-jade"><i data-bar="activity" data-key="${act.skillId}:${act.index}" style="width:${actPct}%"></i></div>
                 <button class="btn btn-ghost" data-act="stop">${esc(T('pages.craft.stopBtn'))}</button>`
              : `<div class="act-now idle"><span>${esc(T('pages.craft.idle'))}</span></div>`
          }
        </div>
      </section>`;

    const cards = content.recipes
      .map((recipe: RecipeView, index: number) => ({ recipe, index }))
      .filter(({ recipe }) => recipe.skill === skill.id)
      .map(({ recipe, index }) => {
        // 解锁双重门控（#6）：层数门槛 + 道韵解锁表（rebirthGateOf 同源）。
        const yunGate = rebirthGateOf(content, st.daoYunEarned, { skillId: skill.id });
        const unlocked = level >= recipe.unlockLevel && !yunGate.locked;
        const lockMsg = yunGate.locked
          ? T('common.needDaoYun', { daoYun: yunGate.requiredDaoYun })
          : T('common.needLevel', { level: recipe.unlockLevel });
        const running = runningHere && act?.index === index;
        const out = itemById.get(recipe.output.item);
        // 成功率/材料缺口走引擎单一来源（craftSuccessRateOf / craftMissingOf），
        // 壳零公式复算（#5 票评：成功率展示禁二次硬编码，round3 A4）。
        const rate = craftSuccessRateOf(content, st.skills, recipe);
        const ratePct = String(Math.round(rate * 1000) / 10);
        const missing = new Set(craftMissingOf(recipe, st.items));
        const mats = Object.entries(recipe.materials)
          .map(([id, matNeed]) => {
            const mat = itemById.get(id);
            const have = st.items[id] ?? 0;
            return `<span class="mat${missing.has(id) ? ' no' : ' ok'}">${esc(mat?.icon ?? T('icons.unknown'))} ${esc(T('pages.craft.matRow', { name: mat?.name ?? id, have, need: matNeed }))}</span>`;
          })
          .join('');
        const pct = running && act ? Math.min(100, (act.progress / recipe.interval) * 100) : 0;
        return `<article class="act-card${running ? ' running' : ''}${unlocked ? '' : ' locked'}">
          <header><b>${esc(recipe.name)}</b>${running ? `<em class="act-badge">${esc(T('pages.craft.running'))}</em>` : ''}</header>
          <div class="act-yield">
            <span class="sigil sigil-sm">${esc(out?.icon ?? T('icons.unknown'))}</span> ${esc(out?.name ?? recipe.output.item)} ×${recipe.output.count}
            <span class="act-bonus">${esc(T('pages.craft.successRate', { rate: ratePct }))}</span>
          </div>
          <div class="craft-mats">${mats}</div>
          <div class="act-meta">${esc(T('pages.craft.recipeMeta', { interval: fmtSeconds(recipe.interval), exp: recipe.exp, level: recipe.unlockLevel }))}</div>
          <div class="bar bar-thin"><i data-bar="activity" data-key="${skill.id}:${index}" style="width:${pct}%"></i></div>
          ${
            unlocked
              ? running
                ? `<button class="btn btn-ghost" data-act="stop">${esc(T('pages.craft.stopBtn'))}</button>`
                : `<button class="btn" data-act="start" data-skill="${skill.id}" data-index="${index}">${esc(T('pages.craft.startBtn'))}</button>`
              : `<span class="act-lockmsg">${esc(lockMsg)}</span>`
          }
        </article>`;
      })
      .join('');

    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.craft.title'))}</h2>
        <p class="page-sub">${esc(T('pages.craft.subtitle', { level }))}</p>
        <div class="chips">${chips}</div>
        ${statusCard}
        <div class="act-grid">${cards || `<p class="empty">${esc(T('pages.craft.empty'))}</p>`}</div>
      </section>`;
  }

  /* ---------- 转生页（#6）：兵解预览 + 两段式确认 ---------- */

  function renderRebirth(st: GameState): string {
    if (!rebirthSection) {
      return `<section class="page"><p class="empty">${esc(T('pages.rebirth.empty'))}</p></section>`;
    }
    // 预览结算走引擎 rebirthPreviewOf（与 rebirth:perform 判定同源，壳零公式）。
    const preview = rebirthPreviewOf(content, st.skills);
    const resetChips = (rebirthSection.reset ?? [])
      .map((key) => T(`pages.rebirth.resetLabels.${key}`))
      .join(T('common.itemListSep'));
    const keepChips = (rebirthSection.keep ?? [])
      .map((key) => T(`pages.rebirth.keepLabels.${key}`))
      .join(T('common.itemListSep'));
    const gate = preview.eligible
      ? ''
      : `<p class="act-lockmsg">${esc(T('pages.rebirth.gateLine', { need: preview.minProgress }))}</p>`;
    const ops = !preview.eligible
      ? ''
      : rebirthArmed
        ? `<p class="page-sub rebirth-tip">${esc(T('pages.rebirth.confirmTip'))}</p>
           <button class="btn btn-danger" data-act="rebirth-confirm">${esc(T('pages.rebirth.confirmBtn'))}</button>
           <button class="btn btn-ghost" data-act="rebirth-cancel">${esc(T('pages.rebirth.cancelBtn'))}</button>`
        : `<button class="btn btn-danger" data-act="rebirth-go">${esc(T('pages.rebirth.performBtn'))}</button>`;
    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.rebirth.title'))}</h2>
        <p class="page-sub">${esc(T('pages.rebirth.subtitle', { rebirths: st.rebirths }))}</p>
        <section class="status-card rebirth-card">
          <div class="status-main">
            <div class="status-head"><b>${esc(T('pages.rebirth.xpLine', { xp: preview.totalXp }))}</b></div>
            <div class="status-head rebirth-gain"><b>${esc(T('pages.rebirth.gainLine', { daoYun: preview.gain }))}</b></div>
          </div>
          ${gate}
        </section>
        <div class="rebirth-lists">
          <div class="rebirth-list"><h3 class="group-title">${esc(T('pages.rebirth.resetTitle'))}</h3><p>${esc(resetChips)}</p></div>
          <div class="rebirth-list"><h3 class="group-title">${esc(T('pages.rebirth.keepTitle'))}</h3><p>${esc(keepChips)}</p></div>
        </div>
        <div class="rebirth-ops">${ops}</div>
      </section>`;
  }

  /* ---------- 天赋树页（#6）：树数据 100% 来自 rebirth.talents ---------- */

  function renderTalents(st: GameState): string {
    const talents = rebirthSection?.talents ?? [];
    if (talents.length === 0) {
      return `<section class="page"><p class="empty">${esc(T('pages.talents.empty'))}</p></section>`;
    }
    const cards = talents
      .map((node) => {
        // 购买门控走引擎 talentGateOf（与 talent:buy 判定同式同源，N4 收敛）。
        const gate = talentGateOf(content, st.daoYun, st.talents, node.id);
        let op: string;
        if (gate.owned) op = `<em class="act-badge">${esc(T('pages.talents.owned'))}</em>`;
        else if (gate.prereqMissing) op = `<span class="act-lockmsg">${esc(T('pages.talents.needPrereq'))}</span>`;
        else if (!gate.affordable)
          op = `<span class="act-lockmsg">${esc(T('pages.talents.needDaoYun', { cost: node.cost }))}</span>`;
        else
          op = `<button class="btn" data-act="talent-buy" data-node="${node.id}">${esc(T('pages.talents.buyBtn'))}</button>`;
        return `<article class="act-card talent-card${gate.owned ? ' owned' : ''}${!gate.owned && (gate.prereqMissing || !gate.affordable) ? ' locked' : ''}">
          <header><b><span class="sigil sigil-sm">${esc(node.icon ?? T('icons.unknown'))}</span> ${esc(node.name)}</b></header>
          ${node.description ? `<div class="talent-desc">${esc(node.description)}</div>` : ''}
          <div class="act-meta">${esc(T('pages.talents.costRow', { cost: node.cost }))}</div>
          ${op}
        </article>`;
      })
      .join('');
    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.talents.title'))}</h2>
        <p class="page-sub">${esc(T('pages.talents.subtitle', { daoYun: st.daoYun }))}</p>
        <div class="act-grid">${cards}</div>
      </section>`;
  }

  /* ---------- 成就页（#9）：统计区（包声明呈现面）+ 成就卡（进度条/奖励） ---------- */

  function renderAchievements(st: GameState): string {
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
    const statLabelMap = shellGet('pages.achievements.statLabels');
    const statRows =
      statLabelMap !== null && typeof statLabelMap === 'object'
        ? Object.entries(statLabelMap as Record<string, unknown>)
            .filter(([, label]) => typeof label === 'string' && label.length > 0)
            .map(
              ([key, label]) =>
                `<div class="stat-box"><b>${Math.floor(stats[key] ?? 0).toLocaleString(locale)}</b><span>${esc(String(label))}</span></div>`,
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
        // 进度行：已解锁不渲染（恒 100 无信息量）；布尔型（无 target）与反向阈值
        // （lte 的 {current}/{target} 数值语义反直觉——「最快击杀」类只留进度条）不渲染。
        const progressRow =
          !unlocked && view.target !== undefined && def.condition.op !== 'lte'
            ? `<div class="bar bar-thin"><i style="width:${percent}%"></i></div>
               <div class="act-meta">${esc(T('pages.achievements.progress', { current: view.current ?? 0, target: view.target }))}</div>`
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
                items: reward.items.map((stack) => `${nameOf(stack.item)}×${stack.count}`).join(sep),
              }),
            );
          }
        }
        return `<article class="act-card ach-card${unlocked ? ' owned' : ''}${concealed ? ' locked' : ''}">
          <header><b><span class="sigil sigil-sm">${esc(concealed ? T('icons.unknown') : (def.icon ?? T('icons.unknown')))}</span> ${esc(name)}</b>${unlocked ? `<em class="act-badge">${esc(T('pages.achievements.unlockedBadge'))}</em>` : ''}</header>
          ${desc ? `<div class="talent-desc">${esc(desc)}</div>` : ''}
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
  }

  /* ---------- Boss 呈现（#8）：阶段徽标 + 血条分段刻度 ---------- */

  /** 战斗中的敌人生效视图（单点组合）：秘境层倍率在前、Boss 阶段修正在后。 */
  const combatEnemyView = (st: GameState): EnemyView | undefined => {
    const combat = st.combat;
    if (!combat) return undefined;
    let view: EnemyView | undefined;
    if (st.dungeon) {
      view = dungeonFloorEnemyOf(content, st.dungeon.dungeonId, st.dungeon.floor, combat.enemyId);
    } else {
      view = content.enemies.find((entry) => entry.id === combat.enemyId);
    }
    if (view && combat.bossPhase >= 0) {
      view = bossEnemyOf(content, combat.enemyId, combat.bossPhase, view) ?? view;
    }
    return view;
  };

  /** Boss 徽标与血条分段刻度（非 Boss = 空串；刻度位置 = 阶段阈值，content 数据；
   *  阶段下标越界（包变更缩表）时徽标不渲染——与 bossEnemyOf 的 undefined 兜底同律）。 */
  const bossDecoOf = (st: GameState): { badge: string; ticks: string } => {
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

  /* ---------- 秘境页（#7）：层进度 + 当前层战斗 + 撤退；未在攻略 = 秘境列表 ---------- */

  /** 锁定句归因（#7）：锁因走引擎 gate.daoYunLocked 单一来源；道韵复用 common.needDaoYun，钥匙用 entryKey。 */
  const dungeonLockMsgOf =
    (st: GameState) =>
    (dungeonId: string): string => {
      const gate = dungeonGateOf(content, dungeonId, { daoYunEarned: st.daoYunEarned, items: st.items });
      if (gate.daoYunLocked) {
        return T('common.needDaoYun', { daoYun: gate.requiredDaoYun });
      }
      return T('pages.dungeon.entryKey', { item: itemById.get(gate.keyItem ?? '')?.name ?? (gate.keyItem ?? '') });
    };

  function renderDungeon(st: GameState, snap: SaveData): string {
    const dungeons = dungeonList;
    if (dungeons.length === 0) {
      return `<section class="page"><p class="empty">${esc(T('pages.dungeon.empty'))}</p></section>`;
    }
    const run = st.dungeon;
    if (run) {
      const dungeon = findDungeon(content, run.dungeonId);
      if (!dungeon) {
        return `<section class="page"><p class="empty">${esc(T('pages.dungeon.empty'))}</p></section>`;
      }
      // 当前层敌人走引擎组合投影（秘境层倍率 × Boss 阶段修正，combatEnemyView）。
      const enemy = combatEnemyView(st);
      const deco = bossDecoOf(st);
      const ehpPct =
        enemy && st.combat ? Math.max(0, Math.min(100, (st.combat.ehp / enemy.hp) * 100)) : 0;
      const hpPct = Math.max(0, Math.min(100, (st.hp / (snap.stats?.maxHp ?? 1)) * 100));
      const best = st.dungeonBest[dungeon.id] ?? 0;
      const rec = dungeonLayerOf(dungeon, run.floor)?.recommendedPower;
      const power = snap.stats ? powerOf(snap.stats) : 0;
      const consumables = consumablesHtml(st);
      return `
        <section class="page">
          <h2 class="page-title">${esc(T('pages.dungeon.title'))}</h2>
          <p class="page-sub">${esc(T('pages.dungeon.floorNow', { floor: run.floor, floors: dungeon.floors }))} · ${esc(T('pages.dungeon.best', { best }))}</p>
          <article class="enemy-card fighting">
            <div class="enemy-face"><span class="sigil sigil-big">${esc(enemy?.icon ?? T('icons.unknown'))}</span></div>
            <div class="enemy-main">
              <div class="enemy-head"><b>${esc(enemy?.name ?? '')}</b><span class="enemy-lv">${esc(T('units.level', { v: enemy?.level ?? 0 }))}</span>${deco.badge}</div>
              <div class="bar bar-red">${deco.ticks}<i data-bar="enemy" style="width:${ehpPct}%"></i></div>
              <div class="enemy-sub">${esc(T('pages.combat.enemyHp', { ehp: st.combat ? Math.max(0, Math.ceil(st.combat.ehp)) : 0, hp: enemy?.hp ?? 0 }))}</div>
              <div class="bar bar-jade"><i style="width:${hpPct}%"></i></div>
              <div class="enemy-sub">${esc(T('pages.combat.selfStats', { hp: Math.floor(st.hp), max: snap.stats?.maxHp ?? '—', atk: statValueText('atk', snap.stats?.atk ?? '—'), def: statValueText('def', snap.stats?.def ?? '—'), crit: statValueText('crit', snap.stats?.crit ?? '—') }))}</div>
            </div>
            <div class="enemy-ops">
              <button class="btn btn-ghost" data-act="dungeon-leave">${esc(T('pages.dungeon.retreatBtn'))}</button>
            </div>
          </article>
          ${rec ? `<p class="page-sub">${esc(T('pages.dungeon.powerNow', { power }))} · ${esc(T('pages.dungeon.powerRec', { min: rec.min, max: rec.max }))}</p>` : ''}
          ${consumables ? `<div class="consumable-bar">${consumables}</div>` : `<p class="page-sub">${esc(T('pages.combat.noConsumables'))}</p>`}
          <div class="flog" id="flog"></div>
        </section>`;
    }
    const lockMsgOf = dungeonLockMsgOf(st);
    const cards = dungeons
      .map((dungeon) => {
        const gate = dungeonGateOf(content, dungeon.id, { daoYunEarned: st.daoYunEarned, items: st.items });
        const best = st.dungeonBest[dungeon.id] ?? 0;
        const cleared = best >= dungeon.floors;
        return `<article class="enemy-card${gate.locked ? ' locked' : ''}">
          <div class="enemy-face"><span class="sigil sigil-big">${esc(dungeon.icon ?? T('icons.unknown'))}</span></div>
          <div class="enemy-main">
            <div class="enemy-head"><b>${esc(dungeon.name)}</b><span class="enemy-lv">${esc(T('units.level', { v: dungeon.floors }))}</span>${cleared ? `<em class="act-badge">${esc(T('pages.dungeon.clearBadge'))}</em>` : ''}</div>
            <div class="enemy-sub">${esc(T('pages.dungeon.best', { best }))}</div>
          </div>
          <div class="enemy-ops">
            ${
              gate.locked
                ? `<span class="act-lockmsg">${esc(lockMsgOf(dungeon.id))}</span>`
                : `<button class="btn" data-act="dungeon-enter" data-dungeon="${dungeon.id}">${esc(T('pages.dungeon.enterBtn'))}</button>`
            }
          </div>
        </article>`;
      })
      .join('');
    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.dungeon.title'))}</h2>
        <p class="page-sub">${esc(T('pages.dungeon.subtitle'))}</p>
        <div class="enemy-grid">${cards}</div>
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

  /** 背包中可服用的回气类消耗品按钮行（斗法页/秘境页共用）。 */
  const consumablesHtml = (st: GameState): string =>
    content.items
      .filter((item) => item.type === 'consumable' && (st.items[item.id] ?? 0) > 0)
      .map(
        (item) =>
          `<button class="btn btn-consumable" data-act="eat" data-item="${item.id}">${esc(item.icon)} ${esc(item.name)} ×${st.items[item.id]}</button>`,
      )
      .join('');

  function renderCombat(st: GameState, snap: SaveData): string {
    const combat = st.combat;
    // N2 修复（#018）：斗法修为读数按 combatSkillId 解析，禁硬编码内容 id。
    const clv = levelFromXp(st.skills[combatSkillId]?.xp ?? 0, prog);
    const sep = T('common.itemListSep');
    const consumables = consumablesHtml(st);

    // 秘境进行中（#7）：层序列战斗在身，野战一律拒绝——斗法页改为指向页。
    if (st.dungeon) {
      const runDungeon = findDungeon(content, st.dungeon.dungeonId);
      return `
        <section class="page">
          <h2 class="page-title">${esc(T('pages.combat.title'))}</h2>
          <p class="page-sub">${esc(T('pages.combat.subtitle', { level: clv }))}</p>
          <p class="page-sub">${esc(T('pages.dungeon.floorNow', { floor: st.dungeon.floor, floors: runDungeon?.floors ?? 0 }))}</p>
          <button class="btn" data-act="tab" data-tab="dungeon">${esc(T('tabs.dungeon'))}</button>
          <div class="consumable-bar">${consumables || ''}</div>
        </section>`;
    }

    const toggles = `
      <div class="combat-toggles">
        <button class="btn btn-ghost${st.autoFight ? ' on' : ''}" data-act="toggle-auto">${esc(T(st.autoFight ? 'pages.combat.autoFightOn' : 'pages.combat.autoFightOff'))}</button>
        <button class="btn btn-ghost${st.autoEat ? ' on' : ''}" data-act="toggle-auto-eat">${esc(T(st.autoEat ? 'pages.combat.autoEatOn' : 'pages.combat.autoEatOff'))}</button>
      </div>`;

    if (combat) {
      // 生效视图走引擎组合投影（Boss 阶段修正在案时随阶段变化，combatEnemyView）。
      const enemy = combatEnemyView(st);
      if (!enemy) return `<section class="page"><p class="empty">${esc(T('pages.combat.enemyMissing'))}</p></section>`;
      const deco = bossDecoOf(st);
      const ehpPct = Math.max(0, Math.min(100, (combat.ehp / enemy.hp) * 100));
      const resting = combat.respT > 0;
      const hpPct = Math.max(0, Math.min(100, (st.hp / (snap.stats?.maxHp ?? enemy.hp)) * 100));
      return `
        <section class="page">
          <h2 class="page-title">${esc(T('pages.combat.title'))}</h2>
          <article class="enemy-card fighting">
            <div class="enemy-face"><span class="sigil sigil-big">${esc(enemy.icon)}</span></div>
            <div class="enemy-main">
              <div class="enemy-head"><b>${esc(enemy.name)}</b><span class="enemy-lv">${esc(T('units.level', { v: enemy.level }))}</span>${resting ? `<em class="act-badge">${esc(T('pages.combat.resting'))}</em>` : ''}${deco.badge}</div>
              <div class="bar bar-red">${deco.ticks}<i data-bar="enemy" style="width:${ehpPct}%"></i></div>
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
        const levelGate = enemyGateOf(content, st.skills, enemy.id);
        // 道韵解锁门槛（#6）：rebirthGateOf 与引擎判定同源。
        const yunGate = rebirthGateOf(content, st.daoYunEarned, { enemyId: enemy.id });
        const locked = levelGate.locked || yunGate.locked;
        const lockMsg = yunGate.locked
          ? T('common.needDaoYun', { daoYun: yunGate.requiredDaoYun })
          : T('common.needLevel', { level: levelGate.requiredLevel });
        const gold = enemy.gold ?? { min: 0, max: 0 };
        const drops = (enemy.drops ?? [])
          .map((drop) => itemById.get(drop.item)?.name ?? drop.item)
          .slice(0, 3)
          .join(sep);
        return `<article class="enemy-card${locked ? ' locked' : ''}">
          <div class="enemy-face"><span class="sigil sigil-big">${esc(enemy.icon)}</span></div>
          <div class="enemy-main">
            <div class="enemy-head"><b>${esc(enemy.name)}</b><span class="enemy-lv">${esc(T('units.level', { v: enemy.level }))}</span></div>
            <div class="enemy-sub">${esc(T('pages.combat.enemyStats', { hp: enemy.hp, atk: enemy.atk, def: enemy.def, exp: enemy.exp }))}</div>
            <div class="enemy-sub">${esc(T('pages.combat.enemyGold', { min: gold.min, max: gold.max }))}${drops ? esc(T('pages.combat.dropsSuffix', { drops })) : ''}</div>
          </div>
          <div class="enemy-ops">
            ${
              locked
                ? `<span class="act-lockmsg">${esc(lockMsg)}</span>`
                : `<button class="btn" data-act="fight" data-enemy="${enemy.id}">${esc(T('pages.combat.fightBtn'))}</button>`
            }
          </div>
        </article>`;
      })
      .join('');

    // 秘境入口（#7，票面：入口在斗法页）：入门即切到秘境页；锁定句复用 dungeonLockMsgOf。
    const lockMsgOf = dungeonLockMsgOf(st);
    const dungeonEntries = hasDungeons
      ? dungeonList
          .map((dungeon) => {
            const gate = dungeonGateOf(content, dungeon.id, { daoYunEarned: st.daoYunEarned, items: st.items });
            const best = st.dungeonBest[dungeon.id] ?? 0;
            return `<div class="bag-row">
              <span class="sigil sigil-sm">${esc(dungeon.icon ?? T('icons.unknown'))}</span>
              <span class="bag-name">${esc(dungeon.name)}<small>${esc(T('pages.dungeon.best', { best }))}</small></span>
              <span class="bag-ops">${
                gate.locked
                  ? `<span class="act-lockmsg">${esc(lockMsgOf(dungeon.id))}</span>`
                  : `<button class="btn" data-act="dungeon-enter" data-dungeon="${dungeon.id}">${esc(T('pages.dungeon.enterBtn'))}</button>`
              }</span>
            </div>`;
          })
          .join('')
      : '';

    return `
      <section class="page">
        <h2 class="page-title">${esc(T('pages.combat.title'))}</h2>
        <p class="page-sub">${esc(T('pages.combat.subtitle', { level: clv }))}</p>
        ${dungeonEntries}
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

  /** 敌方血条轻量更新（斗法页/秘境页存在时每帧刷新；组合投影与结算同调）。 */
  function updateEnemyBar(st: GameState): void {
    const bar = pageEl.querySelector<HTMLElement>('[data-bar="enemy"]');
    if (!bar || !st.combat) return;
    const enemy = combatEnemyView(st);
    if (!enemy) return;
    bar.style.width = `${Math.max(0, Math.min(100, (st.combat.ehp / enemy.hp) * 100))}%`;
  }

  function updateActivityBars(st: GameState, snap: SaveData): void {
    // 进度条按 活动 键控：只有正在进行的卡片充能，其余归零。
    let key = '';
    let pct = 0;
    if (st.activity) {
      // 有效间隔单一来源 = 引擎快照投影（#6：gatherSpeed 缩放后与结算同调）；
      // 快照未带（如 craft 页旧路径）回落内容原值。
      const interval =
        snap.activityInterval ?? activityIntervalOf(st.activity.skillId, st.activity.index);
      if (interval !== undefined && interval > 0) {
        key = `${st.activity.skillId}:${st.activity.index}`;
        pct = Math.min(100, (st.activity.progress / interval) * 100);
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
