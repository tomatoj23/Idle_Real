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
