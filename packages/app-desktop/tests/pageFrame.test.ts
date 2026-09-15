/**
 * 页框零件直测（#46 D10/AC2/AC5）：六件零件不挂游戏，纯函数进 HTML 串。
 * T 用桩（缺键回显键名同生产策略）；修为曲线用可手算的小参数表。
 */
import { describe, expect, it } from 'vitest';
import type { ProgressionParams } from '@wendao/engine';
import {
  actBarHtml,
  actCardHtml,
  actKeyOf,
  actLockHtml,
  actPctOf,
  actStartBtnHtml,
  actStopBtnHtml,
  actYieldHtml,
  levelLockMsgOf,
  skillChipHtml,
  statusActHtml,
  statusCardHtml,
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
});
