import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/constants';
import type { ChatSession, Folder, Note, SettingsKey, SettingsMap } from '@shared/types';
import { ChatRepository } from './db/repositories/ChatRepository';
import { FolderRepository } from './db/repositories/FolderRepository';
import { NoteRepository } from './db/repositories/NoteRepository';
import { SettingsRepository } from './db/repositories/SettingsRepository';
import { WindowManager } from './window/WindowManager';
import * as OllamaService from './services/OllamaService';

export function registerIpcHandlers(): void {
  // ---------- notes ----------
  ipcMain.handle(IPC_CHANNELS.NOTES_LIST, () => {
    try {
      return NoteRepository.list();
    } catch (e) {
      console.error('[ipc] notes.list error:', e);
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.NOTES_GET, (_e, id: string) => {
    try {
      return NoteRepository.get(id);
    } catch (e) {
      console.error('[ipc] notes.get error:', e);
      return null;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTES_SAVE,
    (_e, payload: Partial<Note> & { id?: string }): Note => {
      try {
        const note = NoteRepository.upsert(payload);
        // 向主窗口广播更新
        WindowManager.shared.broadcastNoteUpdated(note);
        return note;
      } catch (e) {
        console.error('[ipc] notes.save error:', e);
        throw e;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE, (_e, id: string): boolean => {
    try {
      return NoteRepository.remove(id);
    } catch (e) {
      console.error('[ipc] notes.delete error:', e);
      return false;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTES_MOVE,
    (_e, noteId: string, folderId: string | null): Note | null => {
      try {
        const note = NoteRepository.move(noteId, folderId);
        if (note) {
          // 复用现有广播，多窗口天然同步
          WindowManager.shared.broadcastNoteUpdated(note);
        }
        return note;
      } catch (e) {
        console.error('[ipc] notes.move error:', e);
        return null;
      }
    }
  );

  // ---------- folders ----------
  ipcMain.handle(IPC_CHANNELS.FOLDERS_LIST, (): Folder[] => {
    try {
      return FolderRepository.list();
    } catch (e) {
      console.error('[ipc] folders.list error:', e);
      return [];
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_CREATE,
    (_e, input: { name: string; parent_id: string | null }): Folder => {
      try {
        return FolderRepository.create(input);
      } catch (e) {
        console.error('[ipc] folders.create error:', e);
        throw e;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_RENAME,
    (_e, id: string, name: string): Folder | null => {
      try {
        return FolderRepository.rename(id, name);
      } catch (e) {
        console.error('[ipc] folders.rename error:', e);
        return null;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_DELETE,
    (_e, id: string): { deletedNoteCount: number } => {
      try {
        return FolderRepository.remove(id);
      } catch (e) {
        console.error('[ipc] folders.delete error:', e);
        return { deletedNoteCount: 0 };
      }
    }
  );

  // ---------- settings ----------
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_GET,
    <K extends SettingsKey>(_e: unknown, key: K): SettingsMap[K] | undefined =>
      SettingsRepository.get(key)
  );

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, <K extends SettingsKey>(
    _e: unknown,
    key: K,
    value: SettingsMap[K]
  ) => {
    SettingsRepository.set(key, value);
  });

  // ---------- main window controls ----------
  ipcMain.handle(IPC_CHANNELS.WIN_MIN_MAIN, () => {
    const w = WindowManager.shared.getMainWindow();
    if (w) w.minimize();
  });
  ipcMain.handle(IPC_CHANNELS.WIN_MAX_MAIN, (): boolean => {
    const w = WindowManager.shared.getMainWindow();
    if (!w) return false;
    if (w.isMaximized()) {
      w.unmaximize();
      return false;
    }
    w.maximize();
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.WIN_CLOSE_MAIN, () => {
    const w = WindowManager.shared.getMainWindow();
    if (w && !w.isDestroyed()) w.close();
  });

  // 渲染进程对 dirty 询问的回应（三选一）- 旧版 on 兼容
  ipcMain.on(IPC_CHANNELS.WIN_CLOSE_BEFORE_CHECK, (_e, action: 'save' | 'discard' | 'cancel') => {
    WindowManager.shared.resolveCloseBefore(action);
  });

  // 新版：渲染进程通过 invoke 回应 dirty 询问
  ipcMain.handle(IPC_CHANNELS.WIN_RESPOND_CLOSE_BEFORE, (_e, action: 'save' | 'discard' | 'cancel') => {
    WindowManager.shared.resolveCloseBefore(action);
  });

  // 渲染进程执行完保存动作后允许关闭主窗口（invoke 版本）
  ipcMain.handle(IPC_CHANNELS.WIN_ALLOW_CLOSE, () => {
    const w = WindowManager.shared.getMainWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('__main:allowClose');
    }
  });

  // 渲染进程执行完保存动作后允许关闭主窗口（on 版本，兼容旧逻辑）
  ipcMain.on('__main:allowClose', () => {
    /* handled in WindowManager by once('__main:allowClose') */
  });

  // ---------- Ollama service management ----------
  // 业务实现见 services/OllamaService.ts，IPC 层仅做薄路由
  ipcMain.handle(IPC_CHANNELS.OLLAMA_STATUS, () => OllamaService.getStatus());
  ipcMain.handle(IPC_CHANNELS.OLLAMA_START, () => OllamaService.start());

  // ---------- chat persistence ----------
  ipcMain.handle(IPC_CHANNELS.CHAT_LIST_SESSIONS, (_e, noteId: string) => {
    try {
      const sessions = ChatRepository.listSessionsForNote(noteId);
      const activeSessionId = ChatRepository.getActiveSessionId(noteId);
      return { sessions, activeSessionId };
    } catch (e) {
      console.error('[ipc] chat.listSessions error:', e);
      return { sessions: [], activeSessionId: null };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_UPSERT_SESSION, (_e, session: ChatSession) => {
    try {
      return ChatRepository.upsertSession(session);
    } catch (e) {
      console.error('[ipc] chat.upsertSession error:', e);
      throw e;
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_DELETE_SESSION, (_e, id: string) => {
    try {
      return ChatRepository.deleteSession(id);
    } catch (e) {
      console.error('[ipc] chat.deleteSession error:', e);
      return false;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.CHAT_REPLACE_ALL_FOR_NOTE,
    (_e, noteId: string, sessions: ChatSession[], activeSessionId: string | null) => {
      try {
        ChatRepository.replaceAllForNote(noteId, sessions, activeSessionId);
      } catch (e) {
        console.error('[ipc] chat.replaceAllForNote error:', e);
        throw e;
      }
    }
  );
}
