import { useEffect, useState, useRef, useCallback } from 'react';
import { router } from '../App';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useNoteStore } from '../stores/useNoteStore';
import { useToast } from '../hooks/useToast';
import IconButton from '../components/IconButton';

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

/**
 * Ollama / OpenAI 模型列表响应中单项的可能形态。
 * 解析的是外部服务返回的 JSON，shape 不可静态保证，所以字段以 unknown 暴露再做类型收窄。
 */
type ModelEntry = string | { name?: unknown; id?: unknown };

/** 从单项中提取模型名：name 优先 / id 优先，仅接受 string 字段（与原行为一致，跳过非字符串值）。 */
function pickModelName(m: ModelEntry, prefer: 'name' | 'id' = 'name'): string | null {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    const obj = m as { name?: unknown; id?: unknown };
    if (prefer === 'name') {
      if (typeof obj.name === 'string') return obj.name;
      if (typeof obj.id === 'string') return obj.id;
    } else {
      if (typeof obj.id === 'string') return obj.id;
      if (typeof obj.name === 'string') return obj.name;
    }
  }
  return null;
}

async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const normalized = normalizeBaseUrl(baseUrl);
  const endpoints = [
    `${normalized}/api/tags`,
    `${normalized}/models`,
    normalized.endsWith('/v1') ? `${normalized.slice(0, -3)}/api/tags` : `${normalized}/api/tags`
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) continue;
      const data = await res.json();
      const models: string[] = [];

      if (Array.isArray(data.models)) {
        data.models.forEach((m: ModelEntry) => {
          const name = pickModelName(m, 'name');
          if (name) models.push(name);
        });
      } else if (Array.isArray(data.data)) {
        data.data.forEach((m: ModelEntry) => {
          const name = pickModelName(m, 'id');
          if (name) models.push(name);
        });
      }

      if (models.length > 0) {
        return [...new Set(models)].sort();
      }
    } catch {
      // try next endpoint
    }
  }
  return [];
}

type TestResult = {
  status: 'idle' | 'testing' | 'success' | 'error';
  message: string;
  models?: string[];
};

async function testConnection(baseUrl: string, apiKey: string, model: string): Promise<TestResult> {
  const normalized = normalizeBaseUrl(baseUrl);
  const urls = [
    normalized,
    normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content || '连接成功';
        return { status: 'success', message: `连接成功！模型回复："${reply.slice(0, 50)}"` };
      }

      if (res.status === 401 || res.status === 403) {
        return { status: 'error', message: `认证失败（HTTP ${res.status}），请检查 API Key` };
      }

      if (res.status === 404) {
        // Try listing models instead
        const models = await fetchOllamaModels(normalized);
        if (models.length > 0) {
          return {
            status: 'success',
            message: `连接成功！检测到 ${models.length} 个可用模型`,
            models
          };
        }
        return { status: 'error', message: `未找到模型（HTTP 404），请确认 Base URL 正确` };
      }

      if (res.status === 429) {
        return { status: 'error', message: '请求过于频繁（HTTP 429），请稍后重试' };
      }

      const errorText = await res.text();
      return { status: 'error', message: `请求失败（HTTP ${res.status}）：${errorText.slice(0, 100)}` };
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        return { status: 'error', message: '连接超时（15秒），请检查网络或服务地址' };
      }
      // Try listing models as a fallback
      try {
        const models = await fetchOllamaModels(normalized);
        if (models.length > 0) {
          return {
            status: 'success',
            message: `连接成功（通过模型列表检测）！检测到 ${models.length} 个可用模型`,
            models
          };
        }
      } catch {
        // ignore
      }
      const detail = err instanceof Error ? err.message : '网络错误';
      return { status: 'error', message: `无法连接到 ${normalized}：${detail}` };
    }
  }

  return { status: 'error', message: '连接测试失败' };
}

