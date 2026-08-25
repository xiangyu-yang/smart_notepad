export const IPC_CHANNELS = {
  NOTES_LIST: 'notes.list',
  NOTES_GET: 'notes.get',
  NOTES_SAVE: 'notes.save',
  NOTES_DELETE: 'notes.delete',
  SETTINGS_GET: 'settings.get',
  SETTINGS_SET: 'settings.set',
  WIN_MIN_MAIN: 'window.minimizeMain',
  WIN_MAX_MAIN: 'window.maximizeMain',
  WIN_CLOSE_MAIN: 'window.closeMain',
  WIN_CLOSE_BEFORE_CHECK: 'window.closeBeforeCheck',
  WIN_RESPOND_CLOSE_BEFORE: 'window.respondCloseBefore',
  WIN_ALLOW_CLOSE: 'window.allowClose',
  // renderer -> renderer via main (event broadcast)
  NOTE_UPDATED: 'note:updated',
  REQUEST_DIRTY_STATE: 'window.requestDirtyState',
  // Ollama service management
  OLLAMA_START: 'ollama.start',
  OLLAMA_STATUS: 'ollama.status',
  // Chat persistence
  CHAT_LIST_SESSIONS: 'chat.listSessions',
  CHAT_UPSERT_SESSION: 'chat.upsertSession',
  CHAT_DELETE_SESSION: 'chat.deleteSession',
  CHAT_REPLACE_ALL_FOR_NOTE: 'chat.replaceAllForNote',
  // Folders (filesystem-style note management)
  FOLDERS_LIST: 'folders.list',
  FOLDERS_CREATE: 'folders.create',
  FOLDERS_RENAME: 'folders.rename',
  FOLDERS_DELETE: 'folders.delete',
  // 移动文件夹到新父级（newParentId=null 表示移到根级）
  FOLDERS_MOVE: 'folders.move',
  // Move a note into a folder (folder_id null = root)
  NOTES_MOVE: 'notes.move',
  // Export current note to PDF
  NOTES_EXPORT_PDF: 'notes.exportPdf',
  // Attachments
  ATTACHMENTS_LIST: 'attachments.list',
  ATTACHMENTS_UPLOAD: 'attachments.upload',
  ATTACHMENTS_GET: 'attachments.get',
  ATTACHMENTS_DOWNLOAD: 'attachments.download',
  ATTACHMENTS_DELETE: 'attachments.delete'
} as const;

export const DB_FILE = 'smart_notepad.db';
