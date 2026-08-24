import { create } from 'zustand';
import type { ChatMessage, ChatSession } from '@shared/types';

export interface SessionState {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  loading: boolean;
  streamingId: string | null;
  error: string | null;
}

interface ChatState {
  /**
   * Chat sessions are isolated per note — this is the primary index.
   * The key is either a note id (when the user is on /note/:id) or the
   * sentinel "__home__" for the home screen.
   *
   * Under each note, there can be multiple sessions (turns of 🔄 新对话).
   * Sessions are kept in-order; only the "latest" is active.  Historical
   * sessions are browseable through the session list so users never lose
   * prior conversations on the same note — which fixes the bug where
   * clicking 🔄 新对话 would make earlier messages unrecoverable.
   */
  notes: Record<string, SessionState[]>;
  activeSessionId: Record<string, string | null>; // per-note active session id
  loadedNotes: Record<string, boolean>; // have we already hydrated from SQLite?

  switchSession: (noteId: string, sessionId: string) => void;

  /** Appends a new blank session for the given note and activates it. */
  newSessionForNote: (noteId: string) => SessionState;

  /** Hydrate sessions for a note from the DB (idempotent, skips reloads when already loaded). */
  hydrateSessionsForNote: (
    noteId: string,
    sessions: ChatSession[],
    activeSessionId: string | null
  ) => void;

  appendMessage: (noteId: string, sessionId: string, msg: ChatMessage) => void;
  updateMessage: (noteId: string, sessionId: string, id: string, patch: Partial<ChatMessage>) => void;
  setLoading: (noteId: string, sessionId: string, v: boolean) => void;
  setStreamingId: (noteId: string, sessionId: string, id: string | null) => void;
  setError: (noteId: string, sessionId: string, e: string | null) => void;
}

