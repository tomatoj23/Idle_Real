/**
 * LLM 连接配置（#11）：OpenAI 兼容（baseURL/key/模型名），只存浏览器
 * 本地（localStorage），零上传。环境能力走 globalThis 探测降级
 * （纯 node 测试环境无 storage 时落内存）。
 */

export interface LlmConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
  /**
   * 是否把 apiKey 一并持久化（#74 项 6）：false = 仅本会话内存态——
   * localStorage 落库剥离 key（其余配置照存），刷新即失，防 XSS 明文可读。
   */
  readonly rememberApiKey: boolean;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  rememberApiKey: true,
};

const STORAGE_KEY = 'wendao_editor_llm_config';

/** 探测宿主 localStorage；缺失（node 测试/降级）时返回 undefined。 */
function storageOf(): Storage | undefined {
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  return typeof storage !== 'undefined' ? storage : undefined;
}

export function loadLlmConfig(): LlmConfig {
  const storage = storageOf();
  const raw = storage?.getItem(STORAGE_KEY);
  if (raw === undefined || raw === null) {
    return { ...DEFAULT_LLM_CONFIG };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl !== '' ? parsed.baseUrl : DEFAULT_LLM_CONFIG.baseUrl,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model !== '' ? parsed.model : DEFAULT_LLM_CONFIG.model,
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : DEFAULT_LLM_CONFIG.temperature,
      rememberApiKey: typeof parsed.rememberApiKey === 'boolean' ? parsed.rememberApiKey : DEFAULT_LLM_CONFIG.rememberApiKey,
    };
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

export function saveLlmConfig(config: LlmConfig): void {
  const storage = storageOf();
  try {
    // 仅本会话态（#74 项 6）：不勾记住时落库剥离 key——非敏感配置照存，
    // 旧存量里已落的明文 key 也随本次保存一并清掉。
    const persisted = config.rememberApiKey ? config : { ...config, apiKey: '' };
    storage?.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // 存储不可写（隐私模式等）：配置仅本次会话有效。
  }
}
