/**
 * LLM 面板（#11）：OpenAI 兼容配置（本地存储零上传）+ 批量生成 +
 * 候选勾选入包。生成/入包经 llm/pipeline，UI 只做编排与呈现。
 *
 * #74：按钮两态（计数/可用）由 repaintCandidates 单点自持——候选勾选
 * change 即重绘（逐条勾选主路径曾堵死）；对外 refresh() 接口退役，
 * 调用方无需知道本面板。生成中可取消（AbortController 透传 pipeline）。
 * API Key 可选「仅本会话内存态」（#74 项 6 威胁模型：localStorage 明文）。
 * #89：候选值树由 pipeline 生成时净化（原型污染键剔除）；勾选入包
 * try/catch/finally 兜底——抛错状态行报错、候选保留，finally 复位两态。
 */

import { GEN_LABELS, genKinds, type GenKind } from '../llm/prompts.js';
import { createFetchClient, type LlmClient } from '../llm/client.js';
import { applyCandidates, generateCandidates, type Candidate } from '../llm/pipeline.js';
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from '../llm/config.js';
import type { EditorStore } from '../core/state.js';
import { optionEl } from './render.js';

export function createLlmPanel(
  root: HTMLElement,
  store: EditorStore,
  opts: {
    readonly client?: LlmClient; // 测试注入假 client；缺省 fetch 客户端。
    readonly onApplied?: () => void;
  },
): void {
  const client = opts.client ?? createFetchClient();
  let config: LlmConfig = loadLlmConfig();
  let candidates: Candidate[] = [];
  let busy = false;
  let abortController: AbortController | undefined;

  /* —— 配置区 —— */
  const fieldset = document.createElement('details');
  fieldset.className = 'llm-config';
  fieldset.open = config.apiKey === '';

  const summary = document.createElement('summary');
  summary.textContent = 'LLM 连接配置（仅存本地，不上传）';
  const grid = document.createElement('div');
  grid.className = 'llm-config-grid';

  const baseUrlInput = textInput(config.baseUrl, 'baseURL（如 https://api.deepseek.com/v1）');
  const keyInput = textInput(config.apiKey, 'API Key');
  keyInput.type = 'password';
  const modelInput = textInput(config.model, '模型名（如 deepseek-chat）');
  // #74 项 6：默认记住（存量行为不变）；不勾 = 仅本会话内存态，落库无 key。
  const rememberKeyInput = document.createElement('input');
  rememberKeyInput.type = 'checkbox';
  rememberKeyInput.className = 'remember-key';
  rememberKeyInput.checked = config.rememberApiKey;
  const rememberKeyLabel = document.createElement('label');
  rememberKeyLabel.className = 'llm-threat-note';
  rememberKeyLabel.append(
    rememberKeyInput,
    document.createTextNode('记住 API Key'),
  );
  rememberKeyLabel.title =
    '勾选：Key 明文保存在本机浏览器 localStorage（不上传，但本机脚本可读）。' +
    '不勾：仅保留在当前页面内存，刷新即失，每次会话现填。';
  const threatNote = document.createElement('div');
  threatNote.className = 'llm-threat-note';
  threatNote.textContent =
    'Key 只存本机、不上传；localStorage 为明文存储，可被本机脚本读取——介意请取消勾选（仅本会话有效）。';
  const saveBtn = button('保存配置', 'btn btn-mini');
  saveBtn.addEventListener('click', () => {
    config = {
      baseUrl: baseUrlInput.value.trim() || config.baseUrl,
      apiKey: keyInput.value.trim(),
      model: modelInput.value.trim() || config.model,
      temperature: config.temperature,
      rememberApiKey: rememberKeyInput.checked,
    };
    saveLlmConfig(config);
    statusLine.textContent = '✓ 配置已保存到本地';
  });
  grid.append(
    labeled('Base URL', baseUrlInput),
    labeled('API Key', keyInput),
    labeled('模型', modelInput),
    rememberKeyLabel,
    threatNote,
    saveBtn,
  );
  fieldset.append(summary, grid);

  /* —— 生成区 —— */
  const kindSelect = document.createElement('select');
  kindSelect.className = 'input';
  // 可生成目标从节 schema 的 x-llm 旗标发现（#45），展示名随模板同居 prompts。
  for (const kind of genKinds()) {
    kindSelect.append(optionEl(kind, GEN_LABELS[kind]));
  }
  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.className = 'input input-inline';
  countInput.min = '1';
  countInput.max = '30';
  countInput.value = '10';
  const hintInput = textInput('', '附加要求（可选，如「低层野外怪」）');
  const generateBtn = button('批量生成', 'btn');
  const cancelBtn = button('取消', 'btn btn-mini');
  cancelBtn.hidden = true;
  const statusLine = document.createElement('div');
  statusLine.className = 'llm-status';

  generateBtn.addEventListener('click', () => {
    void runGenerate();
  });
  // #74 项 7：busy 期取消入口——中止当前请求，busy 复位走 runGenerate finally。
  cancelBtn.addEventListener('click', () => {
    abortController?.abort();
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
    let succeeded = false;
    try {
      const result = applyCandidates(store, kind, approved);
      candidates = [];
      statusLine.textContent =
        `已入包 ${result.applied} 条` +
        (result.movesRegistered > 0 ? `（${result.movesRegistered} 个新敌人已自动注册缺省招式名，可在战斗文案节润色）` : '') +
        (result.skipped.length > 0 ? `（跳过 ${result.skipped.join('、')}）` : '');
      succeeded = true;
    } catch (cause) {
      // 防御纵深（#89 项 2）＋自然抛点承接（#56 项 1）：入包事务门禁
      // （pipeline 整包校验）会在此真实抛错——状态行报错、候选现场保留
      // （可勾选重试）；store.update 抛错已整树回滚（#73 rollback），
      // 此处只兜 UI 面。
      statusLine.textContent = `✗ 入包失败：${cause instanceof Error ? cause.message : String(cause)}`;
    } finally {
      // 按钮两态单点复位：成功（候选清空→计数归零）与失败（现场保留→
      // 计数原样）都由 repaintCandidates 按最新 candidates 收口。
      repaintCandidates();
    }
    // onApplied 不划入兜底面（catch 只兜 applyCandidates/store.update）：
    // 它在包已写入后触发，自身抛错入 catch 会被误报「入包失败」。
    if (succeeded) opts.onApplied?.();
  });

  root.append(
    heading('LLM 批量生成'),
    fieldset,
    labeled('内容类型', kindSelect),
    labeled('数量', countInput),
    labeled('附加要求', hintInput),
    generateBtn,
    cancelBtn,
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
    cancelBtn.hidden = false;
    statusLine.textContent = '生成中…';
    candidateBox.replaceChildren();
    const controller = new AbortController();
    abortController = controller;
    try {
      const result = await generateCandidates({
        kind: kindSelect.value as GenKind,
        client,
        config,
        count: Math.max(1, Math.min(30, Number.parseInt(countInput.value, 10) || 1)),
        hint: hintInput.value,
        pack: store.state.pack,
        signal: controller.signal,
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
      // 取消（#74 项 7）不是失败：单独口径呈现，不带 ✗。
      if (controller.signal.aborted) {
        statusLine.textContent = '已取消生成';
        return;
      }
      const stack = cause instanceof Error ? (cause.stack ?? '') : '';
      statusLine.textContent = `✗ 生成失败：${cause instanceof Error ? cause.message : String(cause)}`;
      statusLine.title = stack;
    } finally {
      busy = false;
      generateBtn.disabled = false;
      cancelBtn.hidden = true;
      if (abortController === controller) {
        abortController = undefined;
      }
    }
  }

  function repaintCandidates(): void {
    candidateBox.replaceChildren();
    for (const candidate of candidates) {
      const row = document.createElement('label');
      row.className = `candidate ${candidate.errors.length === 0 ? 'ok' : 'bad'}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.disabled = candidate.errors.length > 0;
      checkbox.checked = candidate.approved;
      checkbox.addEventListener('change', () => {
        candidate.approved = checkbox.checked;
        // #74 项 11：两态由本函数单点自持——勾选即整表重绘（个位数规模），
        // 计数与可用态不再有第二条维护路径（曾漏此步致主路径堵死）。
        repaintCandidates();
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
    }
    applyBtn.textContent = `勾选入包（${candidates.filter((candidate) => candidate.approved).length}）`;
    applyBtn.disabled = candidates.every((candidate) => !candidate.approved);
  }

  // 初始两态：无候选 → 入包钮禁用（与 repaintCandidates 单点同律）。
  repaintCandidates();
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
