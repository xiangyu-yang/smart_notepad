/**
 * Preload - 安全桥
 * 使用 contextBridge 暴露最小必要 API，关闭 nodeIntegration / contextIsolation=true
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type {
  IpcApi,
  Note,
  Folder,
  Attachment,
  SettingsKey,
  SettingsMap,
  WindowApi,
  WindowEvents,
  WindowEventName,
  CloseAction,
  ChatSession
} from '@shared/types';

const invoke = <T = unknown>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const ipcApi: IpcApi = {
  'notes.list': () => invoke(IPC_CHANNELS.NOTES_LIST),
  'notes.get': (id) => invoke(IPC_CHANNELS.NOTES_GET, id),
  'notes.save': (note) => invoke(IPC_CHANNELS.NOTES_SAVE, note),
  'notes.delete': (id) => invoke(IPC_CHANNELS.NOTES_DELETE, id),
  'notes.move': (noteId, folderId) =>
    invoke<Note | null>(IPC_CHANNELS.NOTES_MOVE, noteId, folderId),
  [IPC_CHANNELS.NOTES_EXPORT_PDF]: (payload) =>
    invoke<{ success: boolean; canceled: boolean; path?: string; error?: string }>(
      IPC_CHANNELS.NOTES_EXPORT_PDF,
      payload
    ),
  'folders.list': () => invoke<Folder[]>(IPC_CHANNELS.FOLDERS_LIST),
  'folders.create': (input) => invoke<Folder>(IPC_CHANNELS.FOLDERS_CREATE, input),
  'folders.rename': (id, name) =>
    invoke<Folder | null>(IPC_CHANNELS.FOLDERS_RENAME, id, name),
  'folders.delete': (id) =>
    invoke<{ deletedNoteCount: number }>(IPC_CHANNELS.FOLDERS_DELETE, id),
  'folders.move': (id, newParentId) =>
    invoke<Folder | null>(IPC_CHANNELS.FOLDERS_MOVE, id, newParentId),
  'attachments.list': (noteId) => invoke<Attachment[]>(IPC_CHANNELS.ATTACHMENTS_LIST, noteId),
  'attachments.upload': (input) => invoke<Attachment>(IPC_CHANNELS.ATTACHMENTS_UPLOAD, input),
  'attachments.get': (id) =>
    invoke<{ attachment: Attachment; base64: string }>(IPC_CHANNELS.ATTACHMENTS_GET, id),
  'attachments.download': (id) =>
    invoke<{ success: boolean; canceled: boolean; path?: string; error?: string }>(
      IPC_CHANNELS.ATTACHMENTS_DOWNLOAD,
      id
    ),
  'attachments.delete': (id) => invoke<boolean>(IPC_CHANNELS.ATTACHMENTS_DELETE, id),
  'settings.get': <K extends SettingsKey>(key: K) =>
    invoke<SettingsMap[K] | undefined>(IPC_CHANNELS.SETTINGS_GET, key),
  'settings.set': <K extends SettingsKey>(key: K, value: SettingsMap[K]) =>
    invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  'window.minimizeMain': () => invoke(IPC_CHANNELS.WIN_MIN_MAIN),
  'window.maximizeMain': () => invoke(IPC_CHANNELS.WIN_MAX_MAIN),
  'window.closeMain': () => invoke(IPC_CHANNELS.WIN_CLOSE_MAIN),
  'window.closeBeforeCheck': () => invoke<CloseAction>(IPC_CHANNELS.WIN_CLOSE_BEFORE_CHECK),
  'window.respondCloseBefore': (action: CloseAction) =>
    invoke<void>(IPC_CHANNELS.WIN_RESPOND_CLOSE_BEFORE, action),
  'window.allowClose': () => invoke<void>(IPC_CHANNELS.WIN_ALLOW_CLOSE),
  'ollama.start': () => invoke<{ success: boolean; message: string }>(IPC_CHANNELS.OLLAMA_START),
  'ollama.status': () => invoke<{ running: boolean; message: string }>(IPC_CHANNELS.OLLAMA_STATUS),
  'chat.listSessions': (noteId) =>
    invoke<{ sessions: ChatSession[]; activeSessionId: string | null }>(
      IPC_CHANNELS.CHAT_LIST_SESSIONS,
      noteId
    ),
  'chat.upsertSession': (session) => invoke<ChatSession>(IPC_CHANNELS.CHAT_UPSERT_SESSION, session),
  'chat.deleteSession': (id) => invoke<boolean>(IPC_CHANNELS.CHAT_DELETE_SESSION, id),
  'chat.replaceAllForNote': (noteId, sessions, activeSessionId) =>
    invoke<void>(IPC_CHANNELS.CHAT_REPLACE_ALL_FOR_NOTE, noteId, sessions, activeSessionId)
};

const windowApi: WindowApi = {
  dragRegion: {
    start: () => {
      /* noop */
    }
  },
  onNoteUpdated: (handler: (note: Note) => void) => {
    const listener = (_e: unknown, note: Note) => handler(note);
    ipcRenderer.on(IPC_CHANNELS.NOTE_UPDATED, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.NOTE_UPDATED, listener);
  }
};

const events: WindowEvents = {
  on: (event: WindowEventName, handler: () => void) => {
    let channel: string;
    switch (event) {
      case 'requestDirtyState':
        channel = IPC_CHANNELS.REQUEST_DIRTY_STATE;
        break;
      default:
        channel = event;
    }
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  off: (event: WindowEventName, handler: () => void) => {
    let channel: string;
    switch (event) {
      case 'requestDirtyState':
        channel = IPC_CHANNELS.REQUEST_DIRTY_STATE;
        break;
      default:
        channel = event;
    }
    ipcRenderer.off(channel, handler);
  }
};

contextBridge.exposeInMainWorld('api', ipcApi);
contextBridge.exposeInMainWorld('windowApi', windowApi);
contextBridge.exposeInMainWorld('events', events);

export type {};
