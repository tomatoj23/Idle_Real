// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorStore } from '../src/core/state.js';
import type { LlmClient } from '../src/llm/client.js';
import { loadLlmConfig, saveLlmConfig } from '../src/llm/config.js';
import type { GenKind } from '../src/llm/prompts.js';
import { createLlmPanel } from '../src/ui/llmPanel.js';
import { testEnemy, xiuxianStore } from './helpers.js';

/**
 * LLM 面板 DOM 级行为（#74 项 6/7/11、#89）：
 * - 项 11（票评追加项）：候选勾选框 change 后「入包」按钮两态即时跟随
 *   （生成后逐条勾选是主路径，修复前 change 只改数据不重绘、按钮恒灰堵死）；
 *   refresh() 对外接口退役（两态由 repaintCandidates 单点自持）。
 * - 项 7：生成中取消入口（busy 期不再只能干等）。
 * - 项 6：API Key「仅本会话内存态」选项（不勾记住则落库无 key）。
 * - #89-1：候选净化——LLM 回复含 __proto__ own 键（JSON.stringify 造不出，
 *   须原文构造 reply 字符串）→ 入包后包内无该键、其余字段完好；enemies/
 *   verbs 两入包分支各钉一条。
 * - #89-2：勾选入包 try/catch/finally 防御兜底——注入 store.update 抛错 →
 *   状态行报错、候选现场保留、按钮态复位（现树无可达抛点，无自然红，
 *   测试即规格）；成功路径回归一条钉「候选清空 + onApplied 仍触发」。
 * - #56 项 1：入包事务门禁（pipeline 抛错）的自然红路径——状态行呈现
 *   回滚口径与错误路径、候选保留；pipeline 门禁失效或面板 catch 断线即红。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：
 * - 勾选 change 丢 repaintCandidates() → 勾选后按钮仍 disabled/计数不变，本文件红；
 * - 取消按钮丢 abort() 或 finally 丢 busy 复位 → 状态行不落「已取消」/生成钮不解锁，红；
 * - saveLlmConfig 丢 rememberApiKey 剥离 → 不勾记住时 localStorage 里仍有明文 key，红；
 * - generateCandidates 丢 sanitizeParsed → 污染键入包，#89-1 两条红；
 * - apply 丢 try/catch → 注入抛错异常逸出/状态行无报错文案，#89-2 红。
 * 测试手法注：happy-dom 下 checkbox click() 激活行为时序不稳（交付时观测
 * click 后 checked 不变，审计复跑未复现、机制未定），勾选一律手动置
 * checked + dispatchEvent，不依赖 click 激活行为；mock LLM client 照假
 * client 对象打法（勿碰 fetch/CORS 三头）。
 */

/** 两条跨引用闭合的假敌应答（同 app-assembly 打法）。 */
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

function fakeClient(reply: string): LlmClient {
  return {
    async complete() {
      return reply;
    },
  };
}

/** 污染回复（#89-1）：敌人条目带 __proto__ own 键——字面量写不出该形态，原文构造。 */
const POLLUTED_ENEMY_REPLY =
  '{"items":[{"id":"polluted_beast","name":"污染怪","icon":"污","level":1,"kind":"claw",' +
  '"hp":50,"atk":8,"def":2,"attackInterval":2400,"exp":15,' +
  '"gold":{"min":3,"max":9},"drops":[{"item":"core1","chance":0.2}],"__proto__":{"injected":1}}]}';

/** 污染回复（#89-1）：verbs 候选 list 内嵌对象带 __proto__ own 键（verbs 分支无克隆）。 */
const POLLUTED_VERB_REPLY =
  '{"items":[{"key":"polluted_verb","list":[{"v":"污招式","limbs":["掌"],"__proto__":{"x":1}}]}]}';

/** 悬空引用候选（#56 项 1）：条目级 schema 零错（查不到包），整包语义才拦。 */
const DANGLING_DROP_REPLY = JSON.stringify({
  items: [testEnemy('dangler', '悬空怪', 'ghost_item')],
});

