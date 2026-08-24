import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useChatStore, type SessionState, flushChatPersistenceForNote } from '../stores/useChatStore';
import { useNoteStore } from '../stores/useNoteStore';
import { useUiStore } from '../stores/useUiStore';
import type { ChatMessage } from '@shared/types';

interface SessionInfo {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

interface UseChatReturn {
  currentSession: { id: string | null; title: string };
  sessionsForCurrentNote: SessionInfo[];
  switchToSession: (sessionId: string) => void;
  newSession: () => void;

  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  streamingId: string | null;
  sendMessage: (prompt: string, systemPrompt?: string) => Promise<void>;
  stopStreaming: () => void;
  clear: () => void;
}

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 类型守卫：识别 fetch 主动 abort 抛出的 AbortError。 */
function isAbortError(e: unknown): e is Error {
  return e instanceof Error && e.name === 'AbortError';
}

/** Read-only version of resolveCurrentContext — NEVER mutates store. */
function peekCurrentContext(): { noteId: string } {
  let noteId: string;
  try {
    noteId = (useNoteStore.getState().currentId as string | null | undefined) ?? '__home__';
  } catch {
    noteId = '__home__';
  }
  return { noteId };
}

/**
 * Returns (noteId, sessionId) for the currently-open note, creating a brand
 * new session bucket/session ONLY IF the note currently has none. This is
 * safe to call from event handlers / effects / actions (i.e. not render).
 */
function acquireCurrentContext(): { noteId: string; sessionId: string } {
  const { noteId } = peekCurrentContext();
  const st = useChatStore.getState();
  const sessions = st.notes[noteId] ?? [];
  if (sessions.length === 0) {
    const created = st.newSessionForNote(noteId);
    return { noteId, sessionId: created.id };
  }
  const active = st.activeSessionId[noteId] ?? sessions[sessions.length - 1].id;
  return { noteId, sessionId: active };
}

function pickActiveSession(
  bucket: SessionState[] | undefined,
  activeId: string | null | undefined
): SessionState | null {
  if (!bucket || bucket.length === 0) return null;
  const target = activeId ?? bucket[bucket.length - 1].id;
  return bucket.find((s) => s.id === target) ?? bucket[bucket.length - 1] ?? null;
}

export function useChat(): UseChatReturn {
  const baseUrl = useSettingsStore((s) => s.baseUrl);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const model = useSettingsStore((s) => s.model);
  const currentNoteId = useNoteStore((s) => s.currentId);
  const reasoningEnabled = useUiStore((s) => s.reasoningEnabled);
  const previousNoteIdRef = useRef<string | null | undefined>(undefined);
  const loadedRef = useRef<Record<string, true>>({});

  // When the user switches notes, first flush any pending DB writes for the
  // *previous* note so in-flight tokens are persisted before we move context.
  useEffect(() => {
    const effectiveCurrentId = currentNoteId ?? '__home__';
    if (
      previousNoteIdRef.current !== undefined &&
      previousNoteIdRef.current !== effectiveCurrentId
    ) {
      flushChatPersistenceForNote(previousNoteIdRef.current ?? '__home__');
    }
    previousNoteIdRef.current = currentNoteId ?? '__home__';
  }, [currentNoteId]);

  // Hydrate chat sessions for the current note from SQLite on first visit.
  // The `loadedNotes` flag on useChatStore keeps this idempotent across
  // re-mounts of AiPanel / currentNoteId changes, preventing overwriting
  // user's in-memory work with stale DB rows.
  useEffect(() => {
    const noteId = currentNoteId ?? '__home__';
    if (loadedRef.current[noteId]) return;
    if (useChatStore.getState().loadedNotes[noteId]) {
      loadedRef.current[noteId] = true;
      return;
    }
    // window.api 已由 preload 注入并由 shared/types.ts 全局声明类型
    const listSessions = window.api?.['chat.listSessions'];
    if (!listSessions) return;
    let cancelled = false;
    void (async () => {
      try {
        const { sessions, activeSessionId } = await listSessions(noteId);
        if (cancelled) return;
        // Hydrate even if empty (treats empty as "加载过了，只是之前没聊过")
        useChatStore.getState().hydrateSessionsForNote(
          noteId,
          sessions ?? [],
          activeSessionId ?? null
        );
        loadedRef.current[noteId] = true;
        // After hydrate, if bucket is still empty we create a single blank
        // session so the UI consistently shows "新对话" ready to send.
        const st = useChatStore.getState();
        if ((st.notes[noteId] ?? []).length === 0) {
          st.newSessionForNote(noteId);
        }
      } catch (e) {
        // Hydration failure isn't fatal — default (in-memory empty bucket)
        // still works; user just won't see prior history during this run.
        console.warn('[useChat] failed to hydrate chat history for', noteId, e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNoteId]);

  // App unload / window close: best-effort synchronous flush of whatever note
  // was currently active so the last token streamed before quit isn't lost.
  useEffect(() => {
    const onBeforeUnload = () => {
      flushChatPersistenceForNote(currentNoteId ?? '__home__');
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [currentNoteId]);

  // ---- Selectors: PURE READS, never call any setter inside them. ----
  const messages = useChatStore((s) => {
    const { noteId } = peekCurrentContext();
    const bucket = s.notes[noteId];
    const active = s.activeSessionId[noteId];
    return pickActiveSession(bucket, active)?.messages ?? [];
  });

  const loading = useChatStore((s) => {
    const { noteId } = peekCurrentContext();
    const bucket = s.notes[noteId];
    const active = s.activeSessionId[noteId];
    return pickActiveSession(bucket, active)?.loading ?? false;
  });

  const streamingId = useChatStore((s) => {
    const { noteId } = peekCurrentContext();
    const bucket = s.notes[noteId];
    const active = s.activeSessionId[noteId];
    return pickActiveSession(bucket, active)?.streamingId ?? null;
  });

  const error = useChatStore((s) => {
    const { noteId } = peekCurrentContext();
    const bucket = s.notes[noteId];
    const active = s.activeSessionId[noteId];
    return pickActiveSession(bucket, active)?.error ?? null;
  });

  const currentSession = useChatStore((s) => {
    const { noteId } = peekCurrentContext();
    const bucket = s.notes[noteId];
    const active = s.activeSessionId[noteId];
    const sess = pickActiveSession(bucket, active);
    return { id: sess?.id ?? null, title: sess?.title ?? '新对话' };
  });

  const sessionsForCurrentNote = useChatStore((s) => {
    const { noteId } = peekCurrentContext();
    const bucket = s.notes[noteId] ?? [];
    return [...bucket]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((se) => ({
        id: se.id,
        title: se.title,
        updatedAt: se.updatedAt,
        messageCount: se.messages.filter((m) => m.content.trim()).length
      }));
  });

  const switchToSession = useCallback((sessionId: string) => {
    const { noteId } = peekCurrentContext();
    useChatStore.getState().switchSession(noteId, sessionId);
  }, []);

  const newSession = useCallback(() => {
    const { noteId } = peekCurrentContext();
    useChatStore.getState().newSessionForNote(noteId);
  }, []);

  const stopStreaming = useCallback(() => {
    const { noteId, sessionId } = acquireCurrentContext();
    // __chatAbort 类型已在 shared/types.ts 通过 declare global 声明
    if (window.__chatAbort) {
      window.__chatAbort.abort();
      window.__chatAbort = null;
    }
    useChatStore.getState().setLoading(noteId, sessionId, false);
    useChatStore.getState().setStreamingId(noteId, sessionId, null);
  }, []);

  const clear = useCallback(() => {
    stopStreaming();
    newSession();
  }, [stopStreaming, newSession]);

  const sendMessage = useCallback(
    async (prompt: string, systemPrompt?: string) => {
      if (!prompt.trim()) return;

      const { noteId, sessionId } = acquireCurrentContext();
      const store = useChatStore.getState();
      const bucket = store.notes[noteId] ?? [];
      const sess = bucket.find((se) => se.id === sessionId);
      if (sess?.loading) return;

      store.setError(noteId, sessionId, null);

      if (!baseUrl) {
        store.setError(noteId, sessionId, '请先在设置中配置大模型 API Base URL');
        return;
      }

      // 使用 Ollama 原生 /api/chat 接口，而非 OpenAI 兼容接口 /v1/chat/completions。
      // 原因：Ollama 的 OpenAI 兼容接口不支持 think 参数，reasoning_effort 也不可靠。
      // 原生接口直接支持 think: true/false，能可靠控制 qwen3 系列的思考行为。
      // 参考：https://docs.ollama.com/capabilities/thinking
      const ollamaBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
      const endpoint = `${ollamaBase}/api/chat`;

      const userMsg: ChatMessage = {
        id: genId(),
        role: 'user',
        content: prompt
      };
      const assistantId = genId();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: ''
      };

      store.appendMessage(noteId, sessionId, userMsg);
      store.appendMessage(noteId, sessionId, assistantMsg);
      store.setLoading(noteId, sessionId, true);
      store.setStreamingId(noteId, sessionId, assistantId);

      const currentSess = (useChatStore.getState().notes[noteId] ?? []).find(
        (se) => se.id === sessionId
      );
      const sessionMessages = currentSess?.messages ?? [];

      const bodyMessages: Array<{ role: string; content: string }> = [];
      if (systemPrompt?.trim()) {
        bodyMessages.push({ role: 'system', content: systemPrompt.trim() });
      }
      const history = sessionMessages.filter(
        (m) => m.content.trim() && m.id !== assistantId
      );
      // 只取最近 8 条消息，减少 prompt processing 延迟
      const recent = history.slice(-8);
      recent.forEach((m) => {
        if (m.role === 'user' || m.role === 'assistant') {
          bodyMessages.push({ role: m.role, content: m.content });
        }
      });

      const body: Record<string, unknown> = {
        model,
        messages: bodyMessages,
        stream: true,
        // keep_alive 保持模型驻留显存，避免每次请求重新加载
        keep_alive: '30m'
      };
      // 思考过程开关（Ollama 原生接口）：
      //   开 → think: true，模型输出思考过程
      //   关 → think: false，跳过思考直接输出答案
      body.think = reasoningEnabled;

      const controller = new AbortController();
      window.__chatAbort = controller;

      try {
        // Ollama 原生接口只需 Content-Type，不需要 Accept 和 Authorization
        // 去掉多余 header 避免触发 CORS 预检和无关开销
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };

        const t0 = performance.now();
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });

        console.log(`[chat] fetch response: ${Math.round(performance.now() - t0)}ms, status=${response.status}`);

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          const truncated = errText.slice(0, 500) || `HTTP ${response.status}`;
          throw new Error(truncated);
        }

        const contentType = response.headers.get('content-type') || '';
        // Ollama 原生流式返回 application/x-ndjson 或 application/json
        // response.body 在流式响应中始终存在
        const isStream = !!response.body;

        if (!isStream || !response.body) {
          // Ollama 原生接口非流式响应：{ message: { content, thinking } }
          const data = await response.json();
          const msg = data?.message;
          const content = msg?.content ?? '';
          const reasoning = msg?.thinking ?? '';
          useChatStore.getState().updateMessage(noteId, sessionId, assistantId, {
            content,
            ...(reasoning ? { reasoning } : {})
          });
        } else {
          // Ollama 原生接口流式响应：NDJSON（每行一个 JSON 对象）
          // 格式：{"message":{"role":"assistant","content":"token","thinking":"reasoning"},"done":false}
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let accumulated = '';
          let accumulatedReasoning = '';
          let firstTokenLogged = false;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!firstTokenLogged) {
                console.log(`[chat] first chunk: ${Math.round(performance.now() - t0)}ms`);
                firstTokenLogged = true;
              }
              buffer += decoder.decode(value as Uint8Array, { stream: true });
              // Ollama 原生接口用换行符分隔每条 JSON（NDJSON），不是 SSE 的 \n\n
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed);
                  if (parsed.done) continue;
                  const msg = parsed?.message;
                  if (!msg) continue;
                  // thinking 字段包含思考过程
                  const reasoningDelta = msg.thinking;
                  if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
                    accumulatedReasoning += reasoningDelta;
                    useChatStore.getState().updateMessage(noteId, sessionId, assistantId, {
                      reasoning: accumulatedReasoning
                    });
                  }
                  // content 字段包含正式回答
                  const contentDelta = msg.content;
                  if (typeof contentDelta === 'string' && contentDelta.length > 0) {
                    accumulated += contentDelta;
                    useChatStore.getState().updateMessage(noteId, sessionId, assistantId, {
                      content: accumulated
                    });
                  }
                } catch {
                  // ignore parse errors for individual lines
                }
              }
            }
          } finally {
            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
          }
        }
      } catch (e: unknown) {
        if (isAbortError(e)) {
          // user cancelled — keep whatever content was streamed so far
        } else {
          const raw = e instanceof Error && e.message ? String(e.message) : '请求失败';
          const msg = raw.replace(apiKey ?? '', '***');
          useChatStore.getState().setError(noteId, sessionId, msg);
        }
      } finally {
        if (window.__chatAbort === controller) window.__chatAbort = null;
        useChatStore.getState().setLoading(noteId, sessionId, false);
        useChatStore.getState().setStreamingId(noteId, sessionId, null);
      }
    },
    [baseUrl, apiKey, model, reasoningEnabled]
  );

  return useMemo(
    () => ({
      currentSession,
      sessionsForCurrentNote,
      switchToSession,
      newSession,
      messages,
      loading,
      error,
      streamingId,
      sendMessage,
      stopStreaming,
      clear
    }),
    [
      currentSession,
      sessionsForCurrentNote,
      switchToSession,
      newSession,
      messages,
      loading,
      error,
      streamingId,
      sendMessage,
      stopStreaming,
      clear
    ]
  );
}

export default useChat;
