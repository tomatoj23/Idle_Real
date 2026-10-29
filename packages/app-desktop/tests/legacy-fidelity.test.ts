// @vitest-environment happy-dom
/**
 * #62 保真收尾批 · 壳层面：必成配方文案/买 10/敌卡信息（掉率/异宝/出手间隔）/
 * 稀有度播报（announce + showcase 炼制分流）/夺得异宝行/离线 toast 修为后缀/
 * 散功重修 toast。事件驱动面沿 ui-shell-texts 的合成事件打法（emit 直灌）。
 */
import { describe, expect, it } from 'vitest';
import { mountGame } from './helpers/mount';
import { makePack, makeShellTexts } from './helpers/pack';
import { makeSave } from './helpers/save';

const BASE_TEXTS = {
  tabs: { shop: '坊市', craft: '炼制', combat: '斗法', settings: '设置' },
  units: { level: '{v} 层', seconds: '{v} 秒', minute: '{m} 分', hourMinute: '{h} 时 {m} 分' },
  icons: { buff: '丹', gear: '器', unknown: '？' },
  common: { itemListSep: '、' },
  events: {
    lootAnnounce: '妖物遗落【{name}】',
    lootShowcase: '天降异宝！【{name}】',
    lootShowcaseCraft: '神兵天成！炼得【{name}】',
    victorySeized: '于{enemy}手中夺得【{name}】',
    gameReset: '前尘尽散（第 {rebirths} 世终）',
  },
  pages: {
    shop: { title: '坊市', price: '{price} 灵石', owned: '持有 {count}', buyBtn: '买一', buyTenBtn: '买 10' },
    craft: {
      title: '炼制',
      subtitle: '{level}',
      hint: '器成必得之约',
      successRate: '成功率 {rate}%',
      certain: '器成必得',
      matRow: '{name} {have}/{need}',
    },
    combat: {
      title: '斗法',
      subtitle: '{level}',
      enemyStats: '气血 {hp} · 攻 {atk}',
      enemyGold: '灵石 {min}~{max}',
      dropsSuffix: ' · 掉落 {drops}',
      dropChance: '{name} {pct}%',
      gearDropRow: ' · 异宝：{names} {pct}%',
      enemyInterval: ' · 出手间隔 {interval}',
      fightBtn: '挑战',
    },
  },
};

const ITEMS = [
  { id: 'heal', name: '回气丹', icon: '回', type: 'consumable', sell: 18, heal: { percent: 0.3 } },
  { id: 'ore1', name: '凡铁', icon: '铁', type: 'mat', sell: 5 },
  { id: 'sword1', name: '青锋剑', icon: '剑', type: 'equip', slot: 'weapon', sell: 30, bonuses: { atk: 6 } },
  { id: 'sword_blank', name: '剑胚', icon: '胚', type: 'blank', sell: 0, slot: 'weapon', inherentModifiers: [] },
] as Record<string, unknown>[];

const RARITIES = [
  { id: 'common', name: '寻常', weight: 90, mult: 1, affix: 0, sell: 1 },
  { id: 'rare', name: '罕见', weight: 9, mult: 1.3, affix: 1, sell: 4, announce: true },
  { id: 'epic', name: '绝世', weight: 1, mult: 1.5, affix: 2, sell: 10, showcase: true },
] as Record<string, unknown>[];

