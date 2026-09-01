import { useState, useCallback } from 'react';

export interface TranscribeOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 语言提示（如 zh、en），留空则自动检测 */
  language?: string;
}

export interface UseTranscriptionReturn {
  isTranscribing: boolean;
  error: string | null;
  /** 将音频 Blob 发送至 OpenAI 兼容的 /audio/transcriptions 端点，返回转写文本 */
  transcribe: (audioBlob: Blob, options: TranscribeOptions) => Promise<string>;
  reset: () => void;
}

/** 去掉 Base URL 尾部多余的斜杠，确保拼接路径一致 */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 语音转写 hook —— 调用 OpenAI 兼容的 `/audio/transcriptions` 端点。
 *
 * 兼容服务：
 * - OpenAI Whisper API（https://api.openai.com/v1）
 * - Groq（https://api.groq.com/openai/v1）
 * - 本地 whisper.cpp / faster-whisper-server 等
 *
 * 请求格式：multipart/form-data（file + model + language + response_format）
 * 响应解析：优先按 JSON 解析取 `text` 字段，失败则当作纯文本返回
 */
export function useTranscription(): UseTranscriptionReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(
    async (audioBlob: Blob, options: TranscribeOptions): Promise<string> => {
      const { baseUrl, apiKey, model, language } = options;
      const normalized = normalizeBaseUrl(baseUrl);

      if (!normalized) {
        const msg = '转写服务 Base URL 未配置';
        setError(msg);
        throw new Error(msg);
      }

      setIsTranscribing(true);
      setError(null);

      try {
        const formData = new FormData();

        // 根据 MIME 类型选择文件扩展名（whisper.cpp 原生支持 wav）
        const ext = audioBlob.type.includes('wav')
          ? 'wav'
          : audioBlob.type.includes('webm')
            ? 'webm'
            : audioBlob.type.includes('mp4')
              ? 'mp4'
              : 'wav';
        formData.append('file', audioBlob, `recording.${ext}`);
        formData.append('model', model || 'whisper-1');
        if (language && language.trim()) {
          formData.append('language', language.trim());
        }
        formData.append('response_format', 'json');

        const url = `${normalized}/audio/transcriptions`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          },
          body: formData,
          signal: AbortSignal.timeout(300_000) // 5 分钟超时，应对长录音
        });

        if (!response.ok) {
          let detail = '';
          try {
            const errBody = await response.json();
            detail = errBody?.error?.message || JSON.stringify(errBody);
          } catch {
            detail = await response.text();
          }
          throw new Error(
            `转写请求失败（HTTP ${response.status}）：${detail.slice(0, 200)}`
          );
        }

        // 兼容 JSON 与纯文本响应
        const rawText = await response.text();
        try {
          const json = JSON.parse(rawText);
          if (typeof json.text === 'string') return json.text;
          if (typeof json === 'string') return json;
          return rawText;
        } catch {
          // 非 JSON，当作纯文本
          return rawText.trim();
        }
      } catch (err) {
        let message = '转写失败';
        if (err instanceof Error) {
          if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            message = '转写请求超时（5 分钟），请缩短录音后重试';
          } else {
            message = err.message;
          }
        }
        setError(message);
        throw new Error(message);
      } finally {
        setIsTranscribing(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setError(null);
    setIsTranscribing(false);
  }, []);

  return { isTranscribing, error, transcribe, reset };
}
