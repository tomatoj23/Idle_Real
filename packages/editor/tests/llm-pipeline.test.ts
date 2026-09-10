import { describe, expect, it } from 'vitest';
import { validateContentPack } from '@wendao/content';
import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import { extractJsonArray, type LlmClient } from '../src/llm/client.js';
import { createFetchClient } from '../src/llm/client.js';
import { applyCandidates, generateCandidates, packContextOf, previewApply } from '../src/llm/pipeline.js';
import { createStore } from '../src/core/state.js';
import type { ChatMessage } from '../src/llm/client.js';

/** 假 LLM client：按脚本回固定文本（验收 2 的「配置假 LLM client」）。 */
function fakeClient(reply: string, log?: ChatMessage[][]): LlmClient {
  return {
    async complete(_config, messages) {
      log?.push([...messages]);
      return reply;
    },
  };
}

const CONFIG = { baseUrl: 'http://mock/v1', apiKey: 'test-key', model: 'mock-model', temperature: 0.5 };

/** 生成 10 条修仙风敌人（全部跨引用闭合：kind/drops 引用真包既有域）。 */
const TEN_ENEMIES_REPLY = JSON.stringify({
  items: Array.from({ length: 10 }, (_, i) => ({
    id: `fake_beast_${i + 1}`,
    name: `幻兽${i + 1}号`,
    icon: '幻',
    level: 1 + i,
    kind: 'claw',
    hp: 50 + i * 10,
    atk: 8 + i,
    def: 2 + i,
    attackInterval: 2400,
    exp: 15 + i * 2,
    gold: { min: 3, max: 9 + i },
    drops: [{ item: 'core1', chance: 0.2 }],
  })),
});

