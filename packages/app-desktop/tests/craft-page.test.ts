// @vitest-environment happy-dom
/**
 * #5 验收：炼制页新链路（壳层）——
 * - craft 页配方卡：材料着色（足/缺，判定走引擎 craftMissingOf）+ 成功率展示
 *   （数值走引擎 craftSuccessRateOf，文案走 texts.shell.pages.craft）；
 * - 开炉 → 进行中徽标/进度条 → 缺料停炉（craft-halt → toast/修行录）；
 * - skills 页只渲染 gather 技能 chips（craft 归炼制页专属导航，UX 调整；
 *   #38 起锁定斗法 chip 一并移除）。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 带炼制材料的存档：够 2 炉聚气丹（herb1×4）+ 少量矿/气。 */
function makeSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 112,
      items: { herb1: 4, ore1: 8, qi1: 10, silk: 6 },
      skills: { alchemy: { xp: 0 }, smith: { xp: 0 }, herb: { xp: 0 }, mine: { xp: 0 }, qi: { xp: 0 }, combat: { xp: 0 } },
      activity: null,
    },
  };
}

function mount(save: SaveData = makeSave()): {
  root: HTMLElement;
  ui: ReturnType<typeof buildUi>;
  game: ReturnType<typeof createGame>;
  clock: ManualClock;
} {
  const clock = new ManualClock();
  const content = loadXiuxianPack();
  const game = createGame({ content, clock, save });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return { root, ui, game, clock };
}

describe('#5 · 炼制页（craft 页）渲染', () => {
  it('页签齐备（#33 起十页签）：craft/转生/道韵/成就/修行录页签出现且文案 texts 驱动', () => {
    const { root } = mount();
    expect(root.querySelectorAll('#tabs .tab')).toHaveLength(10);
    expect(root.querySelector('.tab[data-tab="craft"]')?.textContent).toBe('炼制');
    expect(root.querySelector('.tab[data-tab="rebirth"]')?.textContent).toBe('转生');
    expect(root.querySelector('.tab[data-tab="talents"]')?.textContent).toBe('道韵');
    expect(root.querySelector('.tab[data-tab="achievements"]')?.textContent).toBe('成就');
    expect(root.querySelector('.tab[data-tab="journal"]')?.textContent).toBe('修行录');
  });

  it('配方卡渲染：产出/成功率/材料行/元信息，材料足缺着色', () => {
    const { root, ui } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="craft"]')!.click();
    ui.render();

    // 炼丹 chip 默认选中，配方卡齐备
    expect(root.querySelector('.chip[data-skill="alchemy"]')?.classList.contains('selected')).toBe(true);
    const cards = root.querySelectorAll('.act-card');
    expect(cards.length).toBe(5);

    // 炼制回气丹：材料 herb1×2，存档有 4 → 足（ok 着色）
    const healCard = Array.from(cards).find((card) => card.textContent?.includes('炼制回气丹'))!;
    expect(healCard.querySelector('.mat.ok')).not.toBeNull();
    expect(healCard.querySelector('.mat.no')).toBeNull();
    // 成功率数值来自引擎 craftSuccessRateOf（0.75 基础，1 层技艺 +0.004 → 75.4%）
    expect(healCard.textContent).toContain('成功率 75.4%');
    // 文案走 texts.shell（含失败损料注记），非壳内硬编码
    expect(healCard.textContent).toContain('失败损料');

    // 切到炼器：材料行足缺并存（qi1 10 < 玄铁重剑 18 → 缺着色）
    root.querySelector<HTMLButtonElement>('.chip[data-skill="smith"]')!.click();
    ui.render();
    const sword2Card = Array.from(root.querySelectorAll('.act-card')).find((card) =>
      card.textContent?.includes('锻玄铁重剑'),
    )!;
    expect(sword2Card.querySelector('.mat.no')).not.toBeNull();
    // 未解锁配方（20 层需求）显示门槛句
    expect(sword2Card.querySelector('.act-lockmsg')).not.toBeNull();
  });

  it('skills 页只渲染 gather 技能 chips（craft 归炼制页专属，#38 移除锁定斗法 chip）', () => {
    const { root } = mount();
    expect(root.querySelector('.chip[data-skill="alchemy"]')).toBeNull();
    expect(root.querySelector('.chip[data-skill="smith"]')).toBeNull();
    expect(root.querySelector('.chip[data-skill="combat"]')).toBeNull();
    expect(root.querySelector('.chip[data-skill="herb"]')).not.toBeNull();
    expect(root.querySelectorAll('.chip.locked').length).toBe(0);
  });
});

