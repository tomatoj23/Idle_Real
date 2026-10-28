/**
 * LLM 批量生成管道（#11）：提示词模板 → chat 补全 → JSON 数组提取（净化）
 * → 逐条节级 schema 校验 → 候选列表（人工勾选）→ 入包。
 *
 * 入包语义：enemies/items 追加到对应节（撞名 id 入包口逐条跳过，#56）；
 * verbs 合并进 combatText.verbs（撞键跳过）。入包是事务式（#56 项 1）：
 * 入包前留整包错误集作基准，入包后立即整包校验，出现**新增**错误（悬空
 * drops 等条目级 schema 查不到的跨引用语义）即抛错——store.update 按
 * 快照整树回滚（#73），包回到入包前时点。校验面板随 data 事件自动重跑
 * 的整包校验照常。
 */

import { validateContent, validateContentPack, sectionSchemas, type ContentError, type JsonSchema } from '@wendao/content';
import type { EditorStore } from '../core/state.js';
import { entrySchemaOf } from '../core/model.js';
import { packRecordOf, packSectionArray } from '../core/packSection.js';
import { sanitizeParsed } from '../io/files.js';
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
/** 候选条目 → 节级校验 schema（导出供测试钉 pattern 单一来源，#56 项 4）。 */
export function candidateSchemaOf(kind: GenKind): JsonSchema {
  if (kind === 'verbs') {
    const root = sectionSchemas['combatText'] as JsonSchema;
    const keyPattern = verbKeyPatternOf(root);
    return {
      type: 'object',
      required: ['key', 'list'],
      additionalProperties: false,
      properties: {
        // 键形态单一来源（#56 项 4）：pattern 从 combat-text schema 收编，
        // 手写字面量的漂移面退役；schema 未声明（形态漂移）时退化为不钉，
        // 坏键由入包口的整包校验兜底。
        key: keyPattern === undefined ? { type: 'string' } : { type: 'string', pattern: keyPattern },
        list: root.definitions?.['verbList'] ?? { type: 'array' },
      },
      definitions: root.definitions,
    };
  }
  return entrySchemaOf(sectionSchemas[kind] as JsonSchema);
}

