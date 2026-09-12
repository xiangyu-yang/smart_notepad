import { create } from 'zustand';

/**
 * 按模型名给出推荐上下文长度（token 数）。
 * 依据：48GB 统一内存机器上的实测显存预算（GPU 可用约 36GB，Ollama 另需约 2.3GB 预留）。
 * 返回 0 表示不做应用层覆盖，跟随 Ollama 自身默认。
 */
export function recommendContext(model: string): number {
  const m = model.toLowerCase();
  // deepseek-r1 为 dense 推理模型，思考链长且权重占用大
  // 注意：Ollama 的 deepseek-r1:32b 默认 tag 即 Q4_K_M（约 19GB），余量充足
  if (/deepseek-r1:(32|30)b/.test(m)) {
    // Q8/BF16/FP16 等大量化贴边 → 8192；默认 Q4 及其他小量化 → 16384
    return /q8|bf16|fp16/.test(m) ? 8192 : 16384;
  }
  // qwen3.6 35B-A3B：Q8_0 实测全量驻留约 38GB，context 必须压到 4096 才不触发部分卸载
  if (/35b/.test(m)) {
    return /q8|bf16|mxfp8/.test(m) ? 4096 : 16384;
  }
  // 27B 量级（约 28-30GB）：32K 上下文显存仍充足
  if (/27b/.test(m)) {
    return 32768;
  }
  return 0;
}

/**
 * 解析某模型最终生效的 num_ctx：
 * 用户显式配置优先（含 0=跟随 Ollama 默认）；未配置时使用推荐值。
 */
export function resolveNumCtx(model: string, contextByModel: Record<string, number>): number {
  if (Object.prototype.hasOwnProperty.call(contextByModel, model)) {
    return contextByModel[model] ?? 0;
  }
  return recommendContext(model);
}

/** 可选的上下文长度档位（0 = 自动/跟随默认） */
export const CONTEXT_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: '自动（按模型推荐）' },
  { value: 4096, label: '4096' },
  { value: 8192, label: '8192' },
  { value: 16384, label: '16384' },
  { value: 32768, label: '32768' },
  { value: 65536, label: '65536' }
];

interface SettingsState {
  // --- 大模型 API ---
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 模型名 → num_ctx（0 表示跟随 Ollama 默认） */
  contextByModel: Record<string, number>;
  // --- 会议录音转写服务 ---
  transcribeBaseUrl: string;
  transcribeApiKey: string;
  transcribeModel: string;
  transcribeLanguage: string;

  loaded: boolean;

  loadAll: () => Promise<void>;
  save: (patch: {
    baseUrl: string;
    apiKey: string;
    model: string;
    contextByModel: Record<string, number>;
  }) => Promise<void>;
  saveTranscribe: (patch: {
    baseUrl: string;
    apiKey: string;
    model: string;
    language: string;
  }) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  baseUrl: '',
  apiKey: '',
  model: '',
  contextByModel: {},
  transcribeBaseUrl: '',
  transcribeApiKey: '',
  transcribeModel: '',
  transcribeLanguage: 'zh',
  loaded: false,

  loadAll: async () => {
    const [
      baseUrl,
      apiKey,
      model,
      contextByModelRaw,
      transcribeBaseUrl,
      transcribeApiKey,
      transcribeModel,
      transcribeLanguage
    ] = await Promise.all([
      window.api['settings.get']('llm.baseUrl'),
      window.api['settings.get']('llm.apiKey'),
      window.api['settings.get']('llm.model'),
      window.api['settings.get']('llm.contextByModel'),
      window.api['settings.get']('transcribe.baseUrl'),
      window.api['settings.get']('transcribe.apiKey'),
      window.api['settings.get']('transcribe.model'),
      window.api['settings.get']('transcribe.language')
    ]);

    // 历史脏数据容错：只保留正整数条目
    const contextByModel: Record<string, number> = {};
    if (contextByModelRaw && typeof contextByModelRaw === 'object') {
      for (const [k, v] of Object.entries(contextByModelRaw)) {
        if (typeof k === 'string' && k.trim() && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          contextByModel[k.trim()] = Math.floor(v);
        }
      }
    }

    set({
      baseUrl: baseUrl ?? 'https://api.openai.com/v1',
      apiKey: apiKey ?? '',
      model: model ?? 'gpt-4o-mini',
      contextByModel,
      transcribeBaseUrl: transcribeBaseUrl ?? '',
      transcribeApiKey: transcribeApiKey ?? '',
      transcribeModel: transcribeModel ?? 'whisper-1',
      transcribeLanguage: transcribeLanguage ?? 'zh',
      loaded: true
    });
  },

  save: async (patch) => {
    await Promise.all([
      window.api['settings.set']('llm.baseUrl', patch.baseUrl),
      window.api['settings.set']('llm.apiKey', patch.apiKey),
      window.api['settings.set']('llm.model', patch.model),
      window.api['settings.set']('llm.contextByModel', patch.contextByModel)
    ]);
    set({
      baseUrl: patch.baseUrl,
      apiKey: patch.apiKey,
      model: patch.model,
      contextByModel: patch.contextByModel
    });
  },

  saveTranscribe: async (patch) => {
    await Promise.all([
      window.api['settings.set']('transcribe.baseUrl', patch.baseUrl),
      window.api['settings.set']('transcribe.apiKey', patch.apiKey),
      window.api['settings.set']('transcribe.model', patch.model),
      window.api['settings.set']('transcribe.language', patch.language)
    ]);
    set({
      transcribeBaseUrl: patch.baseUrl,
      transcribeApiKey: patch.apiKey,
      transcribeModel: patch.model,
      transcribeLanguage: patch.language
    });
  }
}));
