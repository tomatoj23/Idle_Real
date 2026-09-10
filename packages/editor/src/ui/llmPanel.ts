/**
 * LLM 面板（#11）：OpenAI 兼容配置（本地存储零上传）+ 批量生成 +
 * 候选勾选入包。生成/入包经 llm/pipeline，UI 只做编排与呈现。
 */

import { GEN_KINDS, type GenKind } from '../llm/prompts.js';
import { createFetchClient, type LlmClient } from '../llm/client.js';
import { applyCandidates, generateCandidates, type Candidate } from '../llm/pipeline.js';
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from '../llm/config.js';
import type { EditorStore } from '../core/state.js';

export interface LlmPanel {
  /** 数据变更后刷新入包按钮可用态（候选相对当前包可能失效）。 */
  refresh(): void;
}

export function createLlmPanel(
  root: HTMLElement,
  store: EditorStore,
  opts: {
    readonly client?: LlmClient; // 测试注入假 client；缺省 fetch 客户端。
    readonly onApplied?: () => void;
  },
): LlmPanel {
  const client = opts.client ?? createFetchClient();
  let config: LlmConfig = loadLlmConfig();
  let candidates: Candidate[] = [];
  let busy = false;

  /* —— 配置区 —— */
  const fieldset = document.createElement('details');
  fieldset.className = 'llm-config';
  fieldset.open = config.apiKey === '';

  const summary = document.createElement('summary');
  summary.textContent = 'LLM 连接配置（仅存本地）';
  const grid = document.createElement('div');
  grid.className = 'llm-config-grid';

  const baseUrlInput = textInput(config.baseUrl, 'baseURL（如 https://api.deepseek.com/v1）');
  const keyInput = textInput(config.apiKey, 'API Key');
  keyInput.type = 'password';
  const modelInput = textInput(config.model, '模型名（如 deepseek-chat）');
  const saveBtn = button('保存配置', 'btn btn-mini');
  saveBtn.addEventListener('click', () => {
    config = {
      baseUrl: baseUrlInput.value.trim() || config.baseUrl,
      apiKey: keyInput.value.trim(),
      model: modelInput.value.trim() || config.model,
      temperature: config.temperature,
    };
    saveLlmConfig(config);
    statusLine.textContent = '✓ 配置已保存到本地';
  });
  grid.append(
    labeled('Base URL', baseUrlInput),
    labeled('API Key', keyInput),
    labeled('模型', modelInput),
    saveBtn,
  );
  fieldset.append(summary, grid);

  /* —— 生成区 —— */
  const kindSelect = document.createElement('select');
  kindSelect.className = 'input';
  for (const entry of GEN_KINDS) {
    kindSelect.append(optionEl(entry.kind, entry.label));
  }
  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.className = 'input input-inline';
  countInput.min = '1';
  countInput.max = '30';
  countInput.value = '10';
  const hintInput = textInput('', '附加要求（可选，如「低层野外怪」）');
  const generateBtn = button('批量生成', 'btn');
  const statusLine = document.createElement('div');
  statusLine.className = 'llm-status';

  generateBtn.addEventListener('click', () => {
    void runGenerate();
  });

  /* —— 候选区 —— */
  const candidateBox = document.createElement('div');
  candidateBox.className = 'llm-candidates';
  const approveAllBtn = button('全选过验项', 'btn btn-mini');
  const applyBtn = button('勾选入包', 'btn');
  approveAllBtn.addEventListener('click', () => {
    for (const candidate of candidates) {
      candidate.approved = candidate.errors.length === 0;
    }
    repaintCandidates();
  });
  applyBtn.addEventListener('click', () => {
    const approved = candidates.filter((candidate) => candidate.approved);
    if (approved.length === 0) return;
    const kind = kindSelect.value as GenKind;
    const result = applyCandidates(store, kind, approved);
    candidates = [];
    repaintCandidates();
    statusLine.textContent = `已入包 ${result.applied} 条${result.skipped.length > 0 ? `（跳过 ${result.skipped.join('、')}）` : ''}`;
    opts.onApplied?.();
  });

  root.append(
    heading('LLM 批量生成'),
    fieldset,
    labeled('内容类型', kindSelect),
    labeled('数量', countInput),
    labeled('附加要求', hintInput),
    generateBtn,
    statusLine,
    candidateBox,
    approveAllBtn,
    applyBtn,
  );

  async function runGenerate(): Promise<void> {
    if (busy) return;
    if (!store.hasPack()) {
      statusLine.textContent = '✗ 请先加载内容包（生成依赖包内键域上下文）';
      return;
    }
    busy = true;
    generateBtn.disabled = true;
    statusLine.textContent = '生成中…';
    candidateBox.replaceChildren();
    try {
      const result = await generateCandidates({
        kind: kindSelect.value as GenKind,
        client,
        config,
        count: Math.max(1, Math.min(30, Number.parseInt(countInput.value, 10) || 1)),
        hint: hintInput.value,
        pack: store.state.pack,
      });
      if (!result.ok) {
        statusLine.textContent = `✗ ${result.error}`;
        return;
      }
      candidates = result.candidates;
      const passed = candidates.filter((candidate) => candidate.errors.length === 0).length;
      statusLine.textContent = `生成 ${candidates.length} 条，其中 ${passed} 条过校验（红条不可入包）`;
      repaintCandidates();
    } catch (cause) {
      const stack = cause instanceof Error ? (cause.stack ?? '') : '';
      statusLine.textContent = `✗ 生成失败：${cause instanceof Error ? cause.message : String(cause)}`;
      statusLine.title = stack;
    } finally {
      busy = false;
      generateBtn.disabled = false;
    }
  }

  function repaintCandidates(): void {
    candidateBox.replaceChildren();
    for (const [index, candidate] of candidates.entries()) {
      const row = document.createElement('label');
      row.className = `candidate ${candidate.errors.length === 0 ? 'ok' : 'bad'}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.disabled = candidate.errors.length > 0;
      checkbox.checked = candidate.approved;
      checkbox.addEventListener('change', () => {
        candidate.approved = checkbox.checked;
      });
      const label = document.createElement('span');
      label.className = 'candidate-label';
      label.textContent = candidate.label;
      row.append(checkbox, label);
      if (candidate.errors.length > 0) {
        const errors = document.createElement('span');
        errors.className = 'candidate-errors';
        errors.title = candidate.errors.map((error) => `${error.path} ${error.message}`).join('\n');
        errors.textContent = `✗ ${candidate.errors.length} 错`;
        row.append(errors);
      }
      candidateBox.append(row);
      void index;
    }
    applyBtn.textContent = `勾选入包（${candidates.filter((candidate) => candidate.approved).length}）`;
    applyBtn.disabled = candidates.every((candidate) => !candidate.approved);
  }

  return {
    refresh() {
      applyBtn.disabled = candidates.every((candidate) => !candidate.approved);
    },
  };
}

function heading(text: string): HTMLElement {
  const node = document.createElement('h3');
  node.className = 'panel-heading';
  node.textContent = text;
  return node;
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'llm-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}

function textInput(value: string, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function button(text: string, className: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = text;
  return node;
}

function optionEl(value: string, text: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  return option;
}
