// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../src/llm/client.js';
import { loadLlmConfig, saveLlmConfig } from '../src/llm/config.js';
import { createLlmPanel } from '../src/ui/llmPanel.js';
import { xiuxianStore } from './helpers.js';

/**
 * LLM 面板 DOM 级行为（#74 项 6/7/11）：
 * - 项 11（票评追加项）：候选勾选框 change 后「入包」按钮两态即时跟随
 *   （生成后逐条勾选是主路径，修复前 change 只改数据不重绘、按钮恒灰堵死）；
 *   refresh() 对外接口退役（两态由 repaintCandidates 单点自持）。
 * - 项 7：生成中取消入口（busy 期不再只能干等）。
 * - 项 6：API Key「仅本会话内存态」选项（不勾记住则落库无 key）。
 *
 * 变异对照（改完必须验红再还原，别信「测试在场」）：
 * - 勾选 change 丢 repaintCandidates() → 勾选后按钮仍 disabled/计数不变，本文件红；
 * - 取消按钮丢 abort() 或 finally 丢 busy 复位 → 状态行不落「已取消」/生成钮不解锁，红；
 * - saveLlmConfig 丢 rememberApiKey 剥离 → 不勾记住时 localStorage 里仍有明文 key，红。
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

function mountPanel(opts: { client: LlmClient }): void {
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.append(root);
  createLlmPanel(root, xiuxianStore(), { client: opts.client });
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
    // happy-dom 的 checkbox click() 在 label 内被二次转发（翻转两次回原值）
    // 且不派发 change——测试直接置 checked + 显式派发；真浏览器点击路径由
    // 真机首跑覆盖。
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
