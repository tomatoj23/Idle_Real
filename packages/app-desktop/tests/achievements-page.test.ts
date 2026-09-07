// @vitest-environment happy-dom
/**
 * #9 验收：成就页 + 统计区（壳层）——
 * - 页签（包有 achievements 节才渲染）与页内两区（统计/成就卡）；
 * - 卡片三态：未解锁（进度条 + 进度行）/ 隐藏（占位不剧透）/ 已解锁（徽标 + 奖励行）；
 * - 链路：假时钟采集百轮 → cycles_100 解锁 → toast/修行录/卡片/统计/奖励入袋。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction, type GameEvent, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

function makeSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 112,
      items: {},
      skills: { herb: { xp: 0 }, qi: { xp: 0 }, mine: { xp: 0 }, alchemy: { xp: 0 }, smith: { xp: 0 }, combat: { xp: 0 } },
      activity: null,
      gear: [],
      equips: {},
      daoYun: 0,
      daoYunEarned: 0,
      rebirths: 0,
      talents: [],
    },
  };
}

function mount(save: SaveData = makeSave()): {
  root: HTMLElement;
  ui: ReturnType<typeof buildUi>;
  game: ReturnType<typeof createGame>;
} {
  const content = loadXiuxianPack();
  const game = createGame({ content, clock: new ManualClock(), save });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  ui.render();
  return { root, ui, game };
}

describe('#9 · 成就页', () => {
  it('页签与两区渲染：统计区零记录读 0；未解锁卡带进度行，隐藏卡占位不剧透', () => {
    const { root } = mount();
    expect(root.querySelector('.tab[data-tab="achievements"]')?.textContent).toBe('成就');
    root.querySelector<HTMLButtonElement>('.tab[data-tab="achievements"]')!.click();
    const page = root.querySelector('#page-root')!.textContent ?? '';
    expect(page).toContain('已解锁 0/11');
    expect(page).toContain('修行统计');
    expect(page).toContain('斩妖');
    expect(page).toContain('兵解');
    // 阈值卡进度行（percent 引擎投影，壳零公式复算）。
    expect(page).toContain('0/100');
    // 反向阈值卡不渲染数值行（{current}/{target} 对 lte 语义反直觉），进度条保留。
    expect(page).not.toContain('0/3');
    const swift = Array.from(root.querySelectorAll('.ach-card')).find((node) =>
      node.textContent?.includes('三合速胜'),
    )!;
    expect(swift.querySelector('.bar')).not.toBeNull();
    // 隐藏卡：名与描述占位，条件不剧透。
    expect(page).toContain('？？？');
    expect(page).toContain('此乃隐藏成就');
    expect(page).not.toContain('败中求生');
  });

  it('解锁链路：采集百轮 → cycles_100 解锁一次 → 徽标/奖励入袋/统计区更新', () => {
    const { root, ui, game } = mount();
    game.dispatch({ type: 'activity:start', payload: { skillId: 'herb', index: 0 } });
    const seen: GameEvent[] = [];
    for (let i = 0; i < 220; i++) {
      game.tick(3200); // interval 3000 → 每 tick 1 轮余 200ms
      seen.push(...game.events.drain());
      if (((game.snapshot().state.stats as Record<string, number>)['cycles'] ?? 0) >= 100) break;
    }
    ui.render();
    // 解锁事件一次且仅一次。
    const unlocks = seen.filter(
      (event) => event.type === 'achievement:unlock' && event.data?.['id'] === 'cycles_100',
    );
    expect(unlocks).toHaveLength(1);
    // 壳反馈：浮提示（容器内多条并存，按容器全文断言）+ 修行录。
    expect(root.querySelector('#toasts')?.textContent).toContain('成就达成【百炼成艺】');
    expect(root.querySelector('#log')?.textContent).toContain('成就达成【百炼成艺】');
    // 奖励入袋（回气丹 ×10）。
    expect((game.snapshot().state.items as Record<string, number>)['consumable_heal']).toBe(10);
    // 成就页：副标题 1/11 + 卡片已达成 + 奖励行直出。
    root.querySelector<HTMLButtonElement>('.tab[data-tab="achievements"]')!.click();
    expect(root.querySelector('#page-root')!.textContent).toContain('已解锁 1/11');
    const card = Array.from(root.querySelectorAll('.ach-card')).find((node) =>
      node.textContent?.includes('百炼成艺'),
    )!;
    expect(card.classList.contains('owned')).toBe(true);
    expect(card.textContent).toContain('已达成');
    expect(card.textContent).toContain('回气丹×10');
  });
});
