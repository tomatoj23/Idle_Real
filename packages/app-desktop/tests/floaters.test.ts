// @vitest-environment happy-dom
/**
 * #34 飘字两档 + 右侧栏退场：反馈枢纽行为面（壳 UI 缝，happy-dom）。
 *
 * - 档一战斗飘字：attack 逐击不聚合、锚定敌卡层；胜利不飘字（AC2）。
 * - 档二获取飘字：侧栏流水平移、同类 3 秒短窗聚合（单形→floatSum 聚合形）、
 *   堆叠限高（AC5）。
 * - 修为口径（AC4）：普通周期无飘字，升级才飘读数。
 * - 侧栏 DOM 与 log() sink 完全退场；战斗日志持久体重挂（重放缓冲退役）。
 *
 * 夹具壳文案只配被测键，其余键名回显（防御路径与生产同码）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ContentPack } from '@wendao/content';
import { sectionSchemas } from '@wendao/content';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 最小包：单战斗技能 + 回气丹 + 单档词表（仅补被测模板键）。 */
function makePack(): ContentPack {
  return {
    skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
    items: [
      { id: 'heal', name: '回气丹', icon: '回', type: 'consumable', sell: 18, heal: { percent: 0.3 } },
      { id: 'ore', name: '铁矿石', icon: '矿', type: 'material', sell: 2 },
    ],
    recipes: [],
    enemies: [],
    gearDrops: [],
    rarities: [{ id: 'plain', name: '朴素', weight: 1, mult: 1, affix: 0, sell: 1 }],
    affixPool: [],
    combatText: {},
    texts: {
      shell: {
        brand: { sigil: '道', name: '试炼', locale: 'zh-CN', bootError: '中止：{message}' },
        topbar: { statsTitle: '属', statsSigil: '斗', goldTitle: '灵石', goldSigil: '石', hpTitle: '气血', hpSigil: '血' },
        tabs: { skills: '修', combat: '斗' },
        stats: { labels: { atk: { label: '攻' } } },
        units: { level: '{v} 层', seconds: '{v} 秒', minute: '{m} 分', hourMinute: '{h} 时 {m} 分' },
        icons: { buff: '丹', gear: '器', unknown: '？' },
        common: { needLevel: '需 {level} 层', compareWrap: '（{compare}）', itemListSep: '、' },
        events: {
          lootDrop: '得 {name}×{count}',
          floatSum: '{name} +{count}',
          expGain: '修为 +{amount}',
          victoryFlog: '【{name}】轰然倒地！{spoil}',
          victorySpoil: '得灵石 {gold}，缴获 {loot}。',
          defeatFlog: '你不敌【{name}】',
          defeatToast: '斗法落败',
          levelupToast: '升至 {level} 层',
          levelupLog: '【{name}】升至 {level} 层',
          offlineNoYield: '无所获',
        },
        pages: {},
      },
    },
    shop: [],
  } as unknown as ContentPack;
}

function mount(): { root: HTMLElement; ui: ReturnType<typeof buildUi>; game: ReturnType<typeof createGame> } {
  const content = makePack();
  const game = createGame({ content, clock: new ManualClock(), save: makeSave() });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return { root, ui, game };
}

function makeSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: { gold: 0, hp: 100, items: {}, skills: { fight: { xp: 0 } }, equips: {}, gear: [], buffs: {} },
  } as unknown as SaveData;
}

/** 真包 + 真开战：#flog 槽由斗法页战斗视图渲染（战斗外无槽 = 持久体待命）。 */
function mountFight(): {
  root: HTMLElement;
  ui: ReturnType<typeof buildUi>;
  game: ReturnType<typeof createGame>;
} {
  const content = loadXiuxianPack();
  const game = createGame({ content, clock: new ManualClock(), seed: 11 });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
  root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e1"]')!.click();
  ui.render();
  return { root, ui, game };
}

describe('#34 · 右侧栏与 log() sink 完全退场', () => {
  it('壳模板无侧栏 DOM（aside.side/#log 不再渲染）', () => {
    const { root } = mount();
    expect(root.querySelector('aside.side')).toBeNull();
    expect(root.querySelector('#log')).toBeNull();
    expect(root.querySelector('#page-root')).not.toBeNull();
    // 持久反馈层在场（toast 档 + 飘字档 + 敌卡锚定层）。
    expect(root.querySelector('#floaters')).not.toBeNull();
    expect(root.querySelector('#float-stack')).not.toBeNull();
    expect(root.querySelector('#combat-floats')).not.toBeNull();
  });
});

describe('#34 · 档一战斗飘字（既有 flog 改造）', () => {
  it('attack 逐击不聚合：两条 attack → 两个敌卡锚定飘字，不入战斗日志', () => {
    // 真开战语境（P0 收口：无锚点不入层——挂机连杀在其他页签静默）。
    const { root, game } = mountFight();
    game.events.emit({
      type: 'attack',
      time: 0,
      data: { side: 'player', enemyId: 'e1', enemyName: '狼', text: '一击 5 点', dmg: 5, crit: false, tier: 'light' },
    });
    game.events.emit({
      type: 'attack',
      time: 0,
      data: { side: 'enemy', enemyId: 'e1', enemyName: '狼', text: '受击 3 点', dmg: 3, tier: 'light' },
    });
    const floats = root.querySelectorAll('#combat-floats .float-combat');
    expect(floats).toHaveLength(2);
    expect(floats[0]!.textContent).toBe('一击 5 点');
    expect(floats[1]!.textContent).toBe('受击 3 点');
  });
});