export default function SettingsPage() {
  const toast = useToast();
  const storeLoaded = useSettingsStore((s) => s.loaded);
  const loadAll = useSettingsStore((s) => s.loadAll);
  const saveSettings = useSettingsStore((s) => s.save);
  const currentNoteId = useNoteStore((s) => s.currentId);

  const storeBaseUrl = useSettingsStore((s) => s.baseUrl);
  const storeApiKey = useSettingsStore((s) => s.apiKey);
  const storeModel = useSettingsStore((s) => s.model);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [testResult, setTestResult] = useState<TestResult>({ status: 'idle', message: '' });
  const [ollamaStarting, setOllamaStarting] = useState(false);

  const isOllamaUrl = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');

  useEffect(() => {
    if (!storeLoaded) {
      loadAll().catch((e) => {
        console.error(e);
        toast.error('加载设置失败');
      });
    }
  }, [storeLoaded, loadAll, toast]);

  useEffect(() => {
    if (storeLoaded) {
      setBaseUrl(storeBaseUrl);
      setApiKey(storeApiKey);
      setModel(storeModel);
    }
  }, [storeLoaded, storeBaseUrl, storeApiKey, storeModel]);

  // When Base URL changes, debounce fetch available models
  useEffect(() => {
    if (!baseUrl.trim()) {
      setAvailableModels([]);
      setModelsError(null);
      return;
    }
    if (modelFetchTimerRef.current) clearTimeout(modelFetchTimerRef.current);
    modelFetchTimerRef.current = setTimeout(async () => {
      setModelsLoading(true);
      setModelsError(null);
      try {
        const models = await fetchOllamaModels(baseUrl);
        setAvailableModels(models);
      } catch (e) {
        setModelsError('获取模型列表失败');
        setAvailableModels([]);
      } finally {
        setModelsLoading(false);
      }
    }, 500);
    return () => {
      if (modelFetchTimerRef.current) clearTimeout(modelFetchTimerRef.current);
    };
  }, [baseUrl]);

  const isDirty =
    baseUrl !== storeBaseUrl ||
    apiKey !== storeApiKey ||
    model !== storeModel;

  const handleBack = useCallback(() => {
    // Strategy 1: browser history back (most reliable for hash routing)
    try {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
    } catch (e) {
      console.error('[SettingsPage] history.back failed:', e);
    }
    // Strategy 2: direct hash change
    const target = currentNoteId ? `#/note/${currentNoteId}` : '#/';
    window.location.replace(target);
  }, [currentNoteId]);

  const handleSave = async () => {
    if (!baseUrl.trim()) {
      toast.error('Base URL 不能为空');
      return;
    }
    setSaving(true);
    try {
      await saveSettings({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim() || 'gpt-4o-mini'
      });
      await loadAll();
      toast.success('设置已保存');
      // Navigate back to the previously viewed note (direct hash to avoid blocker issues)
      if (currentNoteId) {
        window.location.hash = `#/note/${currentNoteId}`;
      } else {
        window.location.hash = '#/';
      }
    } catch (e) {
      console.error(e);
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!baseUrl.trim()) {
      setTestResult({ status: 'error', message: '请先填写 Base URL' });
      return;
    }
    setTestResult({ status: 'testing', message: '正在测试连接…' });
    const result = await testConnection(baseUrl, apiKey, model || storeModel);
    setTestResult(result);
    // If test found models, update the available list
    if (result.models && result.models.length > 0) {
      setAvailableModels(result.models);
      if (!model && result.models.length > 0) {
        setModel(result.models[0]);
      }
    }
  };

  const handleStartOllama = async () => {
    setOllamaStarting(true);
    setTestResult({ status: 'testing', message: '正在启动 Ollama 服务…' });
    try {
      const result = await window.api['ollama.start']();
      if (result.success) {
        setTestResult({ status: 'success', message: result.message + '，正在重新测试连接…' });
        // Auto-retry connection test after a brief delay
        setTimeout(async () => {
          const testResult = await testConnection(baseUrl, apiKey, model || storeModel);
          setTestResult(testResult);
          if (testResult.models && testResult.models.length > 0) {
            setAvailableModels(testResult.models);
            if (!model) setModel(testResult.models[0]);
          }
        }, 1000);
      } else {
        setTestResult({ status: 'error', message: result.message });
      }
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      setTestResult({ status: 'error', message: `启动失败：${detail}` });
    } finally {
      setOllamaStarting(false);
    }
  };

  const showModelDropdown = availableModels.length > 0;

  return (
    <div className="h-full w-full overflow-y-auto thin-scrollbar animate-slideUp">
      <div className="max-w-[640px] mx-auto px-8 py-10">
        <div className="flex items-center gap-3 mb-8">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleBack();
            }}
            title="返回"
            className="no-drag w-9 h-9 flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-paper-100 active:bg-paper-200 rounded-xl transition-all duration-150 hover:scale-[1.03] active:scale-[0.98] text-base select-none outline-none"
          >
            ←
          </a>
          <div>
            <div className="text-2xl font-bold text-ink-900 tracking-tight">设置</div>
            <div className="text-sm text-ink-500 mt-0.5">大模型 API 与应用信息</div>
          </div>
        </div>

        <section className="mb-10">
          <div className="text-sm font-semibold text-sage-700 mb-4 px-1 uppercase tracking-wider text-xs">
            大模型 API
          </div>
          <div className="bg-paper-100/60 rounded-2xl p-5 space-y-5 border border-paper-200/70">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">
                Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434  (Ollama) 或 https://api.openai.com/v1"
                className="w-full h-10 px-3.5 rounded-xl bg-white border border-paper-300/80 hover:border-paper-300 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/30 outline-none text-sm text-ink-900 placeholder:text-ink-300 transition-all"
              />
              <div className="text-xs text-ink-300 mt-1.5 px-1">
                Ollama 示例：http://localhost:11434 · OpenAI https://api.openai.com/v1
                {modelsLoading && (
                  <span className="text-sage-600 ml-2">正在获取模型列表…</span>
                )}
                {!modelsLoading && modelsError && (
                  <span className="text-amber-500 ml-2">{modelsError}</span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={storeApiKey ? '••••••••' : 'sk-...'}
                  className="w-full h-10 pl-3.5 pr-12 rounded-xl bg-white border border-paper-300/80 hover:border-paper-300 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/30 outline-none text-sm text-ink-900 placeholder:text-ink-300 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="no-drag absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-paper-100 transition-colors text-sm"
                  title={showKey ? '隐藏明文' : '显示明文'}
                >
                  {showKey ? '🙈' : '👁'}
                </button>
              </div>
              <div className="text-xs text-ink-300 mt-1.5 px-1">
                仅保存在本地 SQLite，不会上传到任何服务器
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">
                Model 名称
              </label>
              {showModelDropdown ? (
                <div className="flex gap-2">
                  <select
                    value={availableModels.includes(model) ? model : ''}
                    onChange={(e) => setModel(e.target.value)}
                    className="flex-1 h-10 px-3.5 rounded-xl bg-white border border-paper-300/80 hover:border-paper-300 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/30 outline-none text-sm text-ink-900 transition-all cursor-pointer"
                  >
                    <option value="" disabled>
                      选择模型（共 {availableModels.length} 个可用）
                    </option>
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="或手动输入"
                    className="w-40 h-10 px-3 rounded-xl bg-white border border-paper-300/80 hover:border-paper-300 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/30 outline-none text-sm text-ink-900 placeholder:text-ink-300 transition-all"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={modelsLoading ? '获取模型列表中…' : 'gpt-4o-mini'}
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-paper-300/80 hover:border-paper-300 focus:border-sage-500 focus:ring-2 focus:ring-sage-500/30 outline-none text-sm text-ink-900 placeholder:text-ink-300 transition-all"
                />
              )}
              <div className="text-xs text-ink-300 mt-1.5 px-1">
                {showModelDropdown
                  ? '从下拉框选择已检测到的模型，或在右侧手动输入自定义名称'
                  : '填写 Ollama Base URL 后自动列出可用模型；其他 API 可手动输入'}
              </div>
            </div>

            {/* Connection Test */}
            <div className="pt-2 border-t border-paper-200/60">
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={handleTestConnection}
                  disabled={testResult.status === 'testing' || !baseUrl.trim()}
                  className={[
                    'h-9 px-4 rounded-xl text-sm font-medium flex items-center gap-2 transition-all duration-150',
                    testResult.status === 'testing'
                      ? 'bg-paper-200 text-ink-300 cursor-not-allowed'
                      : 'bg-white border border-paper-300 text-ink-700 hover:bg-sage-50 hover:border-sage-400 hover:text-sage-700 hover:scale-[1.02] active:scale-[0.98]'
                  ].join(' ')}
                >
                  {testResult.status === 'testing' ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-ink-300 border-t-sage-500 rounded-full animate-spin" />
                      测试中…
                    </>
                  ) : (
                    <>🔌 测试连接</>
                  )}
                </button>
                {testResult.status === 'success' && (
                  <span className="text-xs text-sage-600 font-medium">✓ 连接正常</span>
                )}
                {testResult.status === 'error' && (
                  <span className="text-xs text-rose-600 font-medium">✗ 连接失败</span>
                )}
              </div>
              {testResult.message && (
                <div
                  className={[
                    'text-xs px-3 py-2 rounded-lg border',
                    testResult.status === 'success'
                      ? 'bg-sage-50 border-sage-200 text-sage-700'
                      : testResult.status === 'error'
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-paper-100 border-paper-200 text-ink-500'
                  ].join(' ')}
                >
                  {testResult.message}
                </div>
              )}
              {testResult.status === 'error' && isOllamaUrl && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-amber-600 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex-1">
                    💡 检测到 Ollama 未运行，可尝试自动启动
                  </span>
                  <button
                    onClick={handleStartOllama}
                    disabled={ollamaStarting}
                    className={[
                      'shrink-0 h-9 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all',
                      ollamaStarting
                        ? 'bg-paper-200 text-ink-300 cursor-not-allowed'
                        : 'bg-sage-600 text-white hover:bg-sage-700 hover:scale-[1.02] active:scale-[0.98]'
                    ].join(' ')}
                  >
                    {ollamaStarting ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                        启动中…
                      </>
                    ) : (
                      <>🚀 启动 Ollama</>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mb-10">
          <div className="text-sm font-semibold text-sage-700 mb-4 px-1 uppercase tracking-wider text-xs">
            关于
          </div>
          <div className="bg-paper-100/60 rounded-2xl p-5 border border-paper-200/70 text-sm text-ink-500 leading-relaxed space-y-1.5">
            <div className="flex justify-between">
              <span className="text-ink-300">应用名称</span>
              <span className="text-ink-700 font-medium">Smart Notepad</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-300">版本</span>
              <span className="text-ink-700 font-medium">0.1.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-300">存储引擎</span>
              <span className="text-ink-700 font-medium">本地 SQLite</span>
            </div>
            <div className="pt-2 mt-1 text-xs text-ink-300">
              本地化超级记事本 · React + Electron · 内容离线安全存储
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={handleBack}
            className="px-5 py-2.5 rounded-xl text-ink-500 hover:text-ink-900 hover:bg-paper-200 transition-all duration-150 hover:scale-[1.02] text-sm font-medium"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={[
              'px-6 py-2.5 rounded-xl text-sm font-semibold shadow-card',
              'transition-all duration-150',
              isDirty && !saving
                ? 'text-white bg-sage-600 hover:bg-sage-700 hover:scale-[1.02] active:scale-[0.99] cursor-pointer'
                : 'text-ink-300 bg-paper-200 cursor-not-allowed'
            ].join(' ')}
          >
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
}
