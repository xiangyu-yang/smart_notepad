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

export interface Attachment {
  id: string;
  note_id: string;
  /** 存储在磁盘上的真实文件名（UUID + 扩展名） */
  file_name: string;
  /** 用户上传时的原始文件名 */
  original_name: string;
  mime_type: string;
  size: number;
  created_at: number;
  updated_at: number;
}

export interface SettingsMap {
  'llm.baseUrl'?: string;
  'llm.apiKey'?: string;
  'llm.model'?: string;
  /** 文件夹展开状态：folderId → 是否展开。用户偏好持久化到 SQLite，重启/清缓存不丢 */
  'ui.folderExpanded'?: Record<string, boolean>;
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
  'notes.exportPdf': (payload: {
    /** PDF 默认文件名（不含扩展名） */
    defaultName: string;
    /** Markdown 渲染后的 HTML 片段（含 GFM 支持，与预览一致），主进程在独立 print 窗口内排版后 printToPDF */
    html: string;
  }) => Promise<{ success: boolean; canceled: boolean; path?: string; error?: string }>;
  // folders (filesystem-style note management)
  'folders.list': () => Promise<Folder[]>;
  'folders.create': (input: { name: string; parent_id: string | null }) => Promise<Folder>;
  'folders.rename': (id: string, name: string) => Promise<Folder | null>;
  'folders.delete': (id: string) => Promise<{ deletedNoteCount: number }>;
  /** 移动文件夹到新父级（newParentId=null 表示移到根级）；后端含循环检测，非法抛错 */
  'folders.move': (id: string, newParentId: string | null) => Promise<Folder | null>;
  // attachments (上传/预览/下载/删除，均以 id 驱动，不暴露真实磁盘路径，避免路径穿越)
  'attachments.list': (noteId: string) => Promise<Attachment[]>;
  'attachments.upload': (input: {
    noteId: string;
    originalName: string;
    mimeType: string;
    /**
     * 优先走文件选择对话框路径；如果没有，再退化为发送 base64 字符串过来（大文件会较慢）。
     * Electron contextBridge 不支持 File 对象直接传输，渲染端只能给我们 base64/ArrayBuffer。
     * 但 preload 层不能直接读绝对路径（沙箱），所以统一在这里用 base64 或 Uint8Array 编码传输。
     */
    base64?: string;
    uint8?: number[];
  }) => Promise<Attachment>;
  /** 预览/下载：返回 base64 + mime，渲染端转 blob 预览或另存 */
  'attachments.get': (id: string) => Promise<{
    attachment: Attachment;
    base64: string;
  }>;
  /** 弹出"另存为"对话框，将附件拷贝到用户选择的目标位置 */
  'attachments.download': (id: string) => Promise<{
    success: boolean;
    canceled: boolean;
    path?: string;
    /** 失败原因（若有），用于 toast 展示给用户 */
    error?: string;
  }>;
  'attachments.delete': (id: string) => Promise<boolean>;
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