/** 挂起型假 client：complete 永不 resolve，只等 abort（取消路径测试）。 */
function hangingClient(captured: { signal?: AbortSignal }): LlmClient {
  return {
    async complete(_config, _messages, signal) {
      captured.signal = signal;
      return new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
  };
}

function byText<T extends HTMLElement>(selector: string, text: string): T {
  const node = [...document.querySelectorAll<T>(selector)].find(
    (candidate) => candidate.textContent === text,
  );
  if (node === null || node === undefined) {
    throw new Error(`找不到 ${selector}「${text}」`);
  }
  return node;
}

function mountPanel(opts: { client: LlmClient; onApplied?: () => void }): EditorStore {
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.append(root);
  const store = xiuxianStore();
  createLlmPanel(root, store, { client: opts.client, onApplied: opts.onApplied });
  return store;
}

describe('#74-11 · 候选勾选 ↔ 入包按钮两态同步', () => {
  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('生成后逐条勾选：按钮解锁 + 计数跟随；取消勾选回落（主路径解锁回归）', async () => {
    mountPanel({ client: fakeClient(TWO_ENEMIES_REPLY) });

    byText<HTMLButtonElement>('button', '批量生成').click();
    await vi.waitFor(() => expect(document.querySelector('.candidate')).not.toBeNull());

    const applyBtn = (): HTMLButtonElement =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (node) => node.textContent?.startsWith('勾选入包'),
      )!;
    expect(applyBtn().disabled).toBe(true);
    expect(applyBtn().textContent).toBe('勾选入包（0）');

    const checkboxes = [...document.querySelectorAll<HTMLInputElement>('.candidate input[type="checkbox"]')];
    // happy-dom 下 click() 的翻转/change 派发时序不稳（#74 交付时观测到
    // click 后 checked 不变；审计复跑未能复现该行为，机制未定）——测试直接
    // 置 checked + 显式派发 change，不依赖激活行为实现细节；真浏览器点击
    // 路径由真机首跑覆盖。
    const toggle = (checkbox: HTMLInputElement): void => {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    };
    toggle(checkboxes[0]!);
    expect(applyBtn().disabled).toBe(false);
    expect(applyBtn().textContent).toBe('勾选入包（1）');

    toggle(checkboxes[1]!);
    expect(applyBtn().textContent).toBe('勾选入包（2）');

    toggle(checkboxes[0]!);
    expect(applyBtn().disabled).toBe(false);
    expect(applyBtn().textContent).toBe('勾选入包（1）');
  });

  it('刷新接口退役：createLlmPanel 返回 void（两态面板自持，main 不再需要知道该面板）', () => {
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.append(root);
    const returned = createLlmPanel(root, xiuxianStore(), { client: fakeClient('[]') });
    expect(returned).toBeUndefined();
  });
});

describe('#74-7 · 生成中取消', () => {
  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('busy 期点取消：AbortSignal 到 client、状态行落「已取消」、生成钮解锁', async () => {
    const captured: { signal?: AbortSignal } = {};
    mountPanel({ client: hangingClient(captured) });

    byText<HTMLButtonElement>('button', '批量生成').click();
    await vi.waitFor(() => expect(captured.signal).toBeDefined());
    const generateBtn = byText<HTMLButtonElement>('button', '批量生成');
    expect(generateBtn.disabled).toBe(true);

    byText<HTMLButtonElement>('button', '取消').click();
    await vi.waitFor(() => expect(document.querySelector('.llm-status')!.textContent).toContain('已取消'));
    expect(captured.signal?.aborted).toBe(true);
    expect(generateBtn.disabled).toBe(false);
  });
});

describe('#74-6 · API Key 记住/仅本会话', () => {
  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('不勾「记住」保存：localStorage 落库无 key；勾选则明文落库（现行为）', () => {
    mountPanel({ client: fakeClient('[]') });

    const keyInput = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')][0]!;
    keyInput.value = 'sk-secret';
    const remember = document.querySelector<HTMLInputElement>('input.remember-key')!;
    remember.checked = false;
    byText<HTMLButtonElement>('button', '保存配置').click();

    const stored = JSON.parse(localStorage.getItem('wendao_editor_llm_config')!) as { apiKey?: string; rememberApiKey?: boolean };
    expect(stored.apiKey).toBe('');
    expect(stored.rememberApiKey).toBe(false);
    expect(loadLlmConfig().apiKey).toBe('');

    remember.checked = true;
    byText<HTMLButtonElement>('button', '保存配置').click();
    const storedAgain = JSON.parse(localStorage.getItem('wendao_editor_llm_config')!) as { apiKey?: string };
    expect(storedAgain.apiKey).toBe('sk-secret');
    expect(loadLlmConfig().apiKey).toBe('sk-secret');
  });

  it('默认勾选记住（存量行为不变）；saveLlmConfig 直接 API 同语义', () => {
    expect(loadLlmConfig().rememberApiKey).toBe(true);
    saveLlmConfig({ ...loadLlmConfig(), apiKey: 'sk-direct', rememberApiKey: false });
    expect(loadLlmConfig().apiKey).toBe('');
    expect(loadLlmConfig().rememberApiKey).toBe(false);
  });

  it('面板威胁模型文案在场（明文/本机/不上传三要素）', () => {
    mountPanel({ client: fakeClient('[]') });
    const hint = [...document.querySelectorAll<HTMLElement>('.llm-config *')].find((node) =>
      (node.textContent ?? '').includes('不上传'),
    );
    expect(hint).toBeDefined();
  });
});

/**
 * #89 两项共用的生成→全选→入包驱动（污染键候选须过节级校验才可勾选）。
 * kind 须显式选中：下拉缺省项由 schema 扫描序决定（首个 x-llm 旗标，
 * 非 enemies），面板不预设、测试照用户路径显式选。
 */
async function generateApproveAll(store: EditorStore, kind: GenKind): Promise<HTMLButtonElement> {
  const kindSelect = document.querySelector<HTMLSelectElement>('select.input')!;
  kindSelect.value = kind;
  byText<HTMLButtonElement>('button', '批量生成').click();
  await vi.waitFor(() => expect(document.querySelector('.candidate')).not.toBeNull());
  byText<HTMLButtonElement>('button', '全选过验项').click();
  const applyBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) =>
    node.textContent?.startsWith('勾选入包'),
  )!;
  expect(applyBtn.disabled).toBe(false);
  return applyBtn;
}