describe('#5 · 开炉 → 停炉链路（真实点击路径）', () => {
  it('开炉徽标 + 进度条 + 缺料停炉红 toast（craft-halt 事件接线）', () => {
    const { root, ui, game, clock } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="craft"]')!.click();
    ui.render();

    // 开炉：点「炼制回气丹」卡上的开始按钮（走 activity:start 协议）
    const healCard = Array.from(root.querySelectorAll('.act-card')).find((card) =>
      card.textContent?.includes('炼制回气丹'),
    )!;
    healCard.querySelector<HTMLButtonElement>('[data-act="start"]')!.click();
    ui.render();
    expect(root.querySelector('.act-card.running')).not.toBeNull();
    expect(root.querySelector('[data-act="stop"]')).not.toBeNull();
    expect(game.snapshot().state.activity).toMatchObject({ skillId: 'alchemy', index: 0 });

    // 60 游戏秒 > 2 炉材料（4 herb1）：2 炉后断料 → craft-halt
    for (let i = 0; i < 20; i++) {
      clock.advance(3000);
      game.tick(3000);
    }
    ui.render();
    expect(game.snapshot().state.activity).toBeNull(); // 自动停炉
    expect(root.querySelector('.toast-red')?.textContent).toContain('熄炉');
    // #34 侧栏退场：停炉详情随红 toast（同文流水行删除）。
    expect(root.querySelector('.toast-red')?.textContent).toContain('材料告罄');
  });

  it('材料不齐开炉被拒：已解锁但缺料 → reject 红字浮提示', () => {
    // readonly state 不可原地改写：以展开式新建同形存档（items 清空）。
    const base = makeSave();
    const save: SaveData = { ...base, state: { ...base.state, items: {} } };
    const { root, ui } = mount(save);
    root.querySelector<HTMLButtonElement>('.tab[data-tab="craft"]')!.click();
    ui.render();
    // 锻青锋剑 1 层已解锁但料尽：点开炉 → 引擎 reject no-materials → 红字浮提示
    root.querySelector<HTMLButtonElement>('.chip[data-skill="smith"]')!.click();
    ui.render();
    const swordCard = Array.from(root.querySelectorAll('.act-card')).find((card) =>
      card.textContent?.includes('锻青锋剑'),
    )!;
    swordCard.querySelector<HTMLButtonElement>('[data-act="start"]')!.click();
    ui.render();
    const toast = root.querySelector('.toast-red');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('材料不齐');
  });
});

