import { create } from 'zustand';

interface SettingsState {
  baseUrl: string;
  apiKey: string;
  model: string;
  loaded: boolean;

  loadAll: () => Promise<void>;
  save: (patch: { baseUrl: string; apiKey: string; model: string }) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  baseUrl: '',
  apiKey: '',
  model: '',
  loaded: false,

  loadAll: async () => {
    const [baseUrl, apiKey, model] = await Promise.all([
      window.api['settings.get']('llm.baseUrl'),
      window.api['settings.get']('llm.apiKey'),
      window.api['settings.get']('llm.model')
    ]);
    set({
      baseUrl: baseUrl ?? 'https://api.openai.com/v1',
      apiKey: apiKey ?? '',
      model: model ?? 'gpt-4o-mini',
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
  }
}));