describe('#34 · 战斗胜负例外（AC2：胜利不飘字，战败红 toast）', () => {
  it('victory → 飘字层零新增（叙事与战利品段归战斗日志，修行录归 #33）', () => {
    const { root, game } = mount();
    game.events.emit({
      type: 'victory',
      time: 0,
      data: { enemyId: 'e1', enemyName: '狼', gold: 7, rounds: 3, exp: 12, summary: '三合', drops: [] },
    });
    expect(root.querySelector('#float-stack')!.children).toHaveLength(0);
    expect(root.querySelector('#combat-floats')!.children).toHaveLength(0);
  });

  it('defeat → 战败保留红 toast', () => {
    const { root, game } = mount();
    game.events.emit({ type: 'defeat', time: 0, data: { enemyId: 'e1', enemyName: '狼' } });
    expect(root.querySelector('.toast-red')?.textContent).toBe('斗法落败');
    expect(root.querySelector('#float-stack')!.children).toHaveLength(0);
  });

  it('胜利正向面：叙事 + 战利品段落战斗日志（AC2「仅修行录与战斗日志」）', () => {
    const { root, game } = mountFight();
    game.events.emit({
      type: 'victory',
      time: 0,
      data: { enemyId: 'e1', enemyName: '青鬃狼', gold: 7, rounds: 3, exp: 12, summary: '三合', drops: ['herb1'] },
    });
    const flogText = root.querySelector('#flog')?.textContent ?? '';
    expect(flogText).toContain('轰然倒地');
    expect(flogText).toContain('得灵石 7');
    expect(root.querySelector('#float-stack')!.children).toHaveLength(0);
    expect(root.querySelector('#combat-floats')!.children).toHaveLength(0);
  });
});

