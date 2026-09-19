// @vitest-environment happy-dom
/**
 * 修行录页壳核行为（#33）：
 * - 页签位于成就右侧（末位）；列表/类型过滤/锚点重设/净收获汇总可用；
 * - 挂页时连续掉落走增量追加，不触发整页重建（signature 低频分支 + seq 差量）；
 * - 内容包变更（条目引用 id 查无）回显 id 兜底零崩溃；
 * - 乾坤袋页签切进/切出补发 visit 信号对（#39 坊市 + #33 乾坤袋）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction, type GameEvent } from '@wendao/engine';
import { buildUi } from '../src/ui';

function mount() {
  const content = loadXiuxianPack();
  const game = createGame({ content, clock: new ManualClock(), seed: 7 });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return { root, ui, game };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('#33 · 修行录页', () => {
  it('页签位于成就右侧（末位）；进页出空流水空态', () => {
    const { root, ui } = mount();
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('#tabs .tab'));
    expect(tabs[tabs.length - 1]?.dataset.tab).toBe('journal');
    expect(tabs[tabs.length - 2]?.dataset.tab).toBe('achievements');

    root.querySelector<HTMLButtonElement>('.tab[data-tab="journal"]')!.click();
    ui.render();
    expect(root.querySelector('#page-root .page')).not.toBeNull();
    expect(root.querySelector('#jr-list .empty')?.textContent).toBe('尚无记录。');
  });

  it('流水条目渲染：结构化行（类型徽标/标题/明细/墙钟），texts 驱动', () => {
    const { root, ui, game } = mount();
    game.dispatch({ type: 'activity:start', payload: { skillId: 'qi', index: 0 } });
    game.tick(2000); // 修仙包第 0 活动间隔 2000ms → 1 轮
    game.dispatch({ type: 'activity:stop' });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="journal"]')!.click();
    ui.render();

    const row = root.querySelector<HTMLElement>('#jr-list .jr-row');
    expect(row).not.toBeNull();
    // 炼气是 gather 类技能 → 过滤组 'craft'（采炼）。
    expect(row?.dataset.kind).toBe('craft');
    expect(row?.textContent).toContain('轮'); // gatherTitle {cycles} 轮
    expect(row?.querySelector('.jr-lines')?.textContent).toContain('散灵');
  });

  it('类型过滤：按 data-kind 显示/隐藏行，零整页重建', () => {
    const content = loadXiuxianPack();
    const game = createGame({
      content,
      clock: new ManualClock(),
      seed: 7,
      save: {
        version: 1,
        time: 0,
        state: { gold: 1000, hp: 50, items: { herb1: 5 }, skills: {}, activity: null },
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = buildUi(root, content, () => game.snapshot(), game.events);
    ui.bindActions((action: GameAction) => game.dispatch(action));
    ui.render();
    // 造一条交易条目（坊市访问段闭段成条）。
    game.dispatch({ type: 'visit:begin', payload: { page: 'shop' } });
    game.dispatch({ type: 'shop:buy', payload: { item: 'consumable_heal', count: 1 } });
    game.dispatch({ type: 'visit:end', payload: { page: 'shop' } });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="journal"]')!.click();
    ui.render();
    const list = root.querySelector<HTMLElement>('#jr-list')!;
    const row = list.querySelector<HTMLElement>('.jr-row');
    expect(row?.dataset.kind).toBe('visit');
    expect(row?.textContent).toContain('访 坊市'); // 访问段标题（pageShop 文案）
    expect(row?.textContent).toContain('回气丹'); // 段内分项明细

    list.dataset.mark = 'keep'; // 容器标记：过滤切换不得重建容器
    const craftChip = root.querySelector<HTMLButtonElement>('.jr-filters .chip[data-filter="craft"]')!;
    craftChip.click();
    ui.render();
    expect(list.dataset.mark).toBe('keep'); // 容器未重建
    expect(row?.style.display).toBe('none'); // 交易行被隐藏
    const allChip = root.querySelector<HTMLButtonElement>('.jr-filters .chip[data-filter="all"]')!;
    allChip.click();
    ui.render();
    expect(row?.style.display).not.toBe('none'); // 切回全部恢复可见
  });

  it('锚点：设锚按钮 dispatch journal:anchor，净收获区随计数器轻刷', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="journal"]')!.click();
    ui.render();
    expect(root.querySelector('#jr-net')?.textContent).toContain('设下锚点');

    // 采一轮产生计数器增量。
    game.dispatch({ type: 'activity:start', payload: { skillId: 'qi', index: 0 } });
    game.tick(2000);
    game.dispatch({ type: 'activity:stop' });
    ui.render();
    root.querySelector<HTMLButtonElement>('#jr-anchor-btn')!.click();
    ui.render();

    // 设锚后净收获清零基准：锚点存在提示行出现。
    expect(root.querySelector('#jr-net')?.textContent).toContain('锚定于');
    expect(root.querySelector('#jr-net')?.textContent).toContain('无所得失');
    // 再采一轮：净收获区出现增量行（轻刷，行内容 = 锚点以来差值）。
    game.dispatch({ type: 'activity:start', payload: { skillId: 'qi', index: 0 } });
    game.tick(2000);
    game.dispatch({ type: 'activity:stop' });
    ui.render();
    expect(root.querySelectorAll('#jr-net .jr-net-row').length).toBeGreaterThan(0);
  });

  it('增量追加（AC）：挂页时新条目 append 进容器，页面骨架不重建', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="journal"]')!.click();
    ui.render();
    const page = root.querySelector<HTMLElement>('#page-root')!;
    const list = root.querySelector<HTMLElement>('#jr-list')!;
    page.dataset.mark = 'page-kept'; // 页骨架标记
    list.dataset.mark = 'list-kept'; // 列表容器标记
    expect(list.children.length).toBe(1); // 空态占位

    // 挂页期间连续产出：两段采集 → 两条目。
    for (let i = 0; i < 2; i++) {
      game.dispatch({ type: 'activity:start', payload: { skillId: 'qi', index: 0 } });
      game.tick(2000);
      game.dispatch({ type: 'activity:stop' });
      ui.render();
    }
    // 页骨架与列表容器均未重建（标记仍在），行数增量增长。
    expect(page.dataset.mark).toBe('page-kept');
    expect(list.dataset.mark).toBe('list-kept');
    expect(list.querySelectorAll('.jr-row')).toHaveLength(2);
  });

  it('内容包变更防御：条目引用 id 查无时回显 id 渲染零崩溃', () => {
    const { root, ui, game } = mount();
    game.dispatch({ type: 'activity:start', payload: { skillId: 'qi', index: 0 } });
    game.tick(2000);
    game.dispatch({ type: 'activity:stop' });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="journal"]')!.click();
    ui.render();
    const row = root.querySelector('#jr-list .jr-row');
    expect(row).not.toBeNull(); // 正常渲染（物品在包内走展示名）
    // id 回显兜底：坏档条目引用未知 id 也零崩溃（消毒恢复 + 查名链兜底）。
    const reloaded = createGame({
      content: loadXiuxianPack(),
      save: {
        version: 1,
        time: 0,
        state: {
          gold: 0,
          hp: 50,
          items: {},
          skills: {},
          activity: null,
          journal: {
            seq: 1,
            records: [
              {
                seq: 1,
                t0: 0,
                t1: 0,
                kind: 'point',
                source: 'sell',
                lines: [{ source: 'sell', kind: 'item', id: 'ghost_item', count: -1, gold: -9 }],
              },
            ],
          },
        },
      },
    });
    const root2 = document.createElement('div');
    document.body.appendChild(root2);
    const ui2 = buildUi(root2, loadXiuxianPack(), () => reloaded.snapshot(), reloaded.events);
    ui2.bindActions((action: GameAction) => reloaded.dispatch(action));
    root2.querySelector<HTMLButtonElement>('.tab[data-tab="journal"]')!.click();
    ui2.render();
    const row2 = root2.querySelector('#jr-list .jr-row');
    expect(row2?.textContent).toContain('ghost_item'); // 回显 id，不崩
  });

  it('乾坤袋切进/切出补发 visit 信号对（坊市信号不回归）', () => {
    const { root, ui, game } = mount();
    const seen: string[] = [];
    game.events.subscribe((e: GameEvent) => {
      if (e.type === 'visit:begin' || e.type === 'visit:end') seen.push(`${e.type}:${e.data.page}`);
    });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    ui.render();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="skills"]')!.click();
    ui.render();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="shop"]')!.click();
    ui.render();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="skills"]')!.click();
    ui.render();
    expect(seen).toEqual(['visit:begin:bag', 'visit:end:bag', 'visit:begin:shop', 'visit:end:shop']);
  });
});
