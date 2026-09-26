/**
 * UI 壳核（issue #3；#46 页面注册表后收敛）：导航/顶栏/signature/事件委托/刷新循环。
 *
 * 页面本体住 src/pages/<tab>.ts（注册表装配见 pages.ts，同构零件见 pageFrame.ts）；
 * 本文件只保留壳级职责：顶栏血球/灵石、页签导航（含可用性开关与文案解析）、
 * 状态签名差量重绘、增益条、战斗日志缓冲、事件→日志/浮提示接线。
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
  log(text: string, cls?: string): void;
  toast(text: string, kind?: 'gold' | 'red'): void;
}

const MAX_LOG = 40;
const MAX_FLOG = 60;
/** 访问段信号页（#39 坊市 + #33 乾坤袋）：切进/切出各一对 visit 信号。 */
const VISIT_PAGES: ReadonlySet<string> = new Set(['shop', 'bag']);

export function buildUi(
  root: HTMLElement,
  content: ContentPack,
  getSnapshot: () => SaveData,
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
    <div class="layout">
      <main class="page-root" id="page-root"></main>
      <aside class="side">
        <h3 class="side-title">${esc(T('side.title'))}</h3>
        <ul class="log" id="log"></ul>
      </aside>
    </div>
    <footer class="version-line">${esc(
      T('footer.versionLine', {
        name: T('brand.name'),
        // 类型必填 ≠ 运行时必有：测试夹具/旧形态包缺 version 时回退空串，
        // 不让页脚渲染出 "undefined"（防御路径，与缺键回显同策略）。
        content: content.version ?? '',
        engine: ENGINE_VERSION,
      }),
    )}</footer>
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

  const nameOf = (id: unknown): string => itemById.get(String(id))?.name ?? String(id);

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

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !handler) return;
    const act = el.dataset.act ?? '';
    if (act === 'tab') {
      // 导航动作留壳核（D4）：页内渲染的指向按钮同走此路径。
      navigate(normalizeTab(el.dataset.tab));
      return;
    }
    // 本页动作委托注册表（D1/D4）：巨型 click switch 整体退役。
    pages[activeTab].handleAction?.(act, el);
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
    // #47 判别联合：case 内 event.data 自动窄化为该事件的载荷类型
    //（字段名拼错 = 编译错）；各 case 自取 data，壳层 handler 表结构不动。
    switch (event.type) {
      case 'loot': {
        const data = event.data;
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
      }
      case 'attack': {
        // 战斗叙事：完整文案入战斗日志（伤害已嵌入 {d} 槽，非干瘪直出）
        const data = event.data;
        flog(String(data.text ?? ''), data.side === 'player' ? (data.crit ? 't-gold' : 't-jade') : 't-red');
        break;
      }
      case 'combat-note': {
        const data = event.data;
        flog(String(data.text ?? ''), 't-sys');
        break;
      }
      case 'victory': {
        const data = event.data;
        const compare = data.compare ? T('common.compareWrap', { compare: String(data.compare) }) : '';
        // 战利品段（#62 保真收口，旧版"得灵石 X，缴获…"回迁战斗日志）：
        // 材料 + 器胚/异宝（gearDropName）并列；空缴获回落"无所获"占位。
        const spoilNames = ((data.drops as readonly string[] | undefined) ?? []).map((id) => nameOf(id));
        if (typeof data.gearDropName === 'string' && data.gearDropName) {
          spoilNames.push(`【${data.gearDropName}】`);
        }
        const spoil = T('events.victorySpoil', {
          gold: String(data.gold ?? 0),
          loot: spoilNames.join(T('common.itemListSep')) || T('events.offlineNoYield'),
        });
        const victoryVars = {
          name: String(data.enemyName ?? ''),
          summary: String(data.summary ?? ''),
          compare,
          spoil,
        };
        flog(T('events.victoryFlog', victoryVars), 't-gold');
        log(T('events.victoryLog', victoryVars), 't-gold');
        break;
      }
      case 'defeat': {
        const data = event.data;
        flog(T('events.defeatFlog', { name: String(data.enemyName ?? '') }), 't-red');
        toast(T('events.defeatToast'), 'red');
        break;
      }
      case 'consumable:eat': {
        const data = event.data;
        if (data.kind === 'heal') {
          flog(T('events.eatHeal', { name: String(data.itemName ?? ''), healed: Number(data.healed ?? 0) }), 't-sys');
        } else {
          toast(T('events.eatBuffToast', { name: String(data.itemName ?? '') }));
          log(T('events.eatBuffLog', { name: String(data.itemName ?? ''), minutes: Number(data.minutes ?? 0) }), 't-jade');
        }
        break;
      }
      case 'equip:wear': {
        const data = event.data;
        toast(T('events.equipWearToast', { name: String(data.name ?? '') }));
        log(T('events.equipWearLog', { name: String(data.name ?? '') }), 't-jade');
        break;
      }
      case 'equip:remove': {
        const data = event.data;
        log(T('events.equipRemoveLog', { name: String(data.name ?? '') }));
        break;
      }
      case 'gear:smelt': {
        // 熔炼（#14）：{shard} 槽 = 器屑物品展示名（content 数据直出）。
        const data = event.data;
        log(
          T('events.gearSmelt', {
            name: String(data.name ?? ''),
            shard: nameOf(data.item),
            count: Number(data.shards ?? 0),
          }),
          't-jade',
        );
        break;
      }
      case 'gear:reforge': {
        const data = event.data;
        log(T('events.gearReforge', { name: String(data.name ?? ''), tier: Number(data.tier ?? 0) }), 't-jade');
        break;
      }
      case 'exp': {
        // 引擎 exp 事件的数值字段是 amount（grantExp 载荷），非 exp。
        const data = event.data;
        if (data.skillId === combatSkillId) flog(T('events.expCombat', { amount: Number(data.amount ?? 0) }), 't-sys');
        break;
      }
      case 'levelup': {
        const data = event.data;
        toast(T('events.levelupToast', { name: String(data.skillName ?? ''), level: Number(data.level ?? 0) }));
        log(T('events.levelupLog', { name: String(data.skillName ?? ''), level: Number(data.level ?? 0) }), 't-gold');
        break;
      }
      case 'sell': {
        const data = event.data;
        log(T('events.sellLog', { name: String(data.itemName ?? ''), gained: Number(data.gained ?? 0) }));
        break;
      }
      case 'buy': {
        const data = event.data;
        log(T('events.buyLog', { name: String(data.itemName ?? ''), count: Number(data.count ?? 0), cost: Number(data.cost ?? 0) }));
        break;
      }
      case 'reject': {
        const data = event.data;
        toast(String(data.message ?? T('events.rejectFallback')), 'red');
        break;
      }
      case 'craft-fail': {
        const data = event.data;
        log(T('events.craftFail', { name: String(data.recipeName ?? ''), exp: Number(data.exp ?? 0) }), 't-red');
        break;
      }
      case 'craft-halt': {
        const data = event.data;
        toast(T('events.craftHalt', { name: String(data.recipeName ?? '') }), 'red');
        log(T('events.craftHalt', { name: String(data.recipeName ?? '') }), 't-red');
        break;
      }
      case 'rebirth': {
        const data = event.data;
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
      }
      case 'talent:buy': {
        const data = event.data;
        toast(T('events.talentBuyToast', { name: String(data.name ?? ''), cost: Number(data.cost ?? 0) }));
        log(T('events.talentBuyLog', { name: String(data.name ?? ''), daoYun: Number(data.daoYun ?? 0) }), 't-jade');
        break;
      }
      case 'dungeon:enter': {
        const data = event.data;
        toast(T('events.dungeonEnter', {
          name: String(data.dungeonName ?? ''),
          floor: Number(data.floor ?? 0),
          floors: Number(data.floors ?? 0),
        }));
        break;
      }
      case 'dungeon:floor': {
        // 层奖励行：{items} 槽由壳按 nameOf + itemListSep 拼装（offlineLog 同律）；
        // 道韵后缀（events.dungeonDaoYun）仅在实际入账时拼接。
        const data = event.data;
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
      case 'dungeon:clear': {
        const data = event.data;
        toast(T('events.dungeonClear', { name: String(data.dungeonName ?? ''), floors: Number(data.floors ?? 0) }));
        break;
      }
      case 'dungeon:leave': {
        const data = event.data;
        log(
          T('events.dungeonLeave', {
            name: String(data.dungeonName ?? ''),
            floor: Number(data.floor ?? 0),
            best: Number(data.best ?? 0),
          }),
          't-sys',
        );
        break;
      }
      case 'boss:summon': {
        // Boss 召唤入场（#47 D2 缺口事件）：战斗日志一行叙事；呈现细节归 #34。
        const data = event.data;
        flog(T('events.bossSummon', { enemy: data.enemyName, count: data.count }), 't-red');
        break;
      }
      case 'boss:phase': {
        // Boss 阶段转场（#8）：{enemy} 敌名 / {name} 阶段名 / {phase} 阶段序号。
        const data = event.data;
        toast(
          T('events.bossPhase', {
            enemy: data.enemyName,
            name: data.name,
            phase: data.phase,
          }),
        );
        log(
          T('events.bossPhase', {
            enemy: data.enemyName,
            name: data.name,
            phase: data.phase,
          }),
          't-red',
        );
        break;
      }
      case 'achievement:unlock': {
        // 成就达成（#9）：浮提示 + 修行录行；奖励已在引擎入账，页面卡片承载展示。
        const data = event.data;
        toast(T('events.achievementToast', { name: data.name }));
        log(T('events.achievementLog', { name: data.name }), 't-gold');
        break;
      }
      case 'offline-settled': {
        const data = event.data;
        const seconds = Math.max(0, Math.floor(Number(data.seconds) || 0));
        // 离线上限钳制时引擎双报（awaySeconds=真实离开 / seconds=实际结算）：
        // 切 offlineCapped* 模板区分展示，防结算时长冒充离开时长（挂机 20h
        // 只显示"离线修行 1 时"事故）；旧形状（无 capped）回落单时长口径。
        const capped = data.capped === true;
        const awaySeconds = Math.max(0, Math.floor(Number(data.awaySeconds) || 0)) || seconds;
        const fmtDuration = (v: number): string => {
          const h = Math.floor(v / 3600);
          const m = Math.floor((v % 3600) / 60);
          return h > 0
            ? T('units.hourMinute', { h, m })
            : m > 0
              ? T('units.minute', { m })
              : T('units.seconds', { v });
        };
        const away = fmtDuration(capped ? awaySeconds : seconds);
        const settled = fmtDuration(seconds);
        const items = Object.entries((data.items ?? {}) as Record<string, number>)
          .map(([id, n]) => `${nameOf(id)}×${n}`)
          .join(T('common.itemListSep'));
        if (capped) {
          toast(
            T('events.offlineCappedToast', {
              away,
              settled,
              activity: String(data.activityName ?? ''),
              cycles: Number(data.cycles ?? 0),
            }),
          );
          log(
            T('events.offlineCappedLog', {
              away,
              settled,
              items: items || T('events.offlineNoYield'),
              exp: data.exp ? T('events.offlineExpSuffix', { exp: Number(data.exp) }) : '',
            }),
            't-gold',
          );
        } else {
          toast(T('events.offlineToast', { away, activity: String(data.activityName ?? ''), cycles: Number(data.cycles ?? 0) }));
          log(
            T('events.offlineLog', {
              away,
              items: items || T('events.offlineNoYield'),
              exp: data.exp ? T('events.offlineExpSuffix', { exp: Number(data.exp) }) : '',
            }),
            't-gold',
          );
        }
        break;
      }
      case 'activity-start': // 活动启停/心跳/账本无即时呈现（#47 D2 缺口事件显式 no-op；
      case 'activity-complete': // 活动条/修行录呈现归 #34/#33 的 handler 表重写）
      case 'activity-stop':
      case 'tick':
      case 'ledger':
      case 'visit:begin': // 访问段信号（#39）：壳层派发→引擎纯转发回环，段落账归 #33
      case 'visit:end':
        break;
      default: {
        // 穷尽断言（#47 D2）：引擎新增事件类型而壳层漏接 = never 赋值编译错
        //（删任一 case 同理）。运行时兜底不可达，仅防御性 warn。
        const unhandled: never = event;
        void unhandled;
        break;
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
            Math.floor(st.combat.ehp),
            st.combat.respT > 0,
            // 召唤物槽位（#30）：入场/击杀/掉血随签名重绘。
            st.combat.summons.map((m) => [m.enemyId, Math.floor(m.hp)]),
          ]
        : null,
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
      // 引擎视图投影（#40）：投影任何变化（Boss 阶段修正/召唤入场/interval
      // 缩放）都触发页面重建——漏加 = 签名不变 → 静默 stale render。
      snap.enemy ?? null,
      snap.minions ?? null,
      snap.activityIntervals ?? null,
      // 注：页面自持 UI 状态（技能选中/兵解 arm）不进签名——其变化路径
      // 均经 env.render() 强制重绘（lastSig=''），等价搬迁前行为（#46 D2/D8）。
    ]);

  function render(): void {
    const snap = getSnapshot();
    const st = snap.state as unknown as GameState;

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
        // 页面重建会丢滚动位置与日志内容：全量重放战斗日志并恢复到底部
        //（挂 #flog 的页面自动恢复——斗法/秘境）。
        const box = pageEl.querySelector<HTMLElement>('#flog');
        if (box) {
          box.innerHTML = '';
          for (const line of flogBuffer) appendFlogLine(box, line.text, line.cls);
        }
      }
      syncFlogScroll();
    }
    // 实况区差量刷新（D3）：进度条/血条归所在页 update（#50 渲染管线的落点）。
    pages[activeTab].update?.({ st, snap, content, T });
    syncFlogScroll();
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

  /* ---------- 战斗日志（壳层事件接线；容器由斗法/秘境页渲染） ---------- */

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

  /* ---------- 修行录与浮提示 ---------- */

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