/** verbs 候选键 pattern：取自 combat-text schema verbs 的 patternProperties 键（#56 项 4）。 */
export function verbKeyPatternOf(root: JsonSchema): string | undefined {
  return Object.keys(root.properties?.['verbs']?.patternProperties ?? {})[0];
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
  /** 取消信号（#74 项 7）：透传给 client，中止即 ok:false 带取消错误。 */
  readonly signal?: AbortSignal;
}): Promise<GenerateResult> {
  const ctx = packContextOf(opts.pack);
  const messages = buildMessages(opts.kind, ctx, opts.count, opts.hint);
  let reply: string;
  try {
    reply = await opts.client.complete(opts.config, messages, opts.signal);
  } catch (cause) {
    // 取消（#74 项 7）是控制流不是失败：带 signal 中止标记的原样上抛，
    // 由面板层转「已取消」口径；其余失败转 ok:false 可读错误。
    if (opts.signal?.aborted) {
      throw cause;
    }
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }

  let entries: readonly unknown[];
  try {
    entries = extractJsonArray(reply);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
  // LLM 回复与包文件同为不可信 JSON（#89）：parse 产物先过与文件导入同一
  // 净化（原型污染键剔除）再成候选——节级校验（其逐键查表对 __proto__ 有
  // 原型链 quirk，拦不住）、人工勾选、入包（verbs 引用直赋 / enemies·items
  // 克隆两分支）全链只见净化后形态。
  entries = sanitizeParsed(entries) as readonly unknown[];

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

export interface ApplyReport {
  readonly applied: number;
  /** 撞键/复核未过的候选标签。 */
  readonly skipped: readonly string[];
  /** 敌人候选自动补缺省招式注册数（语义闭合辅助，入包可查改）。 */
  readonly movesRegistered: number;
}

/**
 * 勾选候选入包（store.update 原地改）。入包前逐条对**当前包时点**复核
 * 节级 schema（硬原则 3：过 schema 才能进包——生成时快照可能因包已变更
 * 而失效）；verbs 撞键（既有风格键或同批重复）跳过；enemies/items 撞名
 * id 同律逐条跳过（#56 项 1）。
 * 事务式整包把关（#56 项 1）：入包后立即整包校验并对照入包前错误集，
 * 出现新增错误即抛错——store.update 按快照整树回滚（#73），包回到入包
 * 前时点，调用方（llmPanel）catch 报错、候选保留可改后再试。
 * 敌人候选自动在 combatText.moves 补缺省招式注册（语义关卡 xref 要求，
 * 以敌人名为初始招式，作者可再润色），数量见 ApplyReport.movesRegistered。
 */
export function applyCandidates(
  store: EditorStore,
  kind: GenKind,
  approved: readonly Candidate[],
): ApplyReport {
  let applied = 0;
  let movesRegistered = 0;
  const skipped: string[] = [];
  const schema = candidateSchemaOf(kind);
  const skipAll = (): void => {
    for (const candidate of approved) {
      skipped.push(candidate.label);
    }
  };
  // verbs 合并分支（形态守卫沿用 #74 项 2：坏形态整批跳过，不裸断言）。
  const applyVerbs = (pack: Record<string, unknown>): void => {
    const verbs = packRecordOf(packRecordOf(pack['combatText'])?.['verbs']);
    if (verbs === undefined) {
      skipAll();
      return;
    }
    for (const candidate of approved) {
      const { key, list } = candidate.value as { key?: unknown; list?: unknown };
      if (typeof key !== 'string' || key in verbs || !passesSchema(candidate.value, schema)) {
        skipped.push(candidate.label);
        continue;
      }
      verbs[key] = list;
      applied += 1;
    }
  };
  // enemies/items 追加分支。
  const applyEntries = (pack: Record<string, unknown>): void => {
    // 敌人候选的语义闭合辅助：敌人须在 combatText.moves 注册招式名
    // （语义关卡 xref），入包时以敌人名为初始招式补缺省注册，作者可再润色。
    // moves 缺省只降级（不自动注册），不拦截入包。
    const moves =
      kind === 'enemies'
        ? packRecordOf(packRecordOf(pack['combatText'])?.['moves'])
        : undefined;
    const section = packSectionArray(pack, kind);
    if (section === undefined) {
      skipAll();
      return;
    }
    // 撞名拦截（#56 项 1）：条目级 schema 看不见包，重复 id 原先只会在
    // 入包后的整包校验现身。入包口对**当前包时点**建 id 索引（同批已入
    // 包的实时并入），按 verbs 撞键同律逐条跳过——单条坏候选不拖累同批。
    const claimedIds = new Set<string>();
    for (const existing of section) {
      const id = (existing as { id?: unknown })?.id;
      if (typeof id === 'string') {
        claimedIds.add(id);
      }
    }
    for (const candidate of approved) {
      const entry = JSON.parse(JSON.stringify(candidate.value)) as { id?: unknown; name?: unknown };
      if (!passesSchema(entry, schema)) {
        skipped.push(candidate.label);
        continue;
      }
      if (typeof entry.id === 'string' && claimedIds.has(entry.id)) {
        skipped.push(candidate.label);
        continue;
      }
      if (typeof entry.id === 'string') {
        claimedIds.add(entry.id);
      }
      section.push(entry);
      if (moves !== undefined && typeof entry.id === 'string' && !(entry.id in moves)) {
        moves[entry.id] = [typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id];
        movesRegistered += 1;
      }
      applied += 1;
    }
  };
  store.update((pack) => {
    // 基准错误集（#56 项 1）：编辑中允许带错（右栏校验实时红是常态），
    // 事务核对只拦「本次入包新增」的错误——先留入包前错误集作对照底，
    // 存量错误不堵入包。
    const baseline = validateContentPack(pack);
    const baselineKeys = new Set(baseline.ok ? [] : baseline.errors.map(errorKeyOf));
    if (kind === 'verbs') {
      applyVerbs(pack);
    } else {
      applyEntries(pack);
    }
    // 事务式整包把关（#56 项 1）：悬空 drops 等跨引用语义条目级 schema
    // 查不到（看不见包），入包后立即整包校验，出现新增错误即抛错回滚。
    // 已知取舍一：包 schema 已破时 validateContentPack 提前返回（不做语义
    // 检查），此防线随之只剩 schema 面；带 schema 错编辑期的语义把关由
    // 校验面板承担（面板同样提前返回，两处行为一致）。
    // 已知取舍二：差集按 path/keyword/message 全同判等——依赖「追加不位移
    // 既有错误下标、错误消息模板不含随追加漂移的计数」这一当前校验器事实
    // （append-only 入包不满足时才需重审）。
    const after = validateContentPack(pack);
    if (!after.ok) {
      const added = after.errors.filter((error) => !baselineKeys.has(errorKeyOf(error)));
      if (added.length > 0) {
        throw new Error(rollbackMessage(added));
      }
    }
  });
  return { applied, skipped, movesRegistered };
}

/** 入包复核：候选对当前包时点的节级 schema 再验一次。 */
function passesSchema(value: unknown, schema: JsonSchema): boolean {
  return validateContent(value, schema).ok;
}

/** 错误身份键（入包前后差集比较用；path/keyword/message 全同即同一错误）。 */
function errorKeyOf(error: ContentError): string {
  return `${error.path}\u001F${error.keyword}\u001F${error.message}`;
}

/** 回滚错误消息（llmPanel catch 直接呈现；逐条列错误，超三条截断）。 */
function rollbackMessage(added: readonly ContentError[]): string {
  const head = added
    .slice(0, 3)
    .map((error) => `${error.path || '/'} [${error.keyword}] ${error.message}`)
    .join('；');
  return `入包会引入 ${added.length} 处校验错误，已整体回滚（包未改动）：${head}${added.length > 3 ? '…' : ''}`;
}
