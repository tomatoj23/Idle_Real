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

/** 壳挂载共用（列表/战斗两形态）：可注入状态 / 裁包（mutate）。 */
function mountShell(
  extraState: Record<string, unknown> = {},
  mutate?: (content: ReturnType<typeof loadXiuxianPack>) => void,
) {
  const clock = new ManualClock();
  const content = loadXiuxianPack();
  mutate?.(content);
  const base = createGame({ content, clock, seed: 5 }).snapshot();
  const save = {
    ...base,
    state: { ...(base.state as Record<string, unknown>), ...extraState },
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
  return { root, ui, game, actions };
}

/** 高斗法修为存档：clv 8（e2 门控需 ≥6 放行）。恢复侧 hp 按收编后的修为
 *  推 cap 满血（#41 正序；注入 hp 9999 超顶钳回 maxHp(8)=196），low-hp
 *  门控自然放行，层数不再受血线配平约束。 */
function mountFighting(enemyId: string) {
  const mounted = mountShell({
    // progressionParams 纯装载派生，二次装载与挂载实例同参。
    skills: { combat: { xp: expBase(8, progressionParamsOf(loadXiuxianPack())) } },
    hp: 9999,
  });
  mounted.root.querySelector<HTMLButtonElement>(`[data-act="fight"][data-enemy="${enemyId}"]`)!.click();
  mounted.ui.render();
  return mounted;
}

describe('斗法页 · 战斗中信息面', () => {
  it('战斗中渲染敌人列表：其余敌人可挑战，当前目标徽标化且无挑战按钮', () => {
    const { root, game } = mountFighting('e1');
    expect(root.querySelector('.enemy-card.fighting')).not.toBeNull();
    expect(game.snapshot().state.combat?.enemyId).toBe('e1');

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
    expect(game.snapshot().state.combat?.enemyId).toBe('e2');
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

describe('#36 · 敌人卡自动化控件（三态单选 + 稀有度阈值）', () => {
  /** 选择器设值后走真实 change 委托（#35 表单控件动作路由，壳级共用）。 */
  function changeSelect(root: HTMLElement, selector: string, value: string): void {
    const el = root.querySelector<HTMLSelectElement>(selector)!;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('每行三态齐备（器屑经济在案）+ 缺省不处理无阈值项；启用后出阈值（autoCap 带档名）', () => {
    const { root } = mountShell();
    // 八敌人每行控件齐备（票面「每行控件(三态+阈值)」）
    expect(root.querySelectorAll('.enemy-card .auto-mode')).toHaveLength(8);
    const mode = root.querySelector<HTMLSelectElement>('.auto-mode[data-enemy="e1"]')!;
    expect(Array.from(mode.options).map((o) => o.value)).toEqual(['none', 'sell', 'smelt']);
    expect(mode.value).toBe('none'); // 缺省不处理
    expect(root.querySelector('.auto-cap[data-enemy="e1"]')).toBeNull();

    // 启用自动售卖 → 阈值项出现（≤档名文案），每档一选项
    changeSelect(root, '.auto-mode[data-enemy="e1"]', 'sell');
    const cap = root.querySelector<HTMLSelectElement>('.auto-cap[data-enemy="e1"]')!;
    expect(cap).not.toBeNull();
    expect(cap.options).toHaveLength(4);
    expect(cap.options[0]?.textContent).toContain('寻常');
  });

  it('动作派发：设自动售卖 → 规则入档（敌 id 键 + 默认阈值最低档）；阈值改写随动；回不处理删条目', () => {
    const { root, game } = mountShell();

    // 启用自动售卖：整条规则重写，默认阈值 = rarities[0]（寻常）——高品绝不误折
    changeSelect(root, '.auto-mode[data-enemy="e1"]', 'sell');
    expect(game.snapshot().state.enemyAuto).toEqual({
      e1: { mode: 'sell', maxRarity: 'common' },
    });
    // 显示态与引擎态同步：重绘后阈值选中值随规则
    expect(root.querySelector<HTMLSelectElement>('.auto-cap[data-enemy="e1"]')!.value).toBe('common');

    // 阈值改写随动（精良）
    changeSelect(root, '.auto-cap[data-enemy="e1"]', 'fine');
    expect(game.snapshot().state.enemyAuto.e1).toEqual({ mode: 'sell', maxRarity: 'fine' });
    expect(root.querySelector<HTMLSelectElement>('.auto-cap[data-enemy="e1"]')!.value).toBe('fine');

    // 三态互斥：改自动熔炼单字段覆盖（阈值保留）
    changeSelect(root, '.auto-mode[data-enemy="e1"]', 'smelt');
    expect(game.snapshot().state.enemyAuto.e1).toEqual({ mode: 'smelt', maxRarity: 'fine' });

    // 回不处理 = 删条目（缺省）；阈值项随收
    changeSelect(root, '.auto-mode[data-enemy="e1"]', 'none');
    expect(game.snapshot().state.enemyAuto).toEqual({});
    expect(root.querySelector('.auto-cap[data-enemy="e1"]')).toBeNull();
  });

  it('无器屑经济的包：熔炼态不可选（两态 UI）；存量熔炼态仅回显 disabled 选项防谎报', () => {
    const noShard = (content: ReturnType<typeof loadXiuxianPack>): void => {
      delete (content as { config?: { gear?: unknown } }).config?.gear;
    };
    // 缺省态两态：不渲染熔炼项
    const { root } = mountShell({}, noShard);
    expect(
      Array.from(root.querySelector<HTMLSelectElement>('.auto-mode[data-enemy="e1"]')!.options).map(
        (o) => o.value,
      ),
    ).toEqual(['none', 'sell']);

    // 注入存量熔炼规则：回显选中态但不可选（disabled），防选择器静默换态谎报。
    // 断言钉 selected 属性而非 select.value——happy-dom 的 value 读取器跳过
    // disabled 选项（真浏览器按属性显示 smelt），属性才是回显契约本体。
    const { root: root2 } = mountShell({ enemyAuto: { e1: { mode: 'smelt', maxRarity: 'fine' } } }, noShard);
    const mode2 = root2.querySelector<HTMLSelectElement>('.auto-mode[data-enemy="e1"]')!;
    const opts = Array.from(mode2.options);
    expect(opts.map((o) => o.value)).toEqual(['none', 'sell', 'smelt']);
    expect(opts[2]!.disabled).toBe(true); // 不可选（无器屑经济）
    expect(opts[2]!.hasAttribute('selected')).toBe(true); // 存量态回显选中，不谎报
    expect(opts[0]!.hasAttribute('selected')).toBe(false);
  });
});