describe('extractJsonArray', () => {
  it('裸数组 / {"items":[...]} 包裹 / markdown 栅栏三种回复形态', () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(extractJsonArray('{"items":[{"a":1}]}')).toEqual([{ a: 1 }]);
    expect(extractJsonArray('好的，如下：\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it('无数组内容时抛错', () => {
    expect(() => extractJsonArray('抱歉我不能')).toThrow();
  });
});

describe('generateCandidates：假 client 批量生成（验收 2）', () => {
  it('批量 10 条敌人 → 全部过节级校验 → 勾选入包 → 整包仍合法', async () => {
    const store = createStore(xiuxianPackJson);
    const calls: ChatMessage[][] = [];
    const client = fakeClient(TEN_ENEMIES_REPLY, calls);

    const result = await generateCandidates({
      kind: 'enemies',
      client,
      config: CONFIG,
      count: 10,
      hint: '低层野外怪',
      pack: store.state.pack,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 10 条候选，全部零错误。
    expect(result.candidates).toHaveLength(10);
    for (const candidate of result.candidates) {
      expect(candidate.errors, `${candidate.label} 校验失败`).toEqual([]);
    }

    // 提示词带包实况上下文（动词池键域/物品 id）。
    const userMessage = calls[0]!.find((m) => m.role === 'user')!.content;
    expect(userMessage).toContain('claw');
    expect(userMessage).toContain('core1');

    // 人工勾选：全选后入包。
    for (const candidate of result.candidates) {
      candidate.approved = true;
    }
    const applied = applyCandidates(store, 'enemies', result.candidates.filter((c) => c.approved));
    expect(applied.applied).toBe(10);
    expect(applied.skipped).toEqual([]);

    // 入包后整包校验通过（语义关卡：kind/moves/drops 跨引用闭合）。
    const packCheck = validateContentPack(store.state.pack);
    expect(packCheck.ok ? '' : JSON.stringify(packCheck.errors, null, 1)).toBe('');
    const enemies = store.state.pack['enemies'] as { id: string }[];
    expect(enemies.some((enemy) => enemy.id === 'fake_beast_1')).toBe(true);
  });

  it('LLM 回复含坏条目：坏条目带字段级错误，好条目仍可入包', async () => {
    const store = createStore(xiuxianPackJson);
    const reply = JSON.stringify({
      items: [
        { id: 'good_one', name: '好怪', icon: '好', level: 1, kind: 'claw', hp: 40, atk: 8, def: 2, attackInterval: 2400, exp: 10, gold: { min: 1, max: 3 }, drops: [{ item: 'core1', chance: 0.3 }] },
        { id: 'BAD-ID!', name: '坏怪', icon: '坏', level: 1, kind: 'claw', hp: 40, atk: 8, def: 2, attackInterval: 2400, exp: 10, gold: { min: 1, max: 3 }, drops: [] },
      ],
    });
    const result = await generateCandidates({
      kind: 'enemies', client: fakeClient(reply), config: CONFIG, count: 2, hint: '', pack: store.state.pack,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]!.errors).toEqual([]);
    expect(result.candidates[1]!.errors.length).toBeGreaterThan(0);
    expect(result.candidates[1]!.errors[0]!.path).toBe('/id');
  });

  it('verbs 候选入包合并进 combatText.verbs；撞键跳过', async () => {
    const store = createStore(xiuxianPackJson);
    const reply = JSON.stringify({
      items: [
        { key: 'fan', list: [{ v: '折扇轻摇', limbs: ['手腕'] }, { v: '扇骨点穴', limbs: ['指尖'] }] },
        { key: 'claw', list: [{ v: '重复键', limbs: ['利爪'] }] },
      ],
    });
    const result = await generateCandidates({
      kind: 'verbs', client: fakeClient(reply), config: CONFIG, count: 2, hint: '', pack: store.state.pack,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const candidate of result.candidates) {
      expect(candidate.errors, candidate.label).toEqual([]);
    }
    const preview = previewApply('verbs', result.candidates, store.state.pack);
    expect(preview.applied).toBe(1);
    expect(preview.skipped).toEqual(['claw']);

    applyCandidates(store, 'verbs', result.candidates);
    const verbs = (store.state.pack['combatText'] as { verbs: Record<string, unknown> }).verbs;
    expect('fan' in verbs).toBe(true);
    expect(verbs['fan']).toEqual([
      { v: '折扇轻摇', limbs: ['手腕'] },
      { v: '扇骨点穴', limbs: ['指尖'] },
    ]);
    const packCheck = validateContentPack(store.state.pack);
    expect(packCheck.ok).toBe(true);
  });

  it('client 抛错 / 回复无 JSON → ok:false 带可读错误', async () => {
    const store = createStore(xiuxianPackJson);
    const fail = await generateCandidates({
      kind: 'enemies',
      client: {
        async complete() {
          throw new Error('HTTP 401：key 无效');
        },
      },
      config: CONFIG, count: 1, hint: '', pack: store.state.pack,
    });
    expect(fail).toEqual({ ok: false, error: 'HTTP 401：key 无效' });

    const garbage = await generateCandidates({
      kind: 'enemies', client: fakeClient('无法作答'), config: CONFIG, count: 1, hint: '', pack: store.state.pack,
    });
    expect(garbage.ok).toBe(false);
  });
});

describe('packContextOf', () => {
  it('从真包提取键域上下文', () => {
    const ctx = packContextOf(xiuxianPackJson as Record<string, unknown>);
    expect(ctx.verbKeys).toContain('basic');
    expect(ctx.itemIds).toContain('core1');
    expect(ctx.enemyIds.length).toBeGreaterThan(0);
    expect(ctx.slotIds.length).toBeGreaterThan(0);
    expect(ctx.elementKeys.length).toBeGreaterThan(0);
  });
});

describe('createFetchClient（请求形态守卫，fetch 注入假实现）', () => {
  it('POST baseUrl/chat/completions，带 Bearer 与 messages', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const stubFetch = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '[]' } }] }),
      } as Response;
    }) as typeof fetch;
    const client = createFetchClient(stubFetch);
    const reply = await client.complete(CONFIG, [{ role: 'user', content: 'hi' }]);
    expect(reply).toBe('[]');
    expect(captured!.url).toBe('http://mock/v1/chat/completions');
    expect((captured!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    expect(JSON.parse(captured!.init.body as string)).toMatchObject({ model: 'mock-model' });
  });
});
