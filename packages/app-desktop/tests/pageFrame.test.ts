// @vitest-environment happy-dom
/**
 * 页框零件直测（#46 D10/AC2/AC5）：六件零件 + 实况刷新共用体，不挂游戏。
 * T 用桩（缺键回显键名同生产策略）；修为曲线用可手算的小参数表；
 * 引擎视图桩（bosses/dungeons/items）按 contentView 形状最小构造。
 */
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@wendao/content';
import type { GameState, ProgressionParams, SaveData } from '@wendao/engine';
import {
  actBarHtml,
  actCardHtml,
  actKeyOf,
  actLockHtml,
  actPctOf,
  actStartBtnHtml,
  actStopBtnHtml,
  actYieldHtml,
  bossDecoOf,
  consumablesHtml,
  dungeonLockMsgOf,
  fightingEnemyCardHtml,
  levelLockMsgOf,
  minionsHtml,
  pctClamped,
  refreshActivityBars,
  refreshEnemyBar,
  skillChipHtml,
  statusActHtml,
  statusCardHtml,
  selfStatsTextOf,
  xpReadOf,
  xpSubTextOf,
} from '../src/pageFrame';

/** 可手算曲线：xpStep(L) = 10·L —— L1→2 需 10，L2→3 需 20，L3 封顶。 */
const prog: ProgressionParams = {
  maxLevel: 3,
  xpPowCoef: 10,
  xpExponent: 1,
  xpLinearCoef: 0,
  hpBase: 100,
  hpPerLevel: 10,
  hpRegenPerSec: 0,
};

const T = (key: string, vars?: Readonly<Record<string, string | number>>): string => {
  if (!vars) return key;
  return `${key}?${Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')}`;
};

describe('#46 · activity-pct（件6）与活动条小件', () => {
  it('actPctOf：interval 缺失/非正 → 0；封顶 100；正常按比例', () => {
    expect(actPctOf(50, undefined)).toBe(0);
    expect(actPctOf(50, 0)).toBe(0);
    expect(actPctOf(5, 10)).toBe(50);
    expect(actPctOf(15, 10)).toBe(100);
  });

  it('actKeyOf：活动寻址键单一拼装式（#40 口径不变）', () => {
    expect(actKeyOf({ skillId: 'herb', index: 2 })).toBe('herb:2');
  });

  it('actBarHtml：键控细进度条（update 差量刷新锚点）', () => {
    expect(actBarHtml('herb:0', 42)).toBe(
      '<div class="bar bar-thin"><i data-bar="activity" data-key="herb:0" style="width:42%"></i></div>',
    );
  });

  it('开工/停工/锁定操作件逐字形态', () => {
    expect(actStartBtnHtml('herb', 1, '开<采')).toBe(
      '<button class="btn" data-act="start" data-skill="herb" data-index="1">开&lt;采</button>',
    );
    expect(actStopBtnHtml('停')).toBe(
      '<button class="btn btn-ghost" data-act="stop">停</button>',
    );
    expect(actLockHtml('需 <n> 层')).toBe('<span class="act-lockmsg">需 &lt;n&gt; 层</span>');
  });
});

