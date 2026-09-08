// @vitest-environment happy-dom
/**
 * 斗法页战斗中信息面（UX 调整）：
 * - 战斗中渲染敌人列表：不打断战斗即可浏览其他怪物；点「挑战」= 引擎原生换敌
 *   （combat:start 幂等替换语义，无需先撤退）；当前目标徽标化、不渲染挑战按钮；
 * - 战斗中可见斗法修为条与等级（subtitle + expSub）。
 */
import { describe, expect, it } from 'vitest';
import { loadXiuxianPack } from '@wendao/content/packs/xiuxian';
import {
  createGame,
  expBase,
  ManualClock,
  progressionParamsOf,
  type GameAction,
  type SaveData,
} from '@wendao/engine';
import { buildUi } from '../src/ui';

/** 高斗法修为存档：clv 8（e2 门控需 ≥6 放行）。恢复侧 hp 按 skills 恢复前的
 *  clv1 曲线钳为 112（#7 教训），故层数须与血线配平：maxHp(8)=196，
 *  112 ≥ 0.3×196，low-hp 门控放行；层数再高会被 low-hp 拒绝开战。 */
function mountFighting(enemyId: string) {
  const clock = new ManualClock();
  const content = loadXiuxianPack();
  const base = createGame({ content, clock, seed: 5 }).snapshot();
  const save = {
    ...base,
    state: {
      ...(base.state as Record<string, unknown>),
      skills: { combat: { xp: expBase(8, progressionParamsOf(content)) } },
      hp: 9999,
    },
  } as unknown as SaveData;
  const game = createGame({ content, clock, save });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = buildUi(root, content, () => game.snapshot(), game.events);
  const actions: GameAction[] = [];
  ui.bindActions((action: GameAction) => {
    actions.push(action);
    game.dispatch(action);
  });
  ui.render();
  root.querySelector<HTMLButtonElement>('.tab[data-tab="combat"]')!.click();
  ui.render();
  root.querySelector<HTMLButtonElement>(`[data-act="fight"][data-enemy="${enemyId}"]`)!.click();
  ui.render();
  return { root, ui, game, actions };
}

describe('斗法页 · 战斗中信息面', () => {
  it('战斗中渲染敌人列表：其余敌人可挑战，当前目标徽标化且无挑战按钮', () => {
    const { root, game } = mountFighting('e1');
    expect(root.querySelector('.enemy-card.fighting')).not.toBeNull();
    expect((game.snapshot().state as { combat?: { enemyId: string } }).combat?.enemyId).toBe('e1');

    // 本诉求核心：战斗不打断，列表照常看
    const grid = root.querySelector('.enemy-grid');
    expect(grid).not.toBeNull();
    // 当前目标：徽标 + 无挑战按钮（engine 幂等反正拒绝，UI 直接收掉入口）
    const engagedCard = grid!.querySelector('.enemy-card.running');
    expect(engagedCard).not.toBeNull();
    expect(engagedCard!.textContent).toContain('交战中');
    expect(engagedCard!.querySelector('[data-act="fight"]')).toBeNull();
    // 其余敌人（e2 门控已放行）：挑战按钮在
    expect(grid!.querySelector('[data-act="fight"][data-enemy="e2"]')).not.toBeNull();
  });

  it('战斗中点其他敌人 = 原生换敌（combat:start 替换，不经撤退）', () => {
    const { root, ui, game, actions } = mountFighting('e1');
    root.querySelector<HTMLButtonElement>('[data-act="fight"][data-enemy="e2"]')!.click();
    ui.render();
    expect(actions.some((a) => a.type === 'combat:stop')).toBe(false);
    expect((game.snapshot().state as { combat?: { enemyId: string } }).combat?.enemyId).toBe('e2');
    expect(root.querySelector('.enemy-card.fighting')!.textContent).toContain('赤尾妖蝎');
    // 换敌后列表跟随：e1 回归可挑战位，e2 变当前目标
    expect(root.querySelector('.enemy-grid [data-act="fight"][data-enemy="e1"]')).not.toBeNull();
    expect(root.querySelector('.enemy-grid [data-act="fight"][data-enemy="e2"]')).toBeNull();
  });

  it('战斗中可见斗法修为条与等级（subtitle + expSub）', () => {
    const { root } = mountFighting('e1');
    const exp = root.querySelector('.combat-exp');
    expect(exp).not.toBeNull();
    expect(exp!.textContent).toContain('斩妖除魔'); // subtitle（含当前斗法层数）
    expect(exp!.querySelector('.bar')).not.toBeNull();
    expect(exp!.textContent).toContain('修为'); // expSub 副行
  });
});
