// @vitest-environment happy-dom
/**
 * #020 批 3 UI 回归：开战门控锁定态走引擎 enemyGateOf（N1 四处副本收敛）——
 * UI 零 clv+offset 公式复算；config 改门控偏移 = 纯 JSON 改动且 UI 跟随。
 */
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@wendao/content';
import { createGame, ManualClock, type GameAction } from '@wendao/engine';
import { buildUi } from '../src/ui';

const PACK = {
  skills: [{ id: 'fight', name: '斗法', icon: '斗', kind: 'combat' }],
  items: [],
  recipes: [],
  enemies: [
    { id: 'low', name: '青鬃狼', icon: '狼', level: 1, kind: 'claw', hp: 60, atk: 9, def: 2, attackInterval: 2800, exp: 16, gold: { min: 4, max: 10 }, drops: [] },
    { id: 'high', name: '赤炎虎', icon: '虎', level: 5, kind: 'claw', hp: 120, atk: 16, def: 6, attackInterval: 3000, exp: 80, gold: { min: 10, max: 20 }, drops: [] },
  ],
  gearDrops: [],
  rarities: [],
  affixPool: [],
  combatText: {},
  shop: [],
} as unknown as ContentPack;

function mount(content: ContentPack): HTMLElement {
  const game = createGame({ content, clock: new ManualClock() });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  ui.bindActions((action: GameAction) => game.dispatch(action));
  root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
  ui.render();
  return root;
}

describe('#020 · 敌人卡锁定态与引擎门控同源', () => {
  it('基线偏移（+2）：5 层敌锁定显示「需 3 层」，1 层敌可挑战', () => {
    const root = mount(PACK);
    const highCard = root.querySelector<HTMLButtonElement>('.enemy-card.locked');
    expect(highCard).not.toBeNull();
    expect(highCard!.textContent).toContain('需 3 层');
    expect(highCard!.querySelector('[data-act="fight"]')).toBeNull();
    // 1 层敌（clv1 + 偏移 2 ≥ 1）可挑战
    const lowCard = Array.from(root.querySelectorAll('.enemy-card')).find(
      (card) => !card.classList.contains('locked'),
    );
    expect(lowCard?.querySelector('[data-act="fight"]')).not.toBeNull();
  });

  it('config 改门控偏移 = 纯 JSON 改动：偏移 10 → 5 层敌解锁', () => {
    const tuned = {
      ...PACK,
      config: { combat: { levelGateOffset: 10 } },
    } as unknown as ContentPack;
    const root = mount(tuned);
    expect(root.querySelector('.enemy-card.locked')).toBeNull();
    const fightButtons = root.querySelectorAll('[data-act="fight"]');
    expect(fightButtons.length).toBe(2);
  });
});