describe('#34 · 档二获取飘字（同类 3 秒短窗聚合 + 堆叠限高）', () => {
  it('同名获取 4 次 → 单行聚合形 floatSum（"×1"×4 → "+4"）', () => {
    const { root, game } = mount();
    for (let i = 0; i < 4; i++) {
      game.events.emit({
        type: 'loot',
        time: 0,
        data: { item: 'ore', itemName: '铁矿石', count: 1, source: 'drop' },
      });
    }
    const floats = root.querySelectorAll('#float-stack .float-acq');
    expect(floats).toHaveLength(1);
    expect(floats[0]!.textContent).toBe('铁矿石 +4');
  });

  it('飘字自动消失：驻留到点后行自动移除（数秒即消）', () => {
    vi.useFakeTimers();
    try {
      const { root, game } = mount();
      game.events.emit({
        type: 'loot',
        time: 0,
        data: { item: 'ore', itemName: '铁矿石', count: 1, source: 'drop' },
      });
      expect(root.querySelectorAll('#float-stack .float-acq')).toHaveLength(1);
      vi.advanceTimersByTime(3700); // > FLOAT_ACQ_MS(3600)
      expect(root.querySelectorAll('#float-stack .float-acq')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('堆叠限高：连发 9 条不同名获取 → 行数受控不无限堆积（AC5）', () => {
    const { root, game } = mount();
    for (let i = 0; i < 9; i++) {
      // 缺包物品按 id 回显（nameOf 防御路径）→ 九条互不同名（不聚合）。
      game.events.emit({
        type: 'loot',
        time: 0,
        data: { item: `ore${i}`, itemName: `物${i}`, count: 1, source: 'drop' },
      });
    }
    expect(root.querySelectorAll('#float-stack .float-acq').length).toBeLessThanOrEqual(6);
    expect(root.querySelectorAll('#float-stack .float-acq').length).toBeGreaterThan(0);
  });
});

describe('#34 · 修为读数口径（AC4：只在升级飘，普通周期无飘字）', () => {
  it('普通 exp 事件不飘；levelup 同批才飘修为读数', () => {
    const { root, game } = mount();
    game.events.emit({ type: 'exp', time: 0, data: { skillId: 'fight', skillName: '斗法', amount: 8 } });
    expect(root.querySelector('#float-stack')!.children).toHaveLength(0);
    game.events.emit({ type: 'levelup', time: 0, data: { skillId: 'fight', skillName: '斗法', level: 2 } });
    const texts = Array.from(root.querySelectorAll('#float-stack .float-acq')).map((el) => el.textContent);
    expect(texts).toContain('修为 +8');
    expect(texts).toContain('【斗法】升至 2 层');
  });
});

describe('#34 · 战斗日志持久体重挂（重放缓冲/滚动恢复 hack 退役）', () => {
  it('P0 固定：无锚点（他页挂机连杀）attack 不入层——不堆顶栏不乱锚', () => {
    const { root, game } = mountFight();
    // 切离斗法页 = 无交战卡锚点。
    root.querySelector<HTMLButtonElement>('.tab[data-tab="skills"]')!.click();
    game.events.emit({
      type: 'attack',
      time: 0,
      data: { side: 'player', enemyId: 'e1', enemyName: '狼', text: '一击 5 点', dmg: 5, crit: false, tier: 'light' },
    });
    expect(root.querySelectorAll('#combat-floats .float-combat')).toHaveLength(0);
  });

  it('换页往返后 #flog 内容存活（节点身份延续，非缓冲重放）', () => {
    const { root, ui, game } = mountFight();
    game.events.emit({ type: 'combat-note', time: 0, data: { text: '开战叙事' } });
    const box = root.querySelector<HTMLElement>('#flog')!;
    // 开战 note（引擎发）在前，合成叙事行殿后。
    const line = box.lastElementChild;
    expect(line?.textContent).toBe('开战叙事');
    // 换页（触发整页重建）再回来：内容/节点身份存活（无重放缓冲）。
    root.querySelector<HTMLButtonElement>('.tab[data-tab="skills"]')!.click();
    ui.render();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    const again = root.querySelector<HTMLElement>('#flog')!;
    expect(again.lastElementChild).toBe(line);
    expect(again.textContent).toContain('开战叙事');
  });
});

describe('#34 · 补盲（复核收口批）', () => {
  it('聚合窗过期：同名 3 秒后起新窗新行，旧行走完淡出不硬摘', () => {
    vi.useFakeTimers();
    try {
      const { root, game } = mount();
      const emit = () =>
        game.events.emit({
          type: 'loot',
          time: 0,
          data: { item: 'ore', itemName: '铁矿石', count: 1, source: 'drop' },
        });
      emit();
      vi.advanceTimersByTime(3100); // 过 3s 聚合窗、未到 3.15s 淡出起点
      emit();
      const rows = () => Array.from(root.querySelectorAll('#float-stack .float-acq'));
      // 新窗新行；旧行不被窗界硬摘（满不透明行被闪摘 = 修复前行为）。
      const texts = rows().map((el) => el.textContent);
      expect(texts).toHaveLength(2);
      expect(texts[0]).toBe('得 铁矿石×1');
      expect(texts[1]).toBe('得 铁矿石×1');
      vi.advanceTimersByTime(700); // 旧行 3.6s 驻留到点自行移除
      expect(rows()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('首事件 count>1 走单形模板原值（不切聚合形）', () => {
    const { root, game } = mount();
    game.events.emit({
      type: 'loot',
      time: 0,
      data: { item: 'ore', itemName: '铁矿石', count: 3, source: 'drop' },
    });
    const rows = root.querySelectorAll('#float-stack .float-acq');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toBe('得 铁矿石×3');
  });

  it('levelup 无前置 exp 缓冲 → 不飘修为读数（防陈旧/undefined）', () => {
    const { root, game } = mount();
    game.events.emit({ type: 'levelup', time: 0, data: { skillId: 'fight', skillName: '斗法', level: 3 } });
    const texts = Array.from(root.querySelectorAll('#float-stack .float-acq')).map((el) => el.textContent);
    expect(texts.some((t) => (t ?? '').includes('修为'))).toBe(false);
  });

  it('离页期间 flog 追加入持久体（detached 缓冲），回页重挂可见', () => {
    const { root, ui, game } = mountFight();
    // 切到修炼页（无 #flog 槽 = 持久体脱离文档继续收行）。
    root.querySelector<HTMLButtonElement>('.tab[data-tab="skills"]')!.click();
    ui.render();
    game.events.emit({ type: 'combat-note', time: 0, data: { text: '离页叙事' } });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    ui.render();
    expect(root.querySelector('#flog')?.textContent).toContain('离页叙事');
  });

  it('夹具 shell events 键面 ⊆ schema events 键（防键名漂移哑雷）', () => {
    const pack = makePack();
    const schema = sectionSchemas.texts as {
      definitions?: { shellTexts?: { properties?: { events?: { properties?: Record<string, unknown> } } } };
    };
    const legal = new Set(Object.keys(schema.definitions?.shellTexts?.properties?.events?.properties ?? {}));
    expect(legal.size).toBeGreaterThan(0);
    for (const key of Object.keys(pack.texts!.shell.events)) {
      expect(legal.has(key), `夹具键 ${key} 不在 schema events 键面`).toBe(true);
    }
  });
});

describe('#50 · toast 自动消失（D5 fake timers 补盲）', () => {
  it('toast 到点自动移除：驻留期内在场、期满自动消', () => {
    vi.useFakeTimers();
    try {
      const { root, ui } = mount();
      ui.toast('浮生一叹');
      const el = () => root.querySelector('#toasts .toast');
      expect(el()?.textContent).toBe('浮生一叹');
      vi.advanceTimersByTime(1); // 短于驻留：仍在场
      expect(el()).not.toBeNull();
      vi.advanceTimersByTime(10000); // 远超驻留（3200ms）：自动移除
      expect(el()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
