// 共享类型定义 - 主进程与渲染进程通用

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
  /** 所属文件夹 id；null/undefined 表示根目录（向后兼容老数据） */
  folder_id?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  /** 父文件夹 id；null 表示根级 */
  parent_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface SettingsMap {
  'llm.baseUrl'?: string;
  'llm.apiKey'?: string;
  'llm.model'?: string;
}

export type SettingsKey = keyof SettingsMap;

export type CloseAction = 'save' | 'discard' | 'cancel';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 大模型思考过程（reasoning / chain-of-thought），仅 assistant 可能非空 */
  reasoning?: string;
}

export interface ChatSession {
  id: string;
  note_id: string;
  title: string;
  messages: ChatMessage[];
  created_at: number;
  updated_at: number;
}

// IPC 请求/响应类型（保持简单，不做严格 discriminated union）
export interface IpcApi {
  // notes
  'notes.list': () => Promise<Note[]>;
  'notes.get': (id: string) => Promise<Note | null>;
  'notes.save': (note: Partial<Note> & { id?: string }) => Promise<Note>;
  'notes.delete': (id: string) => Promise<boolean>;
  'notes.move': (noteId: string, folderId: string | null) => Promise<Note | null>;
  // folders (filesystem-style note management)
  'folders.list': () => Promise<Folder[]>;
  'folders.create': (input: { name: string; parent_id: string | null }) => Promise<Folder>;
  'folders.rename': (id: string, name: string) => Promise<Folder | null>;
  'folders.delete': (id: string) => Promise<{ deletedNoteCount: number }>;
  // settings
  'settings.get': <K extends SettingsKey>(key: K) => Promise<SettingsMap[K] | undefined>;
  'settings.set': <K extends SettingsKey>(key: K, value: SettingsMap[K]) => Promise<void>;
  // chat sessions / messages (persisted per note across app restarts)
  'chat.listSessions': (noteId: string) => Promise<{ sessions: ChatSession[]; activeSessionId: string | null }>;
  'chat.upsertSession': (session: ChatSession) => Promise<ChatSession>;
  'chat.deleteSession': (id: string) => Promise<boolean>;
  'chat.replaceAllForNote': (noteId: string, sessions: ChatSession[], activeSessionId: string | null) => Promise<void>;
  // window
  'window.minimizeMain': () => Promise<void>;
  'window.maximizeMain': () => Promise<boolean>;
  'window.closeMain': () => Promise<void>;
  'window.closeBeforeCheck': () => Promise<CloseAction>;
  'window.respondCloseBefore': (action: CloseAction) => Promise<void>;
  'window.allowClose': () => Promise<void>;
  // ollama
  'ollama.start': () => Promise<{ success: boolean; message: string }>;
  'ollama.status': () => Promise<{ running: boolean; message: string }>;
}

export interface WindowApi {
  dragRegion: { start: () => void };
  onNoteUpdated: (handler: (note: Note) => void) => () => void;
}

export type WindowEventName = 'requestDirtyState';

export interface WindowEvents {
  on: (event: WindowEventName, handler: () => void) => () => void;
  off: (event: WindowEventName, handler: () => void) => void;
}

declare global {
  interface Window {
    api: IpcApi;
    windowApi: WindowApi;
    events: WindowEvents;
    /**
     * 当前活跃的聊天流 AbortController，挂在 window 上以便
     * useChat 的 sendMessage / stopStreaming 两个回调共享同一引用。
     * 由 preload 之外的渲染进程自行管理。
     */
    __chatAbort?: AbortController | null;
  }
}

export {};
