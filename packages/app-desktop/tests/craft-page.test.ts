// @vitest-environment happy-dom
/**
 * #5 验收：炼制页新链路（壳层）——
 * - craft 页配方卡：材料着色（足/缺，判定走引擎 craftMissingOf）+ 成功率展示
 *   （数值走引擎 craftSuccessRateOf，文案走 texts.shell.pages.craft）；
 * - 开炉 → 进行中徽标/进度条 → 缺料停炉（craft-halt → toast/修行录）；
 * - skills 页 craft 技能 chip 解锁（仅 combat 锁定）。
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
  it('页签齐备（#6 起七页签）：craft/转生/道韵页签出现且文案 texts 驱动', () => {
    const { root } = mount();
    expect(root.querySelectorAll('#tabs .tab')).toHaveLength(7);
    expect(root.querySelector('.tab[data-tab="craft"]')?.textContent).toBe('炼制');
    expect(root.querySelector('.tab[data-tab="rebirth"]')?.textContent).toBe('转生');
    expect(root.querySelector('.tab[data-tab="talents"]')?.textContent).toBe('道韵');
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

  it('skills 页 craft 技能 chip 解锁（仅 combat 锁定）', () => {
    const { root } = mount();
    expect(root.querySelector('.chip[data-skill="alchemy"]')?.classList.contains('locked')).toBe(false);
    expect(root.querySelector('.chip[data-skill="smith"]')?.classList.contains('locked')).toBe(false);
    expect(root.querySelector('.chip[data-skill="combat"]')?.classList.contains('locked')).toBe(true);
  });
});

describe('#5 · 开炉 → 停炉链路（真实点击路径）', () => {
  it('开炉徽标 + 进度条 + 缺料停炉 toast/修行录（craft-halt 事件接线）', () => {
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
    expect(root.querySelector('#log')?.textContent).toContain('材料告罄');
  });

  it('材料不齐开炉被拒：已解锁但缺料 → reject 红字浮提示', () => {
    const save = makeSave();
    save.state = { ...save.state, items: {} } as typeof save.state;
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
