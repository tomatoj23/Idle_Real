// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountGame } from './helpers/mount';
import type { SaveData } from '@wendao/engine';

/**
 * #58 项 6 · 壳层交互路径补全：此前烟测只走了 fight/start/buy(失败)/tab，
 * 本文件把其余玩家可触达的点击面钉进测试网——战斗开关两钮、坊市购买
 * 成功路、乾坤袋物品卖出路。visit:begin/end 切页信号已由 journal-page.test.ts
 * 「乾坤袋切进/切出补发 visit 信号对」用真点击覆盖，不在此重复；beforeunload
 * 关闭即保存链在 main-entry.test.ts（真入口装配）。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：
 * - combat.ts handleAction 丢 toggle-auto/toggle-auto-eat 分支 → 引擎态不翻转，本文件红；
 * - shop.ts buy 丢 payload item（或 bag.ts sell 丢 count）→ 走 bad-payload reject，
 *   状态不变，对应用例红。
 */

/** 有钱有货的开局档：坊市购买与乾坤袋卖出不受经济约束。 */
const fundedSave = {
  version: 1 as const,
  time: 0,
  state: { gold: 1000, items: { herb1: 5 } },
} as unknown as SaveData;

describe('#58 项 6 · 壳层交互路径', () => {
  it('toggle-auto / toggle-auto-eat：战斗中点击翻转引擎开关（按钮 on 态随动）', () => {
    const { root, ui, game } = mountGame();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    root.querySelector<HTMLButtonElement>('.enemy-grid .btn[data-act="fight"]')!.click();
    ui.render();

    // 两开关缺省均开（BASE_COMBAT_PARAMS.autoFight/autoEat = true）：各点两下，
    // 引擎态与按钮 on 类同步翻转、再翻回。
    for (const [act, stateKey] of [
      ['toggle-auto', 'autoFight'],
      ['toggle-auto-eat', 'autoEat'],
    ] as const) {
      const btnOf = (): HTMLButtonElement =>
        root.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
      expect(game.snapshot().state[stateKey]).toBe(true);
      expect(btnOf().className).toContain('on');
      btnOf().click();
      ui.render();
      expect(game.snapshot().state[stateKey]).toBe(false);
      expect(btnOf().className).not.toContain('on');
      btnOf().click();
      ui.render();
      expect(game.snapshot().state[stateKey]).toBe(true);
      expect(btnOf().className).toContain('on');
    }
  });

  it('坊市购买成功路：点买 → 物品入袋 + 灵石扣减（烟测只钉过失败路）', () => {
    const { root, ui, game } = mountGame({ save: fundedSave });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="shop"]')!.click();
    ui.render();
    const buyBtn = root.querySelector<HTMLButtonElement>('.bag-row .btn[data-act="buy"]');
    expect(buyBtn).not.toBeNull();
    const st = game.snapshot().state;
    const beforeItems = st.items['consumable_heal'] ?? 0;
    const beforeGold = st.gold;
    buyBtn!.click();
    ui.render();
    const after = game.snapshot().state;
    expect(after.items['consumable_heal']).toBe(beforeItems + 1);
    expect(after.gold).toBeLessThan(beforeGold);
  });

  it('乾坤袋物品卖出：data-act="sell" 点击 → 物品减、灵石增（sell one）', () => {
    const { root, ui, game } = mountGame({ save: fundedSave });
    root.querySelector<HTMLButtonElement>('.tab[data-tab="bag"]')!.click();
    ui.render();
    const sellBtn = root.querySelector<HTMLButtonElement>(
      '.bag-row .btn[data-act="sell"][data-item="herb1"][data-count="1"]',
    );
    expect(sellBtn).not.toBeNull();
    sellBtn!.click();
    ui.render();
    const after = game.snapshot().state;
    expect(after.items['herb1']).toBe(4);
    expect(after.gold).toBe(1000 + 4); // herb1 卖价 4
  });
});
