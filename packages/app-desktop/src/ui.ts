/**
 * UI 壳核（issue #3；#46 页面注册表后收敛；#34 反馈枢纽改造）：导航/顶栏/
 * signature/事件委托/刷新循环 + 飘字两档持久层。
 *
 * 页面本体住 src/pages/<tab>.ts（注册表装配见 pages.ts，同构零件见 pageFrame.ts）；
 * 本文件只保留壳级职责：顶栏血球/灵石、页签导航（含可用性开关与文案解析）、
 * 状态签名差量重绘、增益条、战斗日志、事件→飘字/toast/战斗日志接线。
 *
 * 反馈枢纽（#34，C7 架构裁决）：事件订阅改按事件命名空间的 handler 表——
 * attack→战斗飘字（档一，锚定敌卡逐击不聚合）/ 其余→获取飘字（档二，侧栏
 * 平移+同类聚合）· 醒目 toast · 战斗日志 · 无；右侧栏与 log() sink 退场，
 * 「流水」角色由 #33 修行录页接管。飘字/战斗日志活在独立持久层（#toasts
 * 先例推广为正式机制）：页面重建杀不到，flog 内容体重建后按锚点重挂——
 * flogBuffer 重放与滚动恢复 hack 随之退役。
 *
 * 结构一次搭建，点击走事件委托：导航动作留壳核（D4），本页动作委托给
 * 注册表当前页 handleAction。动态区域按状态签名差量重绘，实况区
 * （进度条/血条）由所在页 update 每帧轻量刷新（D3）。
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
  ENGINE_VERSION,
  dungeonsOf,
  fillTemplate,
  findRarity,
  gearParamsOf,
  progressionParamsOf,
  rebirthOf,
  type GameAction,
  type GameEvent,
  type GameSnapshot,
  type GameState,
  type Modifier,
  type ProgressionParams,
  type SaveData,
} from '@wendao/engine';
import { esc, pctClamped } from './pageFrame';
import { createPages, isTabId, TAB_ORDER } from './pages';
import type { TabId } from './pages/types';

// 壳核公开面保持不变（main.ts/测试消费 buildUi；esc 主壳引导页消费）。
export { esc };
export type { TabId };

export interface Ui {
  bindActions(handler: (action: GameAction) => void): void;
  /** 立即按 snapshot 重绘。 */
  render(): void;
  /** 事件驱动的合并重绘（rAF 去抖）。 */
  scheduleRender(): void;
  toast(text: string, kind?: 'gold' | 'red'): void;
}

/** 战斗日志环形容量（真实 DOM 环形删头上限）。导出为测试真源（D5：禁测试自钉拷贝）。 */
export const MAX_FLOG = 60;
/** 档二聚合窗口（C7：同类 3 秒短窗聚合，窗口可调）：同名获取行在窗口内合并计数。 */
const FLOAT_WINDOW_MS = 3000;
/** 档二堆叠限高（AC5：挂机连杀场景不无限堆积）。 */
const MAX_FLOAT_ACQ = 6;
/** 档一逐击不聚合（打击感逐拍），连击堆积限高防盖卡。 */
const MAX_FLOAT_COMBAT = 4;
/** 档一飘字驻留（毫秒）：逐击短暂起漂、数秒即消。 */
const FLOAT_COMBAT_MS = 2400;
/** 档二飘字驻留（毫秒）：小号字快速淡出。 */
const FLOAT_ACQ_MS = 3600;
/** 淡出时长（毫秒）：驻留尾段 fade-out 的起点 = 驻留 − 本值（style.css 经
 *  --float-out-delay 消费该计算结果，驻留时长单源在本文件）。 */
const FLOAT_FADE_MS = 450;
/** 档一锚定偏移（px）：敌卡右上角起漂的视觉 inset。 */
const FLOAT_ANCHOR_INSET = 10;
/** 档一行距（px）：逐击行下压步长。 */
const FLOAT_LINE_STEP = 26;
/** 访问段信号页（#39 坊市 + #33 乾坤袋）：切进/切出各一对 visit 信号。 */
const VISIT_PAGES: ReadonlySet<string> = new Set(['shop', 'bag']);