describe('#89-1 · 候选净化（对齐文件导入 sanitizeParsed 待遇）', () => {
  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('enemies：回复条目带 __proto__ own 键 → 入包后包内该条目无该键、其余字段完好', async () => {
    const store = mountPanel({ client: fakeClient(POLLUTED_ENEMY_REPLY) });
    const applyBtn = await generateApproveAll(store, 'enemies');
    expect(applyBtn.textContent).toBe('勾选入包（1）');
    applyBtn.click();

    const enemies = store.state.pack['enemies'] as Record<string, unknown>[];
    const entry = enemies.find((candidate) => candidate['id'] === 'polluted_beast');
    expect(entry).toBeDefined();
    expect(Object.getOwnPropertyNames(entry)).not.toContain('__proto__');
    expect(entry).toEqual({
      id: 'polluted_beast',
      name: '污染怪',
      icon: '污',
      level: 1,
      kind: 'claw',
      hp: 50,
      atk: 8,
      def: 2,
      attackInterval: 2400,
      exp: 15,
      gold: { min: 3, max: 9 },
      drops: [{ item: 'core1', chance: 0.2 }],
    });
  });

  it('verbs：list 内嵌对象携带 __proto__ own 键 → 入包后 verbs 值无该键（引用直赋分支专项）', async () => {
    const store = mountPanel({ client: fakeClient(POLLUTED_VERB_REPLY) });
    const applyBtn = await generateApproveAll(store, 'verbs');
    expect(applyBtn.textContent).toBe('勾选入包（1）');
    applyBtn.click();

    const verbs = (store.state.pack['combatText'] as { verbs: Record<string, unknown> }).verbs;
    const list = verbs['polluted_verb'] as Record<string, unknown>[] | undefined;
    expect(list).toBeDefined();
    expect(list).toEqual([{ v: '污招式', limbs: ['掌'] }]);
    expect(Object.getOwnPropertyNames(list![0]!)).toEqual(['v', 'limbs']);
  });
});

describe('#89-2 · 勾选入包 try/catch/finally 防御兜底', () => {
  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('注入 store.update 抛错：状态行报错、候选现场保留、按钮态复位可重试、包不动', async () => {
    const onApplied = vi.fn();
    const store = mountPanel({ client: fakeClient(TWO_ENEMIES_REPLY), onApplied });
    const applyBtn = await generateApproveAll(store, 'enemies');
    const enemiesBefore = (store.state.pack['enemies'] as unknown[]).length;

    store.update = () => {
      throw new Error('注入的更新失败');
    };
    applyBtn.click();

    const status = document.querySelector('.llm-status')!;
    expect(status.textContent).toContain('✗ 入包失败');
    expect(status.textContent).toContain('注入的更新失败');
    expect(document.querySelectorAll('.candidate')).toHaveLength(2);
    expect(applyBtn.textContent).toBe('勾选入包（2）');
    expect(applyBtn.disabled).toBe(false);
    expect((store.state.pack['enemies'] as unknown[]).length).toBe(enemiesBefore);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('成功路径回归：候选清空、状态行报入包数、条目落地、onApplied 触发', async () => {
    const onApplied = vi.fn();
    const store = mountPanel({ client: fakeClient(TWO_ENEMIES_REPLY), onApplied });
    const applyBtn = await generateApproveAll(store, 'enemies');
    applyBtn.click();

    expect(document.querySelector('.llm-status')!.textContent).toContain('已入包 2 条');
    expect(document.querySelectorAll('.candidate')).toHaveLength(0);
    const enemies = store.state.pack['enemies'] as { id: string }[];
    expect(enemies.some((enemy) => enemy.id === 'fake_beast_1')).toBe(true);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('#56 项 1 自然红路径：悬空 drops 候选入包 → 状态行报错带原因、候选保留、包不动', async () => {
    const onApplied = vi.fn();
    const store = mountPanel({ client: fakeClient(DANGLING_DROP_REPLY), onApplied });
    const applyBtn = await generateApproveAll(store, 'enemies');
    const enemiesBefore = (store.state.pack['enemies'] as unknown[]).length;

    applyBtn.click();

    // 事务式门禁（pipeline）抛错 → 面板 catch 呈现：错误原因（含回滚口径
    // 与具体错误路径）可见、候选现场保留可改后再试、包一条未进。
    const status = document.querySelector('.llm-status')!;
    expect(status.textContent).toContain('✗ 入包失败');
    expect(status.textContent).toContain('已整体回滚');
    expect(status.textContent).toContain('/enemies/8/drops/0/item');
    expect(document.querySelectorAll('.candidate')).toHaveLength(1);
    expect(applyBtn.textContent).toBe('勾选入包（1）');
    expect((store.state.pack['enemies'] as unknown[]).length).toBe(enemiesBefore);
    expect(onApplied).not.toHaveBeenCalled();
  });
});