describe('#46 · xp 头（件3）', () => {
  it('xpReadOf：层数/需求/已入/百分比一次算清（手算对拍）', () => {
    expect(xpReadOf(0, prog)).toEqual({ level: 1, need: 10, into: 0, pct: 0 });
    expect(xpReadOf(15, prog)).toEqual({ level: 2, need: 20, into: 5, pct: 25 });
  });

  it('封顶层：need=Infinity → pct=100，副行走 expMax 键', () => {
    const read = xpReadOf(999, prog);
    expect(read.level).toBe(3);
    expect(Number.isFinite(read.need)).toBe(false);
    expect(read.pct).toBe(100);
    expect(xpSubTextOf(T, 'pages.skills', read)).toBe('pages.skills.expMax');
  });

  it('xpSubTextOf：有限 need 走 expSub 模板（into/need/left 槽）', () => {
    expect(xpSubTextOf(T, 'pages.craft', xpReadOf(15, prog))).toBe(
      'pages.craft.expSub?into=5&need=20&left=15',
    );
  });

  it('skillChipHtml：选中/锁定态与关闭态三形', () => {
    const base = { T, id: 'herb', icon: '草', name: '采药', level: 3 };
    expect(skillChipHtml({ ...base, selected: false, action: 'craftskill' })).toContain('class="chip"');
    expect(skillChipHtml({ ...base, selected: true, action: 'skill' })).toContain('class="chip selected"');
    const locked = skillChipHtml({ ...base, selected: false, action: 'skill', locked: true, lockText: '兵解后解锁' });
    expect(locked).toContain('chip locked');
    expect(locked).toContain('data-disabled="y"');
    expect(locked).toContain('<em class="chip-lock">兵解后解锁</em>');
    expect(locked).not.toContain('chip-lv');
  });
});

describe('#46 · statusCard（件1）', () => {
  it('骨架：图标/名称/层数/修为条/副行/act 区各就位；desc 缺省省略', () => {
    const html = statusCardHtml({
      T,
      icon: '斗',
      name: '斗法',
      level: 2,
      expPct: 25,
      expSub: '5/20',
      actHtml: '<div class="act-now idle"><span>X</span></div>',
    });
    expect(html).toContain('<section class="status-card">');
    expect(html).toContain('<span class="status-lv">units.level?v=2</span>');
    expect(html).not.toContain('status-desc');
    expect(html).not.toContain('status-realm');
    expect(html).toContain('<div class="bar"><i style="width:25%"></i></div>');
    expect(html).toContain('<div class="status-sub">5/20</div>');
  });

  it('境界行/描述行可选注入（修炼页专属槽位）', () => {
    const html = statusCardHtml({
      T,
      icon: '斗',
      name: '斗法',
      level: 2,
      desc: '凡人斗法',
      realmHtml: '<div class="status-realm">R</div>',
      expPct: 0,
      expSub: '',
      actHtml: '',
    });
    expect(html).toContain('<span class="status-desc">凡人斗法</span>');
    expect(html).toContain('<div class="status-realm">R</div>');
  });

  it('statusActHtml：进行中 = act-now + 键控条 + 停工；空闲 = idle 行', () => {
    const running = statusActHtml({
      running: { label: '进行中', key: 'herb:0', pct: 50, stopLabel: '停' },
      idleText: '挂机',
    });
    expect(running).toContain('<b data-act-pct data-key="herb:0">50%</b>');
    expect(running).toContain('data-bar="activity"');
    expect(running).toContain('data-act="stop"');
    const idle = statusActHtml({ running: null, idleText: '挂机中' });
    expect(idle).toBe('<div class="act-now idle"><span>挂机中</span></div>');
  });
});

describe('#46 · act 卡（件2）', () => {
  it('骨架：running/locked 修饰类、徽标随 running、body/op 直插', () => {
    const plain = actCardHtml({ title: '采青', body: '<p>B</p>' });
    expect(plain).toContain('<article class="act-card">');
    expect(plain).toContain('<header><b>采青</b></header>');
    const running = actCardHtml({ title: '采青', running: true, runningBadge: '进行中', body: 'B', op: 'O' });
    expect(running).toContain('act-card running');
    expect(running).toContain('<em class="act-badge">进行中</em>');
    const locked = actCardHtml({ title: '采青', locked: true, body: 'B' });
    expect(locked).toContain('act-card locked');
    expect(locked).not.toContain('act-badge');
  });

  it('actYieldHtml：产出行 = 图标 + 名称 ×数量 + 可选徽标', () => {
    expect(actYieldHtml({ icon: '草', name: '青灵草', count: 1 })).toContain('青灵草 ×1');
    const withBonus = actYieldHtml({ icon: '草', name: '青灵草', count: 2, bonusHtml: '<span class="act-bonus">B</span>' });
    expect(withBonus).toContain('<span class="act-bonus">B</span>');
  });
});

