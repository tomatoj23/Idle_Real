// @vitest-environment happy-dom
/**
 * #7 验收：秘境页 + 斗法页入口（壳层）——
 * - 斗法页入口：秘境行（名称/最深记录/进入钮），门控锁定态
 *   （道韵门槛 common.needDaoYun / 钥匙门槛 entryKey）；
 * - 秘境页：层进度 + 当前层战斗（层倍率投影走引擎 dungeonFloorEnemyOf）+ 撤退；
 * - 链路：入口点击 → 入境切页 → 假时钟推层 → 层奖励入修行录 → 撤退回列表。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction, type GameEvent, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 带累计道韵（妖窟门槛 10）与回气丹的存档：clv1，全页签可见。 */
function makeSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 0,
      hp: 112,
      items: { consumable_heal: 5 },
      skills: { herb: { xp: 0 }, qi: { xp: 0 }, mine: { xp: 0 }, alchemy: { xp: 0 }, smith: { xp: 0 }, combat: { xp: 0 } },
      activity: null,
      gear: [],
      equips: {},
      daoYun: 0,
      daoYunEarned: 10,
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

/** 小步 tick 直至条件满足（事件随时收集）。 */
function tickUntil(
  game: ReturnType<typeof createGame>,
  done: () => boolean,
  seen: GameEvent[] = [],
  max = 400,
): void {
  for (let i = 0; i < max && !done(); i++) {
    game.tick(2000);
    seen.push(...game.events.drain());
  }
  expect(done()).toBe(true);
}

describe('#7 · 斗法页秘境入口', () => {
  it('秘境行渲染：道韵门放行（进入钮）/ 钥匙门锁定（需持「鬼庙钥符」）', () => {
    const { root } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    const page = root.querySelector('#page-root')!.textContent ?? '';
    expect(page).toContain('妖窟秘境');
    expect(page).toContain('鬼庙秘境');
    expect(page).toContain('需持「鬼庙钥符」');
    expect(root.querySelector('[data-act="dungeon-enter"][data-dungeon="yaoku"]')).not.toBeNull();
    expect(root.querySelector('[data-act="dungeon-enter"][data-dungeon="guimiao"]')).toBeNull();
  });

  it('道韵门槛未达：入口行锁定（需 10 道韵，common.needDaoYun 同源）', () => {
    const save = makeSave();
    (save.state as { daoYunEarned: number }).daoYunEarned = 9;
    const { root } = mount(save);
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    expect(root.querySelector('#page-root')!.textContent).toContain('需 10 道韵');
    expect(root.querySelector('[data-act="dungeon-enter"]')).toBeNull();
  });
});

describe('#7 · 秘境页与推塔链路', () => {
  it('入口点击 → 入境切页：层进度/当前层战斗/撤退按钮', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="dungeon-enter"][data-dungeon="yaoku"]')!.click();
    ui.render();
    // 引擎判定放行（daoYunEarned 10 ≥ 门槛 10）：已入境且页签自动切换。
    expect(game.snapshot().state.dungeon).toEqual({ dungeonId: 'yaoku', floor: 1 });
    const page = root.querySelector('#page-root')!.textContent ?? '';
    expect(page).toContain('当前 · 第 1/10 层');
    expect(page).toContain('最深 · 第 1 层');
    expect(page).toContain('撤退出秘境');
    // 战斗页变为指向页（秘境与野战互斥）。
    expect(game.snapshot().state.combat).not.toBeNull();
  });

  it('假时钟推层：victory → 层奖励入修行录 → 第 2 层开战（层倍率投影血条）', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="dungeon-enter"][data-dungeon="yaoku"]')!.click();
    const seen: GameEvent[] = [];
    tickUntil(game, () => seen.some((e) => e.type === 'dungeon:floor'), seen);
    ui.render();
    expect(root.querySelector('#log')!.textContent).toContain('第 1/10 层已通');
    // 层号推进（胜利休整到期自动进层）。
    tickUntil(game, () => game.snapshot().state.dungeon?.floor === 2, seen);
    ui.render();
    expect(root.querySelector('#page-root')!.textContent).toContain('当前 · 第 2/10 层');
  });

  it('撤退离境：回列表 + 最高层记录保留（dungeonBest）', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="dungeon-enter"][data-dungeon="yaoku"]')!.click();
    const seen: GameEvent[] = [];
    tickUntil(game, () => seen.some((e) => e.type === 'dungeon:floor'), seen);
    root.querySelector<HTMLButtonElement>('[data-act="dungeon-leave"]')!.click();
    ui.render();
    const st = game.snapshot().state;
    expect(st.dungeon).toBeNull();
    expect(st.dungeonBest.yaoku).toBeGreaterThanOrEqual(1);
    const page = root.querySelector('#page-root')!.textContent ?? '';
    expect(page).toContain('最深 · 第');
    expect(root.querySelector('[data-act="dungeon-enter"][data-dungeon="yaoku"]')).not.toBeNull();
  });

  it('秘境页签仅在包含 dungeons 节时渲染（零降级路径的壳面）', () => {
    const { root } = mount();
    // 修仙包有秘境：页签在案。
    expect(root.querySelector('.tab[data-tab="dungeon"]')).not.toBeNull();
  });
});
