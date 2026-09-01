import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { DB_FILE } from '@shared/constants';

let dbInstance: Database.Database | null = null;

export function initializeDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const isDev = process.env.NODE_ENV === 'development';
  // dev 模式：数据库存放在项目根目录（避免沙箱限制）；生产模式：userData 目录
  // __dirname = dist-electron/main，项目根 = ../..
  const dbDir = isDev
    ? path.join(__dirname, '../..')
    : app.getPath('userData');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, DB_FILE);

  // eslint-disable-next-line no-console
  console.log('[db] NODE_ENV:', process.env.NODE_ENV, '| isDev:', isDev, '| dbPath:', dbPath);

  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (e) {
    // 兜底：项目根目录的 .data 子目录
    const fallbackDir = path.join(__dirname, '../../.data');
    if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
    const fallbackPath = path.join(fallbackDir, DB_FILE);
    // eslint-disable-next-line no-console
    console.warn('[db] primary path failed, fallback to:', fallbackPath, '| error:', (e as Error).message);
    db = new Database(fallbackPath);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_note_id ON chat_sessions(note_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_note_updated ON chat_sessions(note_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL DEFAULT '',
      reasoning TEXT,
      ordering INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, ordering ASC);

    CREATE TABLE IF NOT EXISTS chat_active_session (
      note_id TEXT PRIMARY KEY,
      session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      parent_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_folders_updated_at ON folders(updated_at DESC);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      data TEXT,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments(note_id);

    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      transcript TEXT NOT NULL DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 0,
      audio_path TEXT NOT NULL DEFAULT '',
      transcript_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_recordings_note_id ON recordings(note_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);
  `);

  // --- 迁移：recordings 表补 audio_path / transcript_path 列（兼容旧版本）---
  try {
    const recCols = db.prepare("PRAGMA table_info(recordings)").all() as Array<{ name: string }>;
    if (recCols.length > 0) {
      if (!recCols.some((c) => c.name === 'audio_path')) {
        db.exec('ALTER TABLE recordings ADD COLUMN audio_path TEXT NOT NULL DEFAULT ""');
        console.log('[db] migration: add recordings.audio_path column');
      }
      if (!recCols.some((c) => c.name === 'transcript_path')) {
        db.exec('ALTER TABLE recordings ADD COLUMN transcript_path TEXT NOT NULL DEFAULT ""');
        console.log('[db] migration: add recordings.transcript_path column');
      }
    }
  } catch (e) {
    console.warn('[db] migration: add recordings columns failed:', e);
  }

  // --- 迁移：attachments 表补 data 列（文件内容 base64 备份，防止磁盘文件丢失）---
  try {
    const attCols = db.prepare("PRAGMA table_info(attachments)").all() as Array<{ name: string }>;
    if (attCols.length > 0 && !attCols.some((c) => c.name === 'data')) {
      db.exec('ALTER TABLE attachments ADD COLUMN data TEXT');
      console.log('[db] migration: add attachments.data column (file content backup)');
    }
  } catch (e) {
    console.warn('[db] migration: add attachments.data column failed:', e);
  }

  // --- 轻量级 schema 迁移：给已存在的 chat_messages 表补 reasoning 列 ---
  // CREATE TABLE IF NOT EXISTS 不会给已存在的表加新列，所以这里手动 ALTER。
  try {
    const cols = db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.some((c) => c.name === 'reasoning')) {
      db.exec('ALTER TABLE chat_messages ADD COLUMN reasoning TEXT');
    }
  } catch (e) {
    console.warn('[db] migration: add reasoning column failed:', e);
  }

  // --- 迁移：notes 表补 folder_id 列 ---
  // SQLite ALTER ADD COLUMN 不能带 REFERENCES 子句，采用"加列 + 应用层级联"策略：
  // 删除文件夹时由 FolderRepository.remove 在事务内显式删除该文件夹下记事。
  try {
    const noteCols = db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    if (noteCols.length > 0 && !noteCols.some((c) => c.name === 'folder_id')) {
      db.exec('ALTER TABLE notes ADD COLUMN folder_id TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON notes(folder_id)');
    }
  } catch (e) {
    console.warn('[db] migration: add notes.folder_id column failed:', e);
  }

  dbInstance = db;
  return db;
}

export function getDb(): Database.Database {
  if (!dbInstance) throw new Error('Database not initialized');
  return dbInstance;
}