describe('#46 · gate+lockMsg（件4）', () => {
  it('道韵门优先于层数门（三处散抄收敛同律）', () => {
    expect(levelLockMsgOf(T, { locked: true, requiredDaoYun: 10 }, 5)).toBe('common.needDaoYun?daoYun=10');
    expect(levelLockMsgOf(T, { locked: false, requiredDaoYun: 0 }, 5)).toBe('common.needLevel?level=5');
  });

  it('dungeonLockMsgOf：道韵锁优先；余下钥匙句（dungeonGateOf 单一来源，缺门=锁）', () => {
    const content = {
      items: [{ id: 'ghost_key', name: '鬼庙钥符', icon: '钥', type: 'mat', sell: 1 }],
      dungeons: [
        { id: 'yaoku', name: '妖窟秘境', floors: 10, entry: { daoYun: 10 } },
        { id: 'guimiao', name: '鬼庙秘境', floors: 15, entry: { key: 'ghost_key' } },
      ],
    } as unknown as ContentPack;
    const st = { daoYunEarned: 0, items: {} } as GameState;
    expect(dungeonLockMsgOf(T, content, st, 'yaoku')).toBe('common.needDaoYun?daoYun=10');
    // 钥匙句：无钥匙 → 物品名照出（展示面直出，持有与否归 gate.locked）
    expect(dungeonLockMsgOf(T, content, st, 'guimiao')).toBe('pages.dungeon.entryKey?item=鬼庙钥符');
    // 未知 dungeonId → 引擎安全兜底 locked 门（无 keyItem → 落 entryKey 空槽；
    // 实际不可达：页面只迭代真实 dungeons 列表）
    expect(dungeonLockMsgOf(T, content, st, 'nope')).toBe('pages.dungeon.entryKey?item=');
  });
});

/* ---------- 件5 · 战斗敌卡族（斗法/秘境共用） ---------- */

const statValueText = (stat: string, value: number | string): string =>
  stat === 'crit' ? `${value}%` : `${value}`;

describe('#46 · 战斗敌卡（件5）', () => {
  const st = { hp: 87, combat: { enemyId: 'e1', ehp: 38.2, bossPhase: 0, respT: 0 }, buffs: {} } as unknown as GameState;
  const snap = {
    stats: { atk: 25, def: 8, crit: 5, maxHp: 146 },
    minions: [{ minion: { hp: 12.4 }, view: { icon: '仆', name: '石俑', hp: 40 } }],
  } as unknown as SaveData;

  it('bossDecoOf：非 Boss = 空徽标零刻度；Boss = 阶段徽标 + 阈值刻度', () => {
    const plain = { enemies: [] } as unknown as ContentPack;
    expect(bossDecoOf(plain, st)).toEqual({ badge: '', ticks: '' });
    const bossPack = {
      enemies: [],
      bosses: [{ enemy: 'e1', phases: [{ name: '狂化', threshold: 0.5 }] }],
    } as unknown as ContentPack;
    const deco = bossDecoOf(bossPack, st);
    expect(deco.badge).toBe('<em class="act-badge boss-phase">狂化</em>');
    expect(deco.ticks).toBe('<i class="tick" style="left:50%"></i>');
  });

  it('minionsHtml：首槽集火徽标 + 血量行（快照投影直出）', () => {
    const html = minionsHtml(T, snap);
    expect(html).toContain('minion-row focus');
    expect(html).toContain('<b>石俑</b>');
    expect(html).toContain('pages.combat.engagedBadge');
    expect(html).toContain('data-bar="minion"');
  });

  it('selfStatsTextOf：hp/max/atk/def/crit 槽齐出（量纲由 statValueText 决定）', () => {
    expect(selfStatsTextOf(T, statValueText, st, snap)).toBe(
      'pages.combat.selfStats?hp=87&max=146&atk=25&def=8&crit=5%',
    );
  });

  it('fightingEnemyCardHtml：骨架 = 敌血条(data-bar=enemy) + 召唤行 + 自血条 + 操作区', () => {
    const deco = bossDecoOf({ enemies: [] } as unknown as ContentPack, st);
    const html = fightingEnemyCardHtml({
      T,
      icon: '狼',
      name: '青鬃狼',
      level: 1,
      headBadges: deco.badge,
      decoTicks: deco.ticks,
      ehpPct: pctClamped(30, 60),
      ehpText: T('pages.combat.enemyHp', { ehp: 30, hp: 60 }),
      minions: minionsHtml(T, snap),
      hpPct: pctClamped(87, 146),
      selfStatsText: selfStatsTextOf(T, statValueText, st, snap),
      opsHtml: '<button data-act="flee">撤</button>',
    });
    expect(html).toContain('<article class="enemy-card fighting">');
    expect(html).toContain('<i data-bar="enemy" style="width:50%"></i>');
    expect(html).toContain('<div class="minion-rows">');
    expect(html).toContain('<button data-act="flee">撤</button>');
  });

  it('consumablesHtml：只列持有消耗品（icon 名 ×数量）', () => {
    const content = {
      items: [
        { id: 'heal1', name: '回气丹', icon: '回', type: 'consumable', sell: 1 },
        { id: 'herb1', name: '青灵草', icon: '草', type: 'mat', sell: 1 },
      ],
    } as unknown as ContentPack;
    const bag = { items: { heal1: 2 } } as unknown as GameState;
    const html = consumablesHtml(content, bag);
    expect(html).toContain('回气丹 ×2');
    expect(html).toContain('data-act="eat" data-item="heal1"');
    expect(html).not.toContain('青灵草');
  });
});

