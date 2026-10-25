// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 装配级冒烟（#88 AC1，兼 #74-10 首块）：import main.ts 真装配（空包起步）
 * → 载示例包 → 敌人节 → 假 fetch 走 LLM 面板 生成/全选/入包 → 断言当前节
 * 表单即时反映新条目（不换节）。钉 main.ts onApplied → scheduleValidate(true)
 * + repaintForm() 接线；LLM 写回本体（store.update 旁门裁决）见 #88 票评。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：
 * - main.ts onApplied 丢 repaintForm()（或丢 scheduleValidate(true) 改回
 *   去抖版）→ 入包后 .entry-card 数不涨/校验面板不即时刷新，本用例红。
 */

/** 两条跨引用闭合的假敌应答（kind/drops 引用真包既有域，入包即合法）。 */
const TWO_ENEMIES_REPLY = JSON.stringify({
  items: [
    {
      id: 'fake_beast_1', name: '幻兽一号', icon: '幻', level: 1, kind: 'claw',
      hp: 50, atk: 8, def: 2, attackInterval: 2400, exp: 15,
      gold: { min: 3, max: 9 }, drops: [{ item: 'core1', chance: 0.2 }],
    },
    {
      id: 'fake_beast_2', name: '幻兽二号', icon: '幻', level: 2, kind: 'claw',
      hp: 60, atk: 9, def: 3, attackInterval: 2400, exp: 17,
      gold: { min: 3, max: 10 }, drops: [{ item: 'core1', chance: 0.2 }],
    },
  ],
});

describe('#88 · 装配级：LLM 勾选入包 → 当前节表单即时刷新', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('入包不换节，.entry-card 数即时增长且新条目可见', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: TWO_ENEMIES_REPLY } }] }),
    })));
    await import('../src/main.js');

    // 空包起步：载示例包（不脏无确认）→ 切敌人节。
    (document.querySelector('#btn-sample') as HTMLButtonElement).click();
    const nav = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (node) => node.textContent?.includes('敌人'),
    )!;
    nav.click();
    const cards = (): number => document.querySelectorAll('.entry-card').length;
    expect(cards()).toBe(8);

    // LLM 面板全 DOM 驱动：选敌人目标（注册表序默认 items）→ 生成 → 全选 → 入包。
    const kindSelect = [...document.querySelectorAll<HTMLSelectElement>('select')].find(
      (node) => [...node.options].some((option) => option.value === 'enemies'),
    )!;
    kindSelect.value = 'enemies';
    const byText = (text: string): HTMLButtonElement =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (node) => node.textContent === text,
      )!;
    byText('批量生成').click();
    await vi.waitFor(() => expect(document.querySelector('.candidate')).not.toBeNull());
    byText('全选过验项').click();
    byText('勾选入包（2）').click();

    // 关键断言：未换节，表单已重渲染（修复前滞留 8 卡）。
    expect(cards()).toBe(10);
    expect(
      [...document.querySelectorAll('.entry-summary')].slice(-2).map((node) => node.textContent),
    ).toEqual(['9. fake_beast_1 · 幻兽一号', '10. fake_beast_2 · 幻兽二号']);
    // dirty 面（store 在 main.ts 闭包内，经顶栏徽标断言）。
    const dirtyBadge = document.querySelector<HTMLElement>('#dirty-badge')!;
    expect(dirtyBadge.hidden).toBe(false);
  });
});

/**
 * #73 装配级：误删条目 → 撤销 → 重做，顶栏按钮 + 键盘双路径走真装配。
 * 钉 main.ts 的 'history' 事件接线（collapseAll + repaintForm——漏 repaint
 * 则表单滞留旧 DOM，卡数不变即红）与 syncChrome 按钮禁用态同步。
 * store 层快照栈本体（含 rollback 语义）见 state.test.ts。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：
 * - main.ts 'history' 分支丢 repaintForm()/collapseAll() → 撤销后卡数不恢复，本用例红；
 * - 键盘映射 shift+z 误配 undo（或丢输入控件守卫改吞原生撤销）→ 键盘步骤红。
 */
