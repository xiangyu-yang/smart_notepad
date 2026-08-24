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
  `);

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

  dbInstance = db;
  return db;
}

export function getDb(): Database.Database {
  if (!dbInstance) throw new Error('Database not initialized');
  return dbInstance;
}