describe('#35 · 配方卡自动化控件（三态单选 + 稀有度阈值）', () => {
  /** 选择器设值后走真实 change 委托（#35 表单控件动作路由）。 */
  function changeSelect(root: HTMLElement, selector: string, value: string): void {
    const el = root.querySelector<HTMLSelectElement>(selector)!;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function cardOf(root: HTMLElement, name: string): HTMLElement {
    return Array.from(root.querySelectorAll<HTMLElement>('.act-card')).find((c) => c.textContent?.includes(name))!;
  }

  function openCraft(root: HTMLElement, ui: ReturnType<typeof buildUi>, skill: string): void {
    root.querySelector<HTMLButtonElement>('.tab[data-tab="craft"]')!.click();
    root.querySelector<HTMLButtonElement>(`.chip[data-skill="${skill}"]`)!.click();
    ui.render();
  }

  it('两态/三态渲染：丹药配方（无稀有度产出）无熔炼项无阈值项；器胚配方三态齐备、启用后出阈值', () => {
    const { root, ui } = mount();
    openCraft(root, ui, 'alchemy');
    const healCard = cardOf(root, '炼制回气丹');
    const itemMode = healCard.querySelector<HTMLSelectElement>('.auto-mode')!;
    // 两态退化：丹药/材料配方无稀有度 → 不渲染熔炼项与阈值项
    expect(Array.from(itemMode.options).map((o) => o.value)).toEqual(['none', 'sell']);
    expect(healCard.querySelector('.auto-cap')).toBeNull();

    openCraft(root, ui, 'smith');
    const swordCard = cardOf(root, '锻青锋剑');
    const gearMode = swordCard.querySelector<HTMLSelectElement>('.auto-mode')!;
    // 器胚配方三态（器屑经济已配置）；缺省不处理时不渲染阈值项
    expect(Array.from(gearMode.options).map((o) => o.value)).toEqual(['none', 'sell', 'smelt']);
    expect(gearMode.value).toBe('none');
    expect(swordCard.querySelector('.auto-cap')).toBeNull();
  });

  it('动作派发：设自动售卖 → 规则入档（装备默认阈值=最低档）；阈值改写随动；回不处理删条目', () => {
    const { root, ui, game } = mount();
    openCraft(root, ui, 'smith');

    // 启用自动售卖：整条规则重写，默认阈值 = rarities[0]（寻常）——高品绝不误折
    changeSelect(root, '.act-card .auto-mode', 'sell');
    expect(game.snapshot().state.recipeAuto).toEqual({
      '5': { mode: 'sell', maxRarity: 'common', name: '锻青锋剑' },
    });

    // 阈值选择出现（文案 autoCap 带档名），改精良 → 规则随动
    const cap = cardOf(root, '锻青锋剑').querySelector<HTMLSelectElement>('.auto-cap')!;
    expect(cap.options).toHaveLength(4);
    expect(cap.options[0]?.textContent).toContain('寻常');
    changeSelect(root, '.act-card .auto-cap', 'fine');
    expect(game.snapshot().state.recipeAuto['5']).toEqual({
      mode: 'sell',
      maxRarity: 'fine',
      name: '锻青锋剑',
    });

    // 三态互斥：改自动熔炼单字段覆盖；回不处理 = 删条目（缺省）
    changeSelect(root, '.act-card .auto-mode', 'smelt');
    expect(game.snapshot().state.recipeAuto['5']).toEqual({
      mode: 'smelt',
      maxRarity: 'fine',
      name: '锻青锋剑',
    });
    changeSelect(root, '.act-card .auto-mode', 'none');
    expect(game.snapshot().state.recipeAuto).toEqual({});
    expect(cardOf(root, '锻青锋剑').querySelector('.auto-cap')).toBeNull();
  });

  it('无器屑经济的包：熔炼态不可选（两态 UI，受 canSmelt 门控）', () => {
    const content = loadXiuxianPack();
    delete (content as { config?: { gear?: unknown } }).config?.gear; // 摘除器屑经济
    const clock = new ManualClock();
    const game = createGame({ content, clock, save: makeSave() });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    openCraft(root, ui, 'smith');
    const gearMode = cardOf(root, '锻青锋剑').querySelector<HTMLSelectElement>('.auto-mode')!;
    expect(Array.from(gearMode.options).map((o) => o.value)).toEqual(['none', 'sell']);
  });
});

describe('#35 · 表单控件委托（点击 SELECT 不派发）', () => {
  it('开合下拉的点击不派发动作、不触发重绘换血（change 委托专属）', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="craft"]')!.click();
    root.querySelector<HTMLButtonElement>('.chip[data-skill="smith"]')!.click();
    ui.render();
    const mode = root.querySelector<HTMLSelectElement>('.act-card .auto-mode')!;
    mode.value = 'sell';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const cardBefore = Array.from(root.querySelectorAll<HTMLElement>('.act-card')).find((c) =>
      c.textContent?.includes('锻青锋剑'),
    )!;
    // 真实点击路径（浏览器里开合下拉）：若误派发 autorule，env.render() 会整卡换血
    cardBefore.querySelector<HTMLSelectElement>('.auto-mode')!.click();
    expect(
      Array.from(root.querySelectorAll<HTMLElement>('.act-card')).find((c) =>
        c.textContent?.includes('锻青锋剑'),
      ),
    ).toBe(cardBefore); // 节点身份存活 = 零重绘
    expect(game.snapshot().state.recipeAuto).toEqual({
      '5': { mode: 'sell', maxRarity: 'common', name: '锻青锋剑' },
    });
  });
});