describe('#73 · 装配级：误删条目 → 撤销 → 重做', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('删除条目后撤销恢复、重做再删；按钮禁用态随历史同步（按钮 + Ctrl+Y/Ctrl+Shift+Z）', async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    // 删除条目走 window.confirm（happy-dom 未实现，垫桩放行——同 state.test.ts 手法）。
    (window as unknown as { confirm?: (message: string) => boolean }).confirm = () => true;
    await import('../src/main.js');

    (document.querySelector('#btn-sample') as HTMLButtonElement).click();
    const nav = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (node) => node.textContent?.includes('敌人'),
    )!;
    nav.click();
    const cards = (): number => document.querySelectorAll('.entry-card').length;
    expect(cards()).toBe(8);

    const undoBtn = document.querySelector<HTMLButtonElement>('#btn-undo')!;
    const redoBtn = document.querySelector<HTMLButtonElement>('#btn-redo')!;
    expect(undoBtn.disabled).toBe(true); // 尚无历史
    expect(redoBtn.disabled).toBe(true);

    // 误删第一个条目（手风琴头部 ✕；收起态无嵌套 ✕，唯一点位）。
    const removeBtn = [...document.querySelectorAll<HTMLButtonElement>('.entry-card button')].find(
      (node) => node.textContent === '✕',
    )!;
    removeBtn.click();
    expect(cards()).toBe(7);
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);
    expect((document.querySelector('#dirty-badge') as HTMLElement).hidden).toBe(false);

    // 撤销：整树换装 + 'history' 事件重渲染，卡数恢复。
    undoBtn.click();
    expect(cards()).toBe(8);
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(false);

    // 键盘重做（Ctrl+Y，非输入焦点路径）。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    expect(cards()).toBe(7);
    expect(redoBtn.disabled).toBe(true);

    // Ctrl+Shift+Z 重做（shift+z 重做路径），再 Ctrl+Z 撤销回恢复位。
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(cards()).toBe(7);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(cards()).toBe(8);
    expect((document.querySelector('#dirty-badge') as HTMLElement).hidden).toBe(false); // 撤销不熄徽标（保守语义）
  });

  it('撤销后展开态不跨历史保留（collapseAll——expanded 下标随整树换装失效）', async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    (window as unknown as { confirm?: (message: string) => boolean }).confirm = () => true;
    await import('../src/main.js');

    (document.querySelector('#btn-sample') as HTMLButtonElement).click();
    const nav = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (node) => node.textContent?.includes('敌人'),
    )!;
    nav.click();

    // 展开第 2 个条目（index 1），随后误删第 1 个条目：remap 后原 index1 展开态随迁至 index0。
    const editBtns = [...document.querySelectorAll<HTMLButtonElement>('.entry-card button')].filter(
      (node) => node.textContent === '编辑',
    );
    editBtns[1]!.click();
    expect(document.querySelectorAll('.entry-body').length).toBe(1);
    const removeBtn = [...document.querySelectorAll<HTMLButtonElement>('.entry-card button')].find(
      (node) => node.textContent === '✕',
    )!;
    removeBtn.click();
    expect(document.querySelectorAll('.entry-card').length).toBe(7);
    expect(document.querySelectorAll('.entry-body').length).toBe(1); // 删除后展开态随 remap 迁至新 index0

    // 撤销：'history' 分支 collapseAll——不带它则旧下标展开态跨树残留（假展开）。
    (document.querySelector('#btn-undo') as HTMLButtonElement).click();
    expect(document.querySelectorAll('.entry-card').length).toBe(8);
    expect(document.querySelectorAll('.entry-body').length).toBe(0);
  });
});

/**
 * #73 装配级：update(fn) 抛错 → main.ts 'rollback' 分支接线（审计 F1 收口）。
 * 注入法：spyOn(Array.prototype.splice) 按 this 内容定点——敌人数组（length 8
 * 且首元素带 id:string + hp:number）的 (0,1) 调用才抛，applyEntryOp 的删除
 * 即在 store.update fn 内真实抛错。无差别 stub 不可用：happy-dom 内部
 * （NamedNodeMap.setNamedItem 设 className）同样走 splice(0,1)。
 * 钉面：rollback 后表单重绘（卡数复原）、toast「已回滚」（main.ts:192 独一份，
 * 其余分支不写此串）、干净包不脏、不进历史栈（撤销钮保持禁用）。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：
 * - main.ts 'rollback' 分支丢 showToast() → toast 滞留上一条消息，本用例红。
 */
describe('#73 · 装配级：update 抛错回滚接线（rollback 分支）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('删条目时 fn 抛错 → 整树回滚 + 回滚提示 + 不脏不进历史', async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    (window as unknown as { confirm?: (m: string) => boolean }).confirm = () => true;
    await import('../src/main.js');

    (document.querySelector('#btn-sample') as HTMLButtonElement).click();
    [...document.querySelectorAll<HTMLButtonElement>('.nav-item')]
      .find((n) => n.textContent?.includes('敌人'))!
      .click();
    expect(document.querySelectorAll('.entry-card').length).toBe(8);

    const realSplice = Array.prototype.splice;
    const isEnemyList = (self: unknown[]): boolean =>
      self.length === 8 &&
      typeof (self[0] as { id?: unknown })?.id === 'string' &&
      typeof (self[0] as { hp?: unknown })?.hp === 'number';
    const spy = vi
      .spyOn(Array.prototype, 'splice')
      .mockImplementation(function (this: unknown[], ...args: unknown[]) {
        if (args[0] === 0 && args[1] === 1 && isEnemyList(this)) {
          throw new Error('boom-splice');
        }
        return realSplice.apply(this, args as never);
      } as never);

    try {
      // happy-dom：监听器异常上抛到 click() 调用方（真浏览器走 window.onerror）。
      [...document.querySelectorAll<HTMLButtonElement>('.entry-card button')]
        .find((b) => b.textContent === '✕')!
        .click();
    } catch {
      // fn 抛错经 mutate → 事件监听器上抛，预期路径。
    }
    spy.mockRestore();

    // 回滚面：半途变异全弃（卡数复原）、toast 提示、干净包不脏、不进历史。
    expect(document.querySelectorAll('.entry-card').length).toBe(8);
    expect(document.querySelector('#toast')!.textContent).toContain('已回滚');
    expect((document.querySelector('#dirty-badge') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('#btn-undo') as HTMLButtonElement).disabled).toBe(true);
  });
});