describe('#46 · 实况刷新共用体（update 单一实现，D3）', () => {
  it('refreshActivityBars：进行中键充能、其余归零（含 data-act-pct 文本）', () => {
    document.body.innerHTML = `
      <div id="page">
        <i data-bar="activity" data-key="qi:0" style="width:9%"></i>
        <b data-act-pct data-key="qi:0">9%</b>
        <i data-bar="activity" data-key="herb:0" style="width:9%"></i>
      </div>`;
    const pageEl = document.querySelector<HTMLElement>('#page')!;
    const st = { activity: { skillId: 'qi', index: 0, progress: 500 } } as unknown as GameState;
    const snap = { activityIntervals: { 'qi:0': 1000 } } as unknown as SaveData;
    refreshActivityBars(pageEl, st, snap);
    const running = pageEl.querySelector<HTMLElement>('[data-key="qi:0"][data-bar]');
    const idle = pageEl.querySelector<HTMLElement>('[data-key="herb:0"]');
    expect(running?.style.width).toBe('50%');
    expect(pageEl.querySelector<HTMLElement>('[data-act-pct]')?.textContent).toBe('50%');
    expect(idle?.style.width).toBe('0%');
  });

  it('refreshEnemyBar：无战斗/无投影时不动手；有战斗按投影钳宽', () => {
    document.body.innerHTML = `<div id="page"><i data-bar="enemy" style="width:100%"></i></div>`;
    const pageEl = document.querySelector<HTMLElement>('#page')!;
    const idleState = { combat: null } as unknown as GameState;
    refreshEnemyBar(pageEl, idleState, { enemy: { hp: 60 } } as unknown as SaveData);
    expect(pageEl.querySelector<HTMLElement>('[data-bar="enemy"]')?.style.width).toBe('100%');
    const fighting = { combat: { enemyId: 'e1', ehp: 15 } } as unknown as GameState;
    refreshEnemyBar(pageEl, fighting, { enemy: { hp: 60 } } as unknown as SaveData);
    expect(pageEl.querySelector<HTMLElement>('[data-bar="enemy"]')?.style.width).toBe('25%');
  });

  it('pctClamped：封顶 100、负值归 0、total 非正按 1 兜底', () => {
    expect(pctClamped(15, 60)).toBe(25);
    expect(pctClamped(70, 60)).toBe(100);
    expect(pctClamped(-1, 60)).toBe(0);
    expect(pctClamped(0.5, 0)).toBe(50);
  });
});
