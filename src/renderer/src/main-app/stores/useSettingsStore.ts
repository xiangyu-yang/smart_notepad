import { create } from 'zustand';

interface SettingsState {
  // --- 大模型 API ---
  baseUrl: string;
  apiKey: string;
  model: string;
  // --- 会议录音转写服务 ---
  transcribeBaseUrl: string;
  transcribeApiKey: string;
  transcribeModel: string;
  transcribeLanguage: string;

  loaded: boolean;

  loadAll: () => Promise<void>;
  save: (patch: { baseUrl: string; apiKey: string; model: string }) => Promise<void>;
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
      transcribeBaseUrl,
      transcribeApiKey,
      transcribeModel,
      transcribeLanguage
    ] = await Promise.all([
      window.api['settings.get']('llm.baseUrl'),
      window.api['settings.get']('llm.apiKey'),
      window.api['settings.get']('llm.model'),
      window.api['settings.get']('transcribe.baseUrl'),
      window.api['settings.get']('transcribe.apiKey'),
      window.api['settings.get']('transcribe.model'),
      window.api['settings.get']('transcribe.language')
    ]);
    set({
      baseUrl: baseUrl ?? 'https://api.openai.com/v1',
      apiKey: apiKey ?? '',
      model: model ?? 'gpt-4o-mini',
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
      window.api['settings.set']('llm.model', patch.model)
    ]);
    set({
      baseUrl: patch.baseUrl,
      apiKey: patch.apiKey,
      model: patch.model
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
