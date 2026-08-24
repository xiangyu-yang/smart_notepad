import { randomUUID } from 'node:crypto';
import type { Note } from '@shared/types';
import { getDb } from '../init';

/**
 * NoteRepository - 仓储模式：封装 notes 表所有访问
 * 所有写入均使用事务，保证一致性
 */
export class NoteRepository {
  static list(): Note[] {
    const db = getDb();
    return db
      .prepare('SELECT id, title, content, created_at, updated_at FROM notes ORDER BY updated_at DESC')
      .all() as Note[];
  }

  static get(id: string): Note | null {
    const db = getDb();
    return (
      (db
        .prepare('SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ?')
        .get(id) as Note | undefined) ?? null
    );
  }

  static searchTitle(keyword: string): Note[] {
    const db = getDb();
    const like = `%${keyword}%`;
    return db
      .prepare('SELECT id, title, content, created_at, updated_at FROM notes WHERE title LIKE ? ORDER BY updated_at DESC')
      .all(like) as Note[];
  }

  static create(input: { title: string; content: string }): Note {
    const db = getDb();
    const id = randomUUID();
    const now = Date.now();
    const note: Note = { id, title: input.title ?? '', content: input.content ?? '', created_at: now, updated_at: now };
    const insertTx = db.transaction(() => {
      db.prepare(
        'INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (@id, @title, @content, @created_at, @updated_at)'
      ).run(note);
    });
    insertTx();
    return note;
  }

  static update(id: string, patch: Partial<Pick<Note, 'title' | 'content'>>): Note | null {
    const current = this.get(id);
    if (!current) return null;
    const db = getDb();
    const next: Note = { ...current, ...patch, updated_at: Date.now() };
    const tx = db.transaction(() => {
      db.prepare(
        'UPDATE notes SET title = @title, content = @content, updated_at = @updated_at WHERE id = @id'
      ).run({ id: next.id, title: next.title, content: next.content, updated_at: next.updated_at });
    });
    tx();
    return next;
  }

  /**
   * 创建或更新：若有 id 则 update，否则 create；返回最终 Note
   */
  static upsert(input: Partial<Note> & { id?: string }): Note {
    if (input.id) {
      const exists = this.get(input.id);
      if (exists) {
        const updated = this.update(input.id, { title: input.title ?? exists.title, content: input.content ?? exists.content });
        if (updated) return updated;
      }
    }
    return this.create({ title: input.title ?? '未命名记事', content: input.content ?? '' });
  }

  static remove(id: string): boolean {
    const db = getDb();
    let changed = 0;
    const tx = db.transaction(() => {
      const info = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
      changed = info.changes;
    });
    tx();
    return changed > 0;
  }
}
