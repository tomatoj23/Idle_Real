/**
 * LLM 批量生成管道（#11）：提示词模板 → chat 补全 → JSON 数组提取 →
 * 逐条节级 schema 校验 → 候选列表（人工勾选）→ 入包。
 *
 * 入包语义：enemies/items 追加到对应节；verbs 合并进 combatText.verbs
 * （撞键候选在节级校验处报 duplicate，不入包）。入包后的整包校验由
 * 校验面板随 data 事件自动重跑。
 */

import { validateContent, sectionSchemas, type ContentError, type JsonSchema } from '@wendao/content';
import type { EditorStore } from '../core/state.js';
import { entrySchemaOf } from '../core/model.js';
import { extractJsonArray, type LlmClient } from './client.js';
import { buildMessages, type GenKind, type PackContext } from './prompts.js';

export interface Candidate {
  readonly value: unknown;
  readonly label: string;
  /** 节级校验错误；空数组 = 过关（可勾选）。 */
  readonly errors: readonly ContentError[];
  approved: boolean;
}

export type GenerateResult =
  | { readonly ok: true; readonly candidates: Candidate[] }
  | { readonly ok: false; readonly error: string };

/** 从当前包提取提示词上下文（loadPack 后的包形态合法，防御性兜底空值）。 */
export function packContextOf(pack: Record<string, unknown>): PackContext {
  const texts = pack['texts'] as { shell?: { brand?: { name?: unknown } } } | undefined;
  const combatText = pack['combatText'] as { verbs?: Record<string, unknown> } | undefined;
  const config = pack['config'] as {
    slots?: { id: string }[];
    progression?: { maxLevel?: unknown };
  } | undefined;
  return {
    themeName:
      typeof texts?.shell?.brand?.name === 'string' ? texts.shell.brand.name : '未命名题材',
    verbKeys: Object.keys(combatText?.verbs ?? {}),
    itemIds: idsOf(pack['items']),
    enemyIds: idsOf(pack['enemies']),
    slotIds: (config?.slots ?? []).map((slot) => slot.id),
    elementKeys: idsOf(pack['elements']),
    maxLevel: typeof config?.progression?.maxLevel === 'number' ? config.progression.maxLevel : undefined,
  };
}

function idsOf(section: unknown): string[] {
  return Array.isArray(section)
    ? section
        .map((entry) => (typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id : ''))
        .filter((id) => id !== '')
    : [];
}

/**
 * 候选条目 → 节级校验 schema：
 * - enemies/items：节 items 子 schema + 节根 definitions（$ref 根）；
 * - verbs：候选形态 {key, list}，list 对照节根 verbList 定义。
 */
function candidateSchemaOf(kind: GenKind): JsonSchema {
  if (kind === 'verbs') {
    const root = sectionSchemas['combatText'] as JsonSchema;
    return {
      type: 'object',
      required: ['key', 'list'],
      additionalProperties: false,
      properties: {
        key: { type: 'string', pattern: '^[a-z][a-zA-Z0-9_]*$' },
        list: root.definitions?.['verbList'] ?? { type: 'array' },
      },
      definitions: root.definitions,
    };
  }
  return entrySchemaOf(sectionSchemas[kind] as JsonSchema);
}

function labelOf(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ['id', 'key', 'name']) {
      if (typeof record[key] === 'string' && record[key] !== '') {
        return record[key] as string;
      }
    }
  }
  return JSON.stringify(value).slice(0, 24);
}

/** 批量生成：LLM 回复 → 候选列表（逐条节级校验，默认不勾选）。 */
export async function generateCandidates(opts: {
  readonly kind: GenKind;
  readonly client: LlmClient;
  readonly config: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
    readonly temperature: number;
  };
  readonly count: number;
  readonly hint: string;
  readonly pack: Record<string, unknown>;
}): Promise<GenerateResult> {
  const ctx = packContextOf(opts.pack);
  const messages = buildMessages(opts.kind, ctx, opts.count, opts.hint);
  let reply: string;
  try {
    reply = await opts.client.complete(opts.config, messages);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }

  let entries: readonly unknown[];
  try {
    entries = extractJsonArray(reply);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }

  const schema = candidateSchemaOf(opts.kind);
  const candidates = entries.map((value) => {
    const result = validateContent(value, schema);
    return {
      value,
      label: labelOf(value),
      errors: result.ok ? [] : result.errors,
      approved: false,
    } satisfies Candidate;
  });
  return { ok: true, candidates };
}

/**
 * 勾选候选拟入包快照（不落库）：返回将被应用的变更描述，供确认 UI。
 * verbs 撞键（既有风格键或同批重复）的候选跳过并在 skipped 报告。
 */
export function previewApply(
  kind: GenKind,
  approved: readonly Candidate[],
  pack: Record<string, unknown>,
): { readonly applied: number; readonly skipped: readonly string[] } {
  const skipped: string[] = [];
  let applied = 0;
  if (kind === 'verbs') {
    const combatText = pack['combatText'] as { verbs?: Record<string, unknown> } | undefined;
    const verbs = combatText?.verbs ?? {};
    const seen = new Set<string>(Object.keys(verbs));
    for (const candidate of approved) {
      const key = (candidate.value as { key?: unknown })?.key;
      if (typeof key !== 'string' || seen.has(key)) {
        skipped.push(candidate.label);
        continue;
      }
      seen.add(key);
      applied += 1;
    }
    return { applied, skipped };
  }
  return { applied: approved.length, skipped };
}

/** 勾选候选入包（store.update 原地改）。 */
export function applyCandidates(
  store: EditorStore,
  kind: GenKind,
  approved: readonly Candidate[],
): { readonly applied: number; readonly skipped: readonly string[] } {
  let applied = 0;
  const skipped: string[] = [];
  store.update((pack) => {
    if (kind === 'verbs') {
      const combatText = pack['combatText'] as { verbs: Record<string, unknown> };
      for (const candidate of approved) {
        const { key, list } = candidate.value as { key?: unknown; list?: unknown };
        if (typeof key !== 'string' || key in combatText.verbs) {
          skipped.push(candidate.label);
          continue;
        }
        combatText.verbs[key] = list;
        applied += 1;
      }
      return;
    }
    // 敌人候选的语义闭合辅助：敌人须在 combatText.moves 注册招式名
    // （语义关卡 xref），入包时以敌人名为初始招式补缺省注册，作者可再润色。
    const moves =
      kind === 'enemies'
        ? (pack['combatText'] as { moves: Record<string, string[]> }).moves
        : undefined;
    const section = pack[kind] as unknown[];
    for (const candidate of approved) {
      const entry = JSON.parse(JSON.stringify(candidate.value)) as { id?: unknown; name?: unknown };
      section.push(entry);
      if (moves !== undefined && typeof entry.id === 'string' && !(entry.id in moves)) {
        moves[entry.id] = [typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id];
      }
      applied += 1;
    }
  });
  return { applied, skipped };
}
