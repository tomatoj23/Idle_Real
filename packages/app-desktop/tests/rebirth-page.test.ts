// @vitest-environment happy-dom
/**
 * #6 验收：转生页 / 天赋树页 / 主页境界区（壳层）——
 * - 兵解确认页：预览结算（rebirthPreviewOf 同源）+ 重置/保留清单 + 两段式确认；
 * - 道韵天赋树页：节点数据 100% 来自 rebirth.talents，锁定三态（已点亮/前置/道韵）；
 * - 主页境界区：境界词表（content.rebirth.realms）+ 兵解次数；
 * - 解锁表门控：e8 卡锁定态（common.needDaoYun）。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import { createGame, ManualClock, type GameAction, type SaveData } from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 带修为与道韵的存档：herb 20000 修为（可得 4 道韵）、余 2 道韵、少量家当。 */
function makeSave(): SaveData {
  return {
    version: 1,
    time: 0,
    state: {
      gold: 50,
      hp: 112,
      items: { herb1: 5 },
      skills: { herb: { xp: 20000 }, qi: { xp: 0 }, mine: { xp: 0 }, alchemy: { xp: 0 }, smith: { xp: 0 }, combat: { xp: 0 } },
      activity: null,
      gear: [{ uid: 1, itemId: 'sword1', rarity: 'common', affixes: [] }],
      equips: { weapon: 1 },
      daoYun: 2,
      daoYunEarned: 2,
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

describe('#6 · 兵解确认页', () => {
  it('预览结算与重置/保留清单渲染（数值/键名展示归壳文案，清单键域=注册表）', () => {
    const { root } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="rebirth"]')!.click();
    const page = root.querySelector('#page-root')!.textContent ?? '';
    // 预览：本世总修为 20000 / 可得 floor(20000×0.0002)=4 道韵（引擎 rebirthPreviewOf）。
    expect(page).toContain('本世总修为：20000');
    expect(page).toContain('兵解可得道韵：4');
    // 清单展示：重置五键与保留一键（texts.shell.pages.rebirth.*Labels）。
    expect(page).toContain('修为');
    expect(page).toContain('丹药药力');
    expect(page).toContain('战绩旧账');
    expect(page).toContain('法宝');
    // 无键名回显（壳零题材词直出协议键）。
    expect(page).not.toContain('lastEncounter');
    expect(page).not.toContain('resetLabels');
  });

  it('两段式确认：先 arm 后斩断；结算后重置归零/道韵入账/法宝保留', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="rebirth"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="rebirth-go"]')!.click();
    ui.render();
    // 确认阶段：提示 + 斩断/再想双钮。
    expect(root.querySelector('#page-root')!.textContent).toContain('兵解不可逆');
    expect(root.querySelector('[data-act="rebirth-confirm"]')).not.toBeNull();
    expect(root.querySelector('[data-act="rebirth-cancel"]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[data-act="rebirth-confirm"]')!.click();
    ui.render();
    expect(root.querySelector('.toast')?.textContent).toContain('兵解功成！得道韵 4');
    expect(root.querySelector('#log')?.textContent).toContain('第 1 世');

    const st = game.snapshot().state;
    expect(st.skills.herb?.xp).toBe(0);
    expect(st.items).toEqual({});
    expect(st.gold).toBe(0);
    expect(st.daoYun).toBe(11); // 2 + 4 + 兵解初悟成就奖励 5（#9 联动）
    expect(st.daoYunEarned).toBe(11);
    expect(st.rebirths).toBe(1);
    expect(st.gear).toHaveLength(1); // 法宝随保留集长存
    expect(st.achievements).toContain('rebirth_1'); // 兵解成就一次且仅一次（#9）
    expect(st.stats?.['rebirths']).toBe(1); // 统计累积随事件流（#9）
  });
});

describe('#6 · 道韵天赋树页', () => {
  it('树数据 100% 来自 content：修仙树十节点英中卡渲染 + 消耗行', () => {
    const { root } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="talents"]')!.click();
    const page = root.querySelector('#page-root')!.textContent ?? '';
    expect(page).toContain('现有道韵 2');
    expect(page).toContain('聆音');
    expect(page).toContain('破煞诀');
    expect(page).toContain('耗 2 道韵');
    // 未达门槛的前置/道韵双锁定态。
    expect(page).toContain('需先点亮前置天赋');
  });

  it('点亮链路：可购节点 → 已点亮徽标 + 事件文案；同节点幂等', () => {
    const { root, ui, game } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="talents"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-node="t_xueting"]')!.click();
    ui.render();
    expect(root.querySelector('.toast')?.textContent).toContain('天赋【聆音】已点亮');
    expect(game.snapshot().state.talents).toEqual(['t_xueting']);
    expect(game.snapshot().state.daoYun).toBe(0);
    // 已点亮卡出现徽标，按钮消失。
    expect(root.querySelector('#page-root')!.textContent).toContain('已点亮');
    expect(root.querySelector('[data-node="t_xueting"]')).toBeNull();
  });
});

describe('#6 · 主页境界区与解锁门控', () => {
  it('境界行：词表查表（clv1 → 练气期）+ 兵解次数（引擎 realmOf 同源）', () => {
    const { root } = mount();
    expect(root.querySelector('.status-realm')?.textContent).toBe('境界 · 练气期 · 兵解 0 世');
  });

  it('e8 卡道韵门槛锁定态（解锁表 requires.daoYun=10）', () => {
    const { root } = mount();
    root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
    const golemCard = Array.from(root.querySelectorAll('.enemy-card')).find((card) =>
      card.textContent?.includes('上古凶兽·饕餮'),
    );
    expect(golemCard?.classList.contains('locked')).toBe(true);
    expect(golemCard?.textContent).toContain('需 10 道韵');
  });
});