export function buildUi(
  root: HTMLElement,
  content: ContentPack,
  // #50 类型化快照：读数面取 GameSnapshot（state = Readonly<GameState>）。
  getSnapshot: () => GameSnapshot,
  events: EventBus,
): Ui {
  const itemById = new Map(content.items.map((item) => [item.id, item]));
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

  /* ---------- 装备构筑循环（#14）：铭纹展示词表（页面经 env 消费） ---------- */

  // 器屑经济可用性：config.gear.shardItem 未配置 = 该包无熔炼/重铸玩法
  //（引擎 not-available 零降级路径的壳面同款——按钮不渲染）。
  const gearParams = gearParamsOf(content);
  const canSmelt = gearParams.shardItem !== undefined;
  // 条件铭纹语境的系别展示名：elements 注册表数据直出，壳零系别词。
  const elementNameOf = (id: string): string =>
    content.elements.find((entry) => entry.id === id)?.name ?? id;
  /** 铭纹修饰符行：flat → +N，addPct → +N%，mult → ×N（标签/量纲查 statLabels）。 */
  const inscModText = (mod: Modifier): string => {
    if (mod.zone === 'mult') return `${statLabelOf(mod.stat).label}×${mod.value}`;
    if (mod.zone === 'addPct') return `${statLabelOf(mod.stat).label}+${mod.value}%`;
    return statBonusText(mod.stat, mod.value);
  };

  let activeTab: TabId = 'skills';
  let handler: ((action: GameAction) => void) | null = null;
  let lastSig = '';
  /** 增益条键签名（renderBuffbar 重建判据；null = 尚未建）。 */
  let lastBuffSig: string | null = null;
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
    <nav class="tabs" id="tabs"></nav>
    <main class="page-root" id="page-root"></main>
    <footer class="version-line">${esc(
      T('footer.versionLine', {
        name: T('brand.name'),
        // 类型必填 ≠ 运行时必有：测试夹具/旧形态包缺 version 时回退空串，
        // 不让页脚渲染出 "undefined"（防御路径，与缺键回显同策略）。
        content: content.version ?? '',
        engine: ENGINE_VERSION,
      }),
    )}</footer>
    <div class="floaters" id="floaters">
      <div class="toasts" id="toasts"></div>
      <div class="float-stack" id="float-stack"></div>
    </div>
    <div class="combat-floats" id="combat-floats"></div>
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
  const toastsEl = $<HTMLElement>('#toasts');
  const floatStackEl = $<HTMLElement>('#float-stack');
  const combatFloatsEl = $<HTMLElement>('#combat-floats');

  const nameOf = (id: unknown): string => itemById.get(String(id))?.name ?? String(id);

  /** 物品栈拼装行（{name}×{n} 经 itemListSep 连接；层奖励/离线明细共用一式）。 */
  const itemsLine = (items: Readonly<Record<string, number>>): string =>
    Object.entries(items)
      .map(([id, n]) => `${nameOf(id)}×${n}`)
      .join(T('common.itemListSep'));

  /* ---------- 页面注册表装配（#46 D6） ---------- */

  const pages = createPages({
    content,
    T,
    shellRaw: shellGet,
    locale,
    prog,
    itemById,
    nameOf,
    statValueText,
    statBonusText,
    fmtSeconds,
    fmtDuration,
    elementNameOf,
    inscModText,
    rarityClass,
    gatherSkills,
    craftSkills,
    combatSkillId,
    dungeonList,
    rebirthSection,
    canSmelt,
    pageEl,
    dispatch: (action) => handler?.(action),
    // 页面 UI 状态（选中/撤防）变化走强制重绘：等价今天 click 路径的
    // lastSig='' + render()（签名不含页面自持状态，见 signature 注）。
    render: () => {
      lastSig = '';
      render();
    },
    nav: navigate,
  });

  /** 秒时长读数（units.seconds 模板，{v} 槽）。 */
  function fmtSeconds(ms: number): string {
    const s = ms / 1000;
    return T('units.seconds', { v: Number.isInteger(s) ? String(s) : s.toFixed(1) });
  }

  /** 时长读数（时/分/秒三级 units 模板链；离线明细与修行录页共用一式）。 */
  function fmtDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? T('units.hourMinute', { h, m }) : m > 0 ? T('units.minute', { m }) : T('units.seconds', { v: seconds });
  }

  function rarityClass(rarity: string): string {
    const def = rarityDefOf(rarity);
    return def ? `r-${def.id}` : 'r-none';
  }

  // 页签导航：注册表顺序 + 内容形态开关（#6/#7/#9 零降级路径同款壳面）。
  // 文案键存注册表条目（D11），经 texts.shell 解析——文案归 content 义务不变。
  const tabAvailable = (id: TabId): boolean =>
    id === 'dungeon'
      ? hasDungeons
      : id === 'rebirth' || id === 'talents'
        ? hasRebirth
        : id === 'achievements'
          ? hasAchievements
          : true;
  $('#tabs').innerHTML = TAB_ORDER.filter(tabAvailable)
    .map((id) => `<button class="tab" data-act="tab" data-tab="${id}">${esc(T(pages[id].label))}</button>`)
    .join('');
  const tabButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('#tabs .tab'));

  /** 运行时 tab 值校验（D7）：未知串 warn + 回落修炼页（裸 cast 退役）。 */
  function normalizeTab(raw: string | undefined): TabId {
    if (raw !== undefined && isTabId(raw)) return raw;
    console.warn(`[wendao] unknown tab: ${String(raw)}`);
    return 'skills';
  }

  function navigate(next: TabId): void {
    // 访问段信号（#39 D9；#33 推广至乾坤袋）：交互页切进/切出各一对信号转发
    //（引擎纯转发，段落账归引擎聚合器；非法载荷被引擎 reject，无副作用）。
    if (activeTab !== next) {
      if (VISIT_PAGES.has(activeTab)) handler?.({ type: 'visit:end', payload: { page: activeTab } });
      if (VISIT_PAGES.has(next)) handler?.({ type: 'visit:begin', payload: { page: next } });
    }
    // 换页即撤防（#6 兵解确认不跨页存续）：页面自持 UI 状态经 deactivate 复位。
    pages[activeTab].deactivate?.();
    activeTab = next;
    lastSig = '';
    render();
  }

  /** data-act 动作元素解析（click/change 两路委托共用）。 */
  const actionElOf = (ev: Event): HTMLElement | undefined => {
    const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
    return el && handler ? el : undefined;
  };

  root.addEventListener('click', (ev) => {
    const el = actionElOf(ev);
    if (!el) return;
    // 选择器动作走 change 委托（#35）：点击只开合下拉不派发——否则开合即整页
    // 重绘，下拉当场被换血关死。
    if (el.tagName === 'SELECT') return;
    const act = el.dataset.act ?? '';
    if (act === 'tab') {
      // 导航动作留壳核（D4）：页内渲染的指向按钮同走此路径。
      navigate(normalizeTab(el.dataset.tab));
      return;
    }
    // 本页动作委托注册表（D1/D4）：巨型 click switch 整体退役。
    pages[activeTab].handleAction?.(act, el);
  });

  // 表单控件动作委托（#35）：<select> 值变更即动作，与 click 同路由进当页 handleAction。
  root.addEventListener('change', (ev) => {
    const el = actionElOf(ev);
    if (!el) return;
    pages[activeTab].handleAction?.(el.dataset.act ?? '', el);
  });

  /* ---------- 反馈枢纽（#34）：飘字两档 + 醒目 toast + 战斗日志 ---------- */

  function scheduleRender(): void {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      render();
    });
  }

  /* ---- 持久层机制（#34 C7：#toasts 先例推广为正式机制）----
   * 飘字/战斗日志活在独立持久区，页面重建（innerHTML 整页换血）杀不到；
   * 页面重绘后按锚点重查询刷新位置。flogBuffer 重放 hack 与滚动恢复 hack
   * 随之退役（flog 内容体改持久重挂）。 */

  /** 档一战斗飘字（C7：既有 flog 改造）：伤害/暴击/受击锚定敌卡，逐击不聚合。
   * 无锚点（用户在其他页挂机连杀）不入层——战斗反馈归战斗语境，防 (0,0) 堆顶栏。 */
  function combatFloat(text: string, cls: string): void {
    if (combatAnchor() === null) return;
    pushFloat(combatFloatsEl, `float-combat ${cls}`, text, FLOAT_COMBAT_MS);
    while (combatFloatsEl.children.length > MAX_FLOAT_COMBAT) combatFloatsEl.firstElementChild?.remove();
    positionCombatFloats();
  }

  /** 档一锚点：交战敌卡优先，列表视图回落交战徽标卡；无 = 不在战斗语境。 */
  function combatAnchor(): HTMLElement | null {
    return (
      pageEl.querySelector<HTMLElement>('.enemy-card.fighting') ??
      pageEl.querySelector<HTMLElement>('.enemy-card.running')
    );
  }

  /** 档一位置刷新：按锚点重查询；锚点消失（战罢换列表）保留现位走完淡出，不乱锚。 */
  function positionCombatFloats(): void {
    const anchor = combatAnchor();
    if (anchor === null) return;
    const rect = anchor.getBoundingClientRect();
    const viewW = document.documentElement.clientWidth;
    const floats = Array.from(combatFloatsEl.children) as HTMLElement[];
    floats.forEach((el, i) => {
      // 右缘锚定（向左延伸覆盖敌卡缘）：窄屏不出屏，锚点右上角起漂、逐条下压。
      el.style.right = `${Math.round(viewW - rect.right + FLOAT_ANCHOR_INSET)}px`;
      el.style.top = `${Math.round(Math.max(0, rect.top) + FLOAT_ANCHOR_INSET + i * FLOAT_LINE_STEP)}px`;
    });
  }

  /** 档二聚合窗记录（同类 3 秒短窗聚合，纯呈现层）：同名行在窗内合并计数。 */
  interface AcqFloat {
    readonly name: string;
    count: number;
    readonly single: string;
    readonly el: HTMLElement;
    readonly openedAt: number;
    readonly timer: ReturnType<typeof setTimeout>;
  }
  const acqFloats = new Map<string, AcqFloat>();

  /** 飘字行入栈（档一/档二共用小件）：类名/驻留/淡出起点一处收口。 */
  function pushFloat(layer: HTMLElement, cls: string, text: string, lifeMs: number): HTMLElement {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    // 淡出起点随驻留时长单源驱动（style.css float-out 读本变量，双源硬编码退役）。
    el.style.setProperty('--float-out-delay', `${(lifeMs - FLOAT_FADE_MS) / 1000}s`);
    layer.appendChild(el);
    setTimeout(() => el.remove(), lifeMs);
    return el;
  }

  /** 栈上限裁剪：最旧先退（AC5 挂机连杀不无限堆积），聚合表随行清退。 */
  function trimFloatStack(): void {
    while (floatStackEl.children.length > MAX_FLOAT_ACQ) {
      const oldest = floatStackEl.firstElementChild;
      if (!oldest) break;
      for (const [key, rec] of acqFloats) {
        if (rec.el === oldest) {
          clearTimeout(rec.timer);
          acqFloats.delete(key);
          break;
        }
      }
      oldest.remove();
    }
  }

  /** 档二获取飘字（C7：接管原右侧栏瞬时反馈角色）：同类 3 秒短窗聚合。 */
  function acquireFloat(single: string, name: string, count: number): void {
    const now = Date.now();
    const live = acqFloats.get(name);
    if (live !== undefined && now - live.openedAt < FLOAT_WINDOW_MS) {
      // 窗内合并：计数累加并切聚合形（"铁矿石 ×1"×4 → "铁矿石 +4"）。
      // 驻留计时不重置（起漂即定时淡出，聚合窗 < 驻留时长）。
      live.count += count;
      live.el.textContent =
        live.count > 1 ? T('events.floatSum', { name: live.name, count: live.count }) : live.single;
      return;
    }
    // 新窗/首条：单形起漂。旧窗行未到淡出点（窗 3s < 淡出起点 3.15s）不硬摘
    // ——只清聚合表让其走完淡出，驻留计时自然移除。
    if (live !== undefined) {
      clearTimeout(live.timer);
      acqFloats.delete(name);
    }
    const el = pushFloat(floatStackEl, 'float-acq', single, FLOAT_ACQ_MS);
    acqFloats.set(name, {
      name,
      count,
      single,
      el,
      openedAt: now,
      // 驻留清理只负责聚合表（元素移除归 pushFloat 的同长计时）。
      timer: setTimeout(() => acqFloats.delete(name), FLOAT_ACQ_MS),
    });
    trimFloatStack();
  }

  /** 档二平移行（不聚合）：侧栏操作流水逐条短暂显示（AC1 平移口径）。 */
  function flowFloat(text: string): void {
    pushFloat(floatStackEl, 'float-acq', text, FLOAT_ACQ_MS);
    trimFloatStack();
  }

  /**
   * 修为读数缓冲（AC4：修为只在升级与离线汇总出现，普通活动周期不飘——防刷屏）。
   * exp 事件先于 levelup 同批发射（grantExpExact 顺序），升级时取当笔实发值飘出。
   */
  const pendingExp = new Map<string, number>();

  /* ---- 事件 handler 表（#34 反馈枢纽，C7：按命名空间路由 sink）----
   * Record 全键穷尽：引擎新增事件类型而壳层漏接 = 编译错（#47 never 穷尽
   * 断言的表化升级，比 switch 尾断言更强——漏接在类型层即红）。路由口径：
   * attack→档一战斗飘字 / 获取流水→档二获取飘字 / 重要事件→醒目 toast /
   * 战斗叙事→战斗日志 / 其余→无（activity 心跳、tick、visit 信号不呈现）。
   * 载荷类型经 Extract 从 GameEvent 联合派生——#47 遗留④的导出策略定案：
   * engine barrel 维持只导 GameEvent 判别联合、不导成员接口，消费侧按判别键
   * 自取载荷（多一重 barrel 面 = 多一份同形漂移点）。 */
  type Handlers = {
    [K in GameEvent['type']]: (event: Extract<GameEvent, { type: K }>) => void;
  };

  const handlers: Handlers = {
    /* —— 战斗流（combat: 命名空间）—— */
    attack: (event) => {
      // 档一：完整战斗文案（伤害已嵌入 {d} 槽）逐击起漂，锚定敌卡不聚合。
      const data = event.data;
      combatFloat(data.text, data.side === 'player' ? (data.crit ? 't-gold' : 't-jade') : 't-red');
    },
    'combat-note': (event) => {
      flog(event.data.text, 't-sys');
    },
    victory: (event) => {
      // AC2：胜利只入修行录与战斗日志、不飘字（防连杀刷屏）——战利品段
      //（#62 保真收口）随叙事行留在战斗日志，侧栏汇总行随侧栏退场。
      const data = event.data;
      const compare = data.compare ? T('common.compareWrap', { compare: data.compare }) : '';
      const spoilNames = data.drops.map((id) => nameOf(id));
      if (typeof data.gearDropName === 'string' && data.gearDropName) {
        spoilNames.push(`【${data.gearDropName}】`);
      }
      const spoil = T('events.victorySpoil', {
        gold: String(data.gold),
        loot: spoilNames.join(T('common.itemListSep')) || T('events.offlineNoYield'),
      });
      flog(
        T('events.victoryFlog', {
          name: data.enemyName,
          summary: data.summary,
          compare,
          spoil,
        }),
        't-gold',
      );
    },
    defeat: (event) => {
      // AC2：战败保留红 toast（要紧的是败不是胜）。
      const data = event.data;
      flog(T('events.defeatFlog', { name: data.enemyName }), 't-red');
      toast(T('events.defeatToast'), 'red');
    },
    'boss:summon': (event) => {
      // Boss 召唤入场（#47 D2 缺口事件）：战斗日志叙事行（#47 冒烟钉，不容退化）。
      const data = event.data;
      flog(T('events.bossSummon', { enemy: data.enemyName, count: data.count }), 't-red');
    },
    'boss:phase': (event) => {
      // Boss 阶段转场（#8）：重要战况保留醒目 toast；侧栏行随侧栏退场（同文）。
      const data = event.data;
      toast(
        T('events.bossPhase', {
          enemy: data.enemyName,
          name: data.name,
          phase: data.phase,
        }),
      );
    },

    /* —— 产出获取流（ledger/loot：档二获取飘字）—— */
    loot: (event) => {
      // 侧栏获取行平移档二（AC1）：同类 3 秒短窗聚合；showcase 掉落仍醒目
      // toast（AC3）；战斗来源不再回战斗日志（旧 lootGear 行随侧栏退场）。
      const data = event.data;
      const name = data.source === 'gear' || data.source === 'craft' ? data.itemName : nameOf(data.item);
      const count = data.count;
      if (data.source === 'gear') {
        acquireFloat(T('events.lootGearLog', { name }), name, 1);
      } else if (data.source === 'byproduct') {
        acquireFloat(T('events.lootByproduct', { name, count }), name, count);
      } else if (data.source === 'drop' || data.source === 'activity') {
        // 常规掉落与采集产出同式（lootDrop 模板）；activity 源为 #34 获取
        // 飘字新覆盖（C7 "铁矿石 ×1"×4 聚合示例即采集产出，旧侧栏静默）。
        acquireFloat(T('events.lootDrop', { name, count }), name, count);
      } else if (data.source === 'craft') {
        acquireFloat(T('events.lootCraft', { name, count }), name, count);
      }
      // 天降异宝特判由内容 def 的 showcase bool 驱动（ADR-016 裁决 ④）。
      if ((data.source === 'gear' || data.source === 'craft') && data.rarity !== undefined && rarityDefOf(data.rarity)?.showcase) {
        toast(T('events.lootShowcase', { name }));
      }
    },
    ledger: () => {
      // 统一账本事件（#39）：资产流水角色归 #33 修行录页；瞬时呈现由旧形状
      // 事件的档二平移行承载（避免与成对账本事件双显）——本枢纽不消费。
    },

    /* —— 角色操作流（买卖/佩戴/熔炼等侧栏流水平移档二）—— */
    sell: (event) => {
      const data = event.data;
      flowFloat(T('events.sellLog', { name: data.itemName, gained: data.gained }));
    },
    buy: (event) => {
      const data = event.data;
      flowFloat(
        T('events.buyLog', {
          name: data.itemName,
          count: data.count,
          cost: data.cost,
        }),
      );
    },
    'consumable:eat': (event) => {
      const data = event.data;
      if (data.kind === 'heal') {
        flog(T('events.eatHeal', { name: data.itemName, healed: data.healed }), 't-sys');
      } else {
        flowFloat(T('events.eatBuffLog', { name: data.itemName, minutes: data.minutes }));
      }
    },
    'equip:wear': (event) => {
      // 佩戴（AC1）：轻量飘字短暂显示；旧醒目 toast 退场（常规动作非要紧事）。
      const data = event.data;
      flowFloat(T('events.equipWearLog', { name: data.name }));
    },
    'equip:remove': (event) => {
      const data = event.data;
      flowFloat(T('events.equipRemoveLog', { name: data.name ?? '' }));
    },
    'gear:smelt': (event) => {
      // 熔炼（#14）：{shard} 槽 = 器屑物品展示名（content 数据直出）。
      const data = event.data;
      flowFloat(
        T('events.gearSmelt', {
          name: data.name,
          shard: nameOf(data.item),
          count: data.shards,
        }),
      );
    },
    'gear:reforge': (event) => {
      const data = event.data;
      flowFloat(T('events.gearReforge', { name: data.name, tier: data.tier }));
    },
    'craft-fail': (event) => {
      const data = event.data;
      flowFloat(T('events.craftFail', { name: data.recipeName, exp: data.exp }));
    },
    'craft-halt': (event) => {
      // 缺料停炉：要紧中断保留红 toast；同文侧栏行退场（toast 化收口）。
      const data = event.data;
      toast(T('events.craftHalt', { name: data.recipeName }), 'red');
    },
    'dungeon:floor': (event) => {
      // 层奖励行（侧栏平移）：{items} 槽由壳按 nameOf + itemListSep 拼装；
      // 道韵后缀（events.dungeonDaoYun）仅在实际入账时拼接。
      const data = event.data;
      const items = itemsLine(data.items);
      const daoYunSuffix =
        data.daoYun > 0 ? T('events.dungeonDaoYun', { daoYun: Number(data.daoYun) }) : '';
      flowFloat(
        T('events.dungeonFloor', {
          floor: data.floor,
          floors: data.floors,
          gold: data.gold,
          items,
        }) + daoYunSuffix,
      );
    },
    'dungeon:leave': (event) => {
      const data = event.data;
      flowFloat(
        T('events.dungeonLeave', {
          name: data.dungeonName,
          floor: data.floor,
          best: data.best,
        }),
      );
    },

    /* —— 成长里程碑流（升级/成就/兵解/天赋：醒目 toast 保留 + 平移行）—— */
    levelup: (event) => {
      // AC3 升级保留醒目 toast；AC4 修为读数随升级飘出（普通周期不飘）。
      const data = event.data;
      toast(T('events.levelupToast', { name: data.skillName, level: data.level }));
      flowFloat(T('events.levelupLog', { name: data.skillName, level: data.level }));
      const amount = pendingExp.get(data.skillId);
      if (amount !== undefined) {
        flowFloat(T('events.expGain', { amount }));
        pendingExp.delete(data.skillId);
      }
    },
    exp: (event) => {
      // AC4：修为读数只在升级与离线汇总出现——本事件只缓冲不呈现。
      pendingExp.set(event.data.skillId, event.data.amount);
    },
    'achievement:unlock': (event) => {
      // AC3 成就保留醒目 toast（同文侧栏行退场）；奖励入账归引擎/修行录。
      const data = event.data;
      toast(T('events.achievementToast', { name: data.name }));
    },
    rebirth: (event) => {
      const data = event.data;
      toast(T('events.rebirthToast', { daoYun: data.daoYun }));
      flowFloat(
        T('events.rebirthLog', {
          xp: data.totalXp,
          daoYun: data.daoYun,
          count: data.rebirths,
        }),
      );
    },
    'talent:buy': (event) => {
      const data = event.data;
      toast(T('events.talentBuyToast', { name: data.name, cost: data.cost }));
      flowFloat(T('events.talentBuyLog', { name: data.name, daoYun: data.daoYun }));
    },

    /* —— 秘境与离线流 —— */
    'dungeon:enter': (event) => {
      const data = event.data;
      toast(
        T('events.dungeonEnter', {
          name: data.dungeonName,
          floor: data.floor,
          floors: data.floors,
        }),
      );
    },
    'dungeon:clear': (event) => {
      const data = event.data;
      toast(T('events.dungeonClear', { name: data.dungeonName, floors: data.floors }));
    },
    'offline-settled': (event) => {
      // AC3 离线汇总保留醒目 toast（摘要）；结算明细（含修为读数——AC4 离线
      // 汇总口径）平移档二。离线上限钳制时引擎双报（awaySeconds=真实离开 /
      // seconds=实际结算）：切 offlineCapped* 模板区分展示（#60）。
      const data = event.data;
      const seconds = Math.max(0, Math.floor(data.seconds));
      const capped = data.capped === true;
      const awaySeconds = Math.max(0, Math.floor(data.awaySeconds)) || seconds;
      const away = fmtDuration(capped ? awaySeconds : seconds);
      const settled = fmtDuration(seconds);
      const items = itemsLine(data.items);
      if (capped) {
        toast(
          T('events.offlineCappedToast', {
            away,
            settled,
            activity: data.activityName,
            cycles: data.cycles,
          }),
        );
        flowFloat(
          T('events.offlineCappedLog', {
            away,
            settled,
            items: items || T('events.offlineNoYield'),
            exp: data.exp > 0 ? T('events.offlineExpSuffix', { exp: data.exp }) : '',
          }),
        );
      } else {
        toast(
          T('events.offlineToast', {
            away,
            activity: data.activityName,
            cycles: data.cycles,
          }),
        );
        flowFloat(
          T('events.offlineLog', {
            away,
            items: items || T('events.offlineNoYield'),
            exp: data.exp > 0 ? T('events.offlineExpSuffix', { exp: data.exp }) : '',
          }),
        );
      }
    },
    reject: (event) => {
      toast(String(event.data.message ?? T('events.rejectFallback')), 'red');
    },

    /* —— 无呈现（活动心跳/时钟/访问段信号：流水归 #33，信号归引擎段聚合）—— */
    tick: () => {},
    'activity-start': () => {},
    'activity-stop': () => {},
    'activity-complete': () => {},
    'visit:begin': () => {},
    'visit:end': () => {},
  };

  events.subscribe((event) => {
    // 订阅口守卫（#47 锐边①裁决，#34 收口）：类型纪律负责字段存在（死防御已随
    // handler 表重写清理，#47 遗留②），运行期只兜两类契约外输入——未知 type 键
    //（旧档/未来事件）与 handler 抛错（缺字段等畸形载荷）。二者都不许中断重绘
    // 循环：warn 后收下该条，与 desktop.ts 缺-data 静默不上报同策略（两侧守卫
    // 口径一致）。
    const run = handlers[event.type as GameEvent['type']] as ((e: GameEvent) => void) | undefined;
    if (run === undefined) {
      console.warn(`[wendao] unhandled event type: ${String((event as { type?: unknown }).type)}`);
    } else {
      try {
        run(event);
      } catch (err) {
        console.warn(`[wendao] event handler failed: ${String((event as { type?: unknown }).type)}`, err);
      }
    }
    scheduleRender();
  });

  /* ---------- 渲染（壳核） ---------- */

  const signature = (st: GameState, snap: SaveData): string =>
    // 修行录页（#33）走低频签名：列表由页 update 以 seq 差量增量追加（AC：
    // 挂页时连续掉落不得整页重建——items/gold 等高频字段不进本页签名），
    // 顶栏读数照常每帧轻刷。换页即回落全量签名（activeTab 变 → 签名变）。
    activeTab === 'journal'
      ? JSON.stringify([
          activeTab,
          st.journal?.seq ?? 0,
          st.journalOpen ?? null,
          st.journalAnchor ?? null,
          snap.stats ?? null,
        ])
      : JSON.stringify([
      activeTab,
      Math.floor(st.gold),
      Object.entries(st.items).sort(),
      Object.entries(st.skills).map(([id, p]) => [id, p.xp]).sort(),
      st.activity ? [st.activity.skillId, st.activity.index] : null,
      st.combat
        ? [
            st.combat.enemyId,
            st.combat.respT > 0,
            // Boss 阶段徽标随阶段下标重绘（#50 瘦身后保留的结构项）。
            // hp 类项（ehp/summons/自血）已移出：实况值归页级 update 定点
            // 补丁（refreshCombatLive），战斗中逐击不再整页重建。
            st.combat.bossPhase,
          ]
        : null,
      Object.entries(st.equips),
      st.gear.length,
      st.gearSeq,
      Object.keys(st.buffs).sort(),
      st.autoFight,
      st.autoEat,
      // 配方自动化规则（#35）进签名：同类玩家设置（autoFight/autoEat）同律——
      // 规则变更必须触发重绘，否则下拉选中态静默 stale（不依赖派发路径的强刷兜底）。
      Object.entries(st.recipeAuto ?? {}).map(([k, r]) => [k, r.mode, r.maxRarity ?? '']).sort(),
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
      // 引擎视图投影（#40）：敌生效视图/有效 interval 进签名——Boss 阶段修正
      // 与 interval 缩放触发重建，漏加 = 签名不变 → 静默 stale render。
      // 召唤行投影（minions）自 #50 移出签名：行内 hp 是逐击活值，行组结构
      //（入场/阵亡/换阶段）归页级 update 定点补丁（refreshCombatLive）。
      snap.enemy ?? null,
      snap.activityIntervals ?? null,
      // 注：页面自持 UI 状态（技能选中/兵解 arm）不进签名——其变化路径
      // 均经 env.render() 强制重绘（lastSig=''），等价搬迁前行为（#46 D2/D8）。
    ]);

  function render(): void {
    const snap = getSnapshot();
    // 类型化快照（#50 D2）：state 即 Readonly<GameState>，壳层零 cast。
    const st = snap.state;

    goldEl.textContent = Math.floor(st.gold).toLocaleString(locale);
    const cap = snap.stats?.maxHp ?? Math.max(1, Math.floor(st.hp));
    hpFill.style.width = `${pctClamped(st.hp, cap)}%`;
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
      // 修行录页增量路径（#33 AC）：骨架在场时数据面只走页末 update（seq 差量
      // 追加/净收获轻刷），不整页重建——挂页时连续掉落由增量追加承载；
      // 其余页面（含修行录首次挂载、骨架缺失）走全量挂载路径。
      const journalIncremental = activeTab === 'journal' && pageEl.querySelector('#jr-list');
      if (!journalIncremental) {
        // 页面挂载（D1：注册表查找分发，if/else 与坊市兜底退役）。
        pageEl.innerHTML = pages[activeTab].render({ st, snap, content, T });
        // 战斗日志持久体重挂（#34 持久层机制）：内容体自持于壳层，重建后按
        // 锚点（页内 #flog 槽）replaceWith 重挂——flogBuffer 重放 hack 退役。
        // 换血会脱离文档流使真实浏览器 scrollTop 归零（happy-dom 不模拟滚动，
        // 测试盲区），重挂即恢复滚底语义（日志跟随到底，非旧"滚动恢复 hack"）。
        const slot = pageEl.querySelector<HTMLElement>('#flog');
        if (slot && slot !== flogBox) {
          slot.replaceWith(flogBox);
          flogBox.scrollTop = flogBox.scrollHeight;
        }
      }
    }
    // 实况区差量刷新（D3）：进度条/血条归所在页 update（#50 渲染管线的落点）。
    pages[activeTab].update?.({ st, snap, content, T });
    // 档一飘字位置随页面重绘刷新（#34：按锚点重查询刷新位置）。
    positionCombatFloats();
  }

  /** 顶栏增益条：剩余时长轻量刷新（每帧），结构变化由键签名驱动。 */
  function renderBuffbar(st: GameState, now: number): void {
    const entries = Object.entries(st.buffs);
    // 同数量换 buff（A 到期 + B 服下）childElementCount 不变，按数量判重建会
    // 旧 chip 永挂——改比键签名（signature() 同策略）。
    const sig = entries.map(([id]) => id).sort().join(',');
    if (sig !== lastBuffSig) {
      lastBuffSig = sig;
      buffbarEl.innerHTML = entries
        .map(([id]) => {
          const item = itemById.get(id);
          return `<span class="buff-chip" data-buff="${id}" title="${esc(T('common.buffTimerOnlineOnly'))}">${esc(item?.icon ?? T('icons.buff'))} ${esc(item?.name ?? id)} <b></b></span>`;
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

  /* ---------- 战斗日志（#34 持久体重挂；槽由斗法/秘境页渲染） ---------- */

  /**
   * 战斗日志持久体：内容体由壳层自持，页面重建后 replaceWith 重挂进页内
   * #flog 槽（见 render()）——容量受控作用于真实 DOM（环形删头）。
   */
  const flogBox = document.createElement('div');
  flogBox.className = 'flog';
  flogBox.id = 'flog';

  function flog(text: string, cls = ''): void {
    appendFlogLine(flogBox, text, cls);
  }

  function appendFlogLine(box: HTMLElement, text: string, cls: string): void {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    box.appendChild(div);
    while (box.children.length > MAX_FLOG) box.firstElementChild?.remove();
    // 追加即滚底（日志跟随）；滚动位随节点存活，重建后无需恢复 hack。
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- 浮提示与飘字（#34 反馈枢纽幸存 sink） ---------- */

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
    toast,
  };
}
