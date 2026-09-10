/**
 * OpenAI 兼容 chat/completions 客户端（#11 / ADR-006）：自定义 baseURL
 * 通吃 OpenAI/DeepSeek/硅基流动等。fetch 注入——测试用假 client，不触网。
 */

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmClient {
  /** 单轮补全：返回助手消息文本。失败抛错（消息带响应摘要）。 */
  complete(config: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
    readonly temperature: number;
  }, messages: readonly ChatMessage[]): Promise<string>;
}

interface ChatChoice {
  readonly message?: { readonly content?: unknown };
}

interface ChatResponse {
  readonly choices?: readonly ChatChoice[];
  readonly error?: { readonly message?: unknown };
}

/** 默认客户端：globalThis fetch（bind 纪律——剥 this 再存函数值）；60s 超时防挂死。 */
export function createFetchClient(fetchLike?: typeof fetch): LlmClient {
  const doFetch = fetchLike ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  return {
    async complete(config, messages) {
      const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: config.temperature,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await response.json().catch(() => null)) as ChatResponse | null;
      if (!response.ok) {
        const detail =
          typeof body?.error?.message === 'string' ? `：${body.error.message}` : '';
        throw new Error(`LLM 请求失败（HTTP ${response.status}）${detail}`);
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('LLM 响应缺少 choices[0].message.content');
      }
      return content;
    },
  };
}

/**
 * 从助手回复提取 JSON 数组：markdown 代码栅栏优先，整体 parse → 数组
 * 直用；对象取首个数组值字段（{"items": [...]} 约定）。
 */
export function extractJsonArray(text: string): readonly unknown[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates: readonly string[] = fence ? [fence[1]!, text] : [text];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed === '') {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (typeof parsed === 'object' && parsed !== null) {
        const firstArray = Object.values(parsed).find((value) => Array.isArray(value));
        if (Array.isArray(firstArray)) {
          return firstArray;
        }
      }
    } catch {
      // 尝试下一候选。
    }
  }
  throw new Error('LLM 回复中未找到 JSON 数组');
}