function makeEmptySession(titleHint?: string): SessionState {
  const now = Date.now();
  return {
    id: `sess_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title: titleHint ?? '新对话',
    createdAt: now,
    updatedAt: now,
    messages: [],
    loading: false,
    streamingId: null,
    error: null
  };
}

function getNoteBucket(s: Pick<ChatState, 'notes'>, noteId: string): SessionState[] {
  return s.notes[noteId] ?? [];
}

/**
 * 把当前 note 下的 sessions 快照写入 SQLite。
 * - 使用 debounce 合并高频写入（例如流式 token 时每个 updateMessage 都触发）；
 * - debounce 窗口内后续调用会刷新时间，确保最后一次写入是最新快照。
 * - __home__（无 note 的首页会话）也持久化，确保首页重启聊天也能找回。
 */
const scheduledNoteIds = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DEBOUNCE_MS = 350;

/**
 * 构造一次 IPC 持久化所需的 ChatSession[] 负载。
 * schedulePersistForNote 与 flushChatPersistenceForNote 共用此函数，避免两份逐字重复的映射代码。
 */
function buildPersistPayload(noteId: string, state: ChatState): ChatSession[] {
  const sessions = state.notes[noteId] ?? [];
  return sessions.map((se) => ({
    id: se.id,
    note_id: noteId,
    title: se.title,
    created_at: se.createdAt,
    updated_at: se.updatedAt,
    messages: se.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning
    }))
  }));
}

/** 触发一次持久化写入（已通过 IPC 桥接到主进程的 ChatRepository.replaceAllForNote）。 */
function persistNoteSnapshot(noteId: string): void {
  try {
    const state = useChatStore.getState();
    const active = state.activeSessionId[noteId] ?? null;
    const payload = buildPersistPayload(noteId, state);
    // window.api 已由 preload 通过 contextBridge 注入并由 shared/types.ts 全局声明类型
    void window.api?.['chat.replaceAllForNote'](noteId, payload, active);
  } catch (e) {
    console.warn('[useChatStore] persist failed:', e);
  }
}

function schedulePersistForNote(noteId: string): void {
  const existing = scheduledNoteIds.get(noteId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    scheduledNoteIds.delete(noteId);
    persistNoteSnapshot(noteId);
  }, SAVE_DEBOUNCE_MS);
  scheduledNoteIds.set(noteId, timer);
}

export function flushChatPersistenceForNote(noteId: string): void {
  const t = scheduledNoteIds.get(noteId);
  if (!t) return;
  clearTimeout(t);
  scheduledNoteIds.delete(noteId);
  persistNoteSnapshot(noteId);
}

export const useChatStore = create<ChatState>((set) => ({
  notes: {},
  activeSessionId: {},
  loadedNotes: {},

  hydrateSessionsForNote: (noteId, sessions, activeSessionId) =>
    set((s) => {
      // 转换：DB ChatSession[] → 内存 SessionState[]
      const bucket: SessionState[] = sessions.map((se) => ({
        id: se.id,
        title: se.title,
        createdAt: se.created_at,
        updatedAt: se.updated_at,
        messages: se.messages ?? [],
        loading: false,
        streamingId: null,
        error: null
      }));
      // 没指定 active 就选最后一个（最近更新）
      const active = activeSessionId && bucket.some((b) => b.id === activeSessionId)
        ? activeSessionId
        : bucket.length > 0
          ? bucket[bucket.length - 1].id
          : null;
      return {
        notes: { ...s.notes, [noteId]: bucket },
        activeSessionId: { ...s.activeSessionId, [noteId]: active },
        loadedNotes: { ...s.loadedNotes, [noteId]: true }
      };
    }),

  switchSession: (noteId, sessionId) => {
    set((s) => ({
      activeSessionId: { ...s.activeSessionId, [noteId]: sessionId }
    }));
    schedulePersistForNote(noteId);
  },

  newSessionForNote: (noteId) => {
    const fresh = makeEmptySession();
    set((s) => {
      const existing = s.notes[noteId] ?? [];
      return {
        notes: { ...s.notes, [noteId]: [...existing, fresh] },
        activeSessionId: { ...s.activeSessionId, [noteId]: fresh.id }
      };
    });
    schedulePersistForNote(noteId);
    return fresh;
  },

  appendMessage: (noteId, sessionId, msg) => {
    set((s) => {
      let bucket = getNoteBucket(s, noteId);
      if (bucket.length === 0) {
        bucket = [makeEmptySession()];
      }
      let targetId = sessionId;
      if (!bucket.some((se) => se.id === targetId)) {
        targetId = bucket[bucket.length - 1].id;
      }
      return {
        notes: {
          ...s.notes,
          [noteId]: bucket.map((se) =>
            se.id === targetId
              ? {
                  ...se,
                  messages: [...se.messages, msg],
                  updatedAt: Date.now(),
                  title:
                    se.title === '新对话' && msg.role === 'user'
                      ? msg.content.slice(0, 18) || se.title
                      : se.title
                }
              : se
          )
        },
        activeSessionId: { ...s.activeSessionId, [noteId]: targetId }
      };
    });
    schedulePersistForNote(noteId);
  },

  updateMessage: (noteId, sessionId, id, patch) => {
    set((s) => {
      const bucket = getNoteBucket(s, noteId);
      return {
        notes: {
          ...s.notes,
          [noteId]: bucket.map((se) =>
            se.id === sessionId
              ? {
                  ...se,
                  messages: se.messages.map((m) =>
                    m.id === id ? { ...m, ...patch } : m
                  ),
                  updatedAt: Date.now()
                }
              : se
          )
        }
      };
    });
    schedulePersistForNote(noteId);
  },

  setLoading: (noteId, sessionId, v) =>
    set((s) => {
      const bucket = getNoteBucket(s, noteId);
      return {
        notes: {
          ...s.notes,
          [noteId]: bucket.map((se) =>
            se.id === sessionId ? { ...se, loading: v } : se
          )
        }
      };
    }),

  setStreamingId: (noteId, sessionId, id) =>
    set((s) => {
      const bucket = getNoteBucket(s, noteId);
      return {
        notes: {
          ...s.notes,
          [noteId]: bucket.map((se) =>
            se.id === sessionId ? { ...se, streamingId: id } : se
          )
        }
      };
    }),

  setError: (noteId, sessionId, e) =>
    set((s) => {
      const bucket = getNoteBucket(s, noteId);
      return {
        notes: {
          ...s.notes,
          [noteId]: bucket.map((se) =>
            se.id === sessionId ? { ...se, error: e } : se
          )
        }
      };
    })
}));

export default useChatStore;