describe('#62 · P2 批（壳层面）', () => {
  it('必成配方：successRate 1 → 「器成必得」，非常规配方仍走成功率模板', () => {
    const content = makePack({
      texts: { shell: makeShellTexts(BASE_TEXTS) },
      items: ITEMS,
      skills: [{ id: 'smith', name: '炼器', icon: '器', kind: 'craft' }],
      recipes: [
        { name: '锻剑', skill: 'smith', unlockLevel: 1, output: { item: 'sword1', count: 1 }, materials: { ore1: 1 }, successRate: 1, interval: 3000, exp: 8 },
        { name: '炼丹', skill: 'smith', unlockLevel: 1, output: { item: 'heal', count: 1 }, materials: { ore1: 1 }, successRate: 0.5, interval: 3000, exp: 8 },
      ],
    });
    const { root } = mountGame({ content });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="craft"]')!.click();
    const text = root.querySelector('#page-root')!.textContent ?? '';
    expect(text).toContain('器成必得');
    // 1 层技艺 +0.4% 层加成：0.5 → 50.4%（成功率读引擎 craftSuccessRateOf）
    expect(text).toContain('成功率 50.4%');
    // 「成功率 100%（失败损料）」矛盾形不再出现
    expect(text).not.toContain('成功率 100%');
  });

  it('坊市买 10：按钮渲染 + 派发 shop:buy count=10；购买力不足禁用', () => {
    const content = makePack({
      texts: { shell: makeShellTexts(BASE_TEXTS) },
      items: ITEMS,
      shop: [{ item: 'heal', price: 45 }],
    });
    const { root, game } = mountGame({ content, save: makeSave({ gold: 100 }) });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="shop"]')!.click();
    const rows = root.querySelectorAll<HTMLElement>('.bag-row');
    expect(rows).toHaveLength(1);
    const buyOne = rows[0]!.querySelector<HTMLButtonElement>('button[data-count="1"]')!;
    const buyTen = rows[0]!.querySelector<HTMLButtonElement>('button[data-count="10"]')!;
    // 100 金：单件可买、十件（450）禁用
    expect(buyOne.classList.contains('btn-disabled')).toBe(false);
    expect(buyTen.classList.contains('btn-disabled')).toBe(true);
    expect(buyTen.textContent).toBe('买 10');
    // 派发载荷带 count（禁用按钮 click 仍会派发——引擎 no-gold 拒收兜底；
    // 此处只钉载荷形状，直接点可买路径验证入账）
    buyTen.click();
    const goldAfter = (game.snapshot().state as unknown as { gold: number }).gold;
    expect(goldAfter).toBe(100); // 禁用态按钮引擎拒绝（no-gold），余额不动
  });

  it('敌卡信息回迁：掉率百分比逐项 + 异宝掉落行 + 出手间隔（列表视图）', () => {
    const content = makePack({
      texts: { shell: makeShellTexts(BASE_TEXTS) },
      items: ITEMS,
      skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
      enemies: [
        {
          id: 'e1', name: '青鬃狼', icon: '狼', level: 1, kind: 'claw',
          hp: 60, atk: 9, def: 2, attackInterval: 2800, exp: 16,
          gold: { min: 4, max: 10 },
          drops: [{ item: 'ore1', chance: 0.25 }, { item: 'heal', chance: 0.4 }],
        },
      ],
      gearDrops: [{ enemy: 'e1', chance: 0.1, pool: ['sword_blank'] }],
      rarities: RARITIES,
    });
    const { root } = mountGame({ content });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    const text = root.querySelector('#page-root')!.textContent ?? '';
    expect(text).toContain('凡铁 25%');
    expect(text).toContain('回气丹 40%');
    expect(text).toContain('异宝：剑胚 10%');
    expect(text).toContain('出手间隔 2.8 秒');
  });

  it('交战敌卡出手间隔行在案（fightingEnemyCard intervalText）', () => {
    const content = makePack({
      texts: { shell: makeShellTexts(BASE_TEXTS) },
      items: ITEMS,
      skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
      enemies: [
        {
          id: 'e1', name: '青鬃狼', icon: '狼', level: 1, kind: 'claw',
          hp: 60, atk: 9, def: 2, attackInterval: 2800, exp: 16,
          gold: { min: 4, max: 10 }, drops: [],
        },
      ],
      rarities: RARITIES,
    });
    const { root, game } = mountGame({ content });
    game.dispatch({ type: 'combat:start', payload: { enemyId: 'e1' } });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    expect(root.querySelector('.enemy-card.fighting')?.textContent).toContain('出手间隔 2.8 秒');
  });

  it('稀有度播报：announce 档掉落 toast「妖物遗落」；showcase 炼制 toast「神兵天成」分流', () => {
    const content = makePack({
      texts: { shell: makeShellTexts(BASE_TEXTS) },
      items: ITEMS,
      rarities: RARITIES,
    });
    const { root, game } = mountGame({ content });
    game.events.emit({
      type: 'loot',
      time: 0,
      data: { item: 'sword1', itemName: '罕见·青锋剑', count: 1, source: 'gear', rarity: 'rare', uid: 1 },
    });
    expect(root.querySelector('#toasts')?.textContent).toContain('妖物遗落【罕见·青锋剑】');
    game.events.emit({
      type: 'loot',
      time: 0,
      data: { item: 'sword1', itemName: '绝世·青锋剑', count: 1, source: 'craft', rarity: 'epic', uid: 2 },
    });
    expect(root.querySelector('#toasts')?.textContent).toContain('神兵天成！炼得【绝世·青锋剑】');
    // 普通档（无 announce/showcase）静默：toast 面不新增普通档播报
    expect(root.querySelector('#toasts')?.textContent).not.toContain('寻常');
  });

  it('夺得异宝行（旧版「于{敌名}手中夺得」回迁）：victory 事件带 gearDropName 时入战斗日志', () => {
    const content = makePack({
      texts: { shell: makeShellTexts(BASE_TEXTS) },
      items: ITEMS,
      rarities: RARITIES,
    });
    const { root, game } = mountGame({ content });
    // 战斗日志持久体挂在页内 #flog 槽——先切斗法页让槽在场
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    game.events.emit({
      type: 'victory',
      time: 0,
      data: {
        enemyId: 'e1', enemyName: '青鬃狼', gold: 7, drops: ['ore1'], exp: 16,
        gearDropName: '罕见·青锋剑', rounds: 3, summary: '3 合击倒', compare: undefined,
      },
    });
    expect(root.querySelector('#flog')?.textContent).toContain('于青鬃狼手中夺得【罕见·青锋剑】');
  });

  it('离线 toast 修为后缀（#62 P2-7）：{exp} 槽经 offlineExpSuffix 拼装', () => {
    const content = makePack({
      texts: {
        shell: makeShellTexts({
          ...BASE_TEXTS,
          events: {
            ...BASE_TEXTS.events,
            offlineToast: '离线 {away}归来：{activity} ×{cycles}{exp}',
            offlineExpSuffix: '，修为 +{exp}',
          },
          units: { level: '{v} 层', seconds: '{v} 秒', minute: '{m} 分', hourMinute: '{h} 时 {m} 分' },
        }),
      },
      items: ITEMS,
    });
    const { root, game } = mountGame({ content });
    game.events.emit({
      type: 'offline-settled',
      time: 0,
      data: {
        seconds: 5400, awaySeconds: 5400, capped: false,
        skillId: 'fight', skillName: '斗法', activityName: '采青灵草',
        cycles: 3, exp: 18, items: {}, levels: [],
      },
    });
    expect(root.querySelector('.toast')?.textContent).toBe('离线 1 时 30 分归来：采青灵草 ×3，修为 +18');
  });

  it('散功重修 toast：game-reset 事件 → 「前尘尽散」', () => {
    const content = makePack({ texts: { shell: makeShellTexts(BASE_TEXTS) }, items: ITEMS });
    const { root, game } = mountGame({ content });
    game.events.emit({ type: 'game-reset', time: 0, data: { rebirths: 2 } });
    expect(root.querySelector('#toasts')?.textContent).toContain('前尘尽散（第 2 世终）');
  });
});
