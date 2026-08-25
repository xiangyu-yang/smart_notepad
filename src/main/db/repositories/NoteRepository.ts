import { randomUUID } from 'node:crypto';
import type { Note } from '@shared/types';
import { getDb } from '../init';
import { AttachmentRepository } from './AttachmentRepository';

/**
 * NoteRepository - 仓储模式：封装 notes 表所有访问
 * 所有写入均使用事务，保证一致性
 */
export class NoteRepository {
  static list(): Note[] {
    const db = getDb();
    return db
      .prepare('SELECT id, title, content, created_at, updated_at, folder_id FROM notes ORDER BY updated_at DESC')
      .all() as Note[];
  }

  static get(id: string): Note | null {
    const db = getDb();
    return (
      (db
        .prepare('SELECT id, title, content, created_at, updated_at, folder_id FROM notes WHERE id = ?')
        .get(id) as Note | undefined) ?? null
    );
  }

  static searchTitle(keyword: string): Note[] {
    const db = getDb();
    const like = `%${keyword}%`;
    return db
      .prepare('SELECT id, title, content, created_at, updated_at, folder_id FROM notes WHERE title LIKE ? ORDER BY updated_at DESC')
      .all(like) as Note[];
  }

  static create(input: { title: string; content: string; folder_id?: string | null }): Note {
    const db = getDb();
    const id = randomUUID();
    const now = Date.now();
    const note: Note = {
      id,
      title: input.title ?? '',
      content: input.content ?? '',
      created_at: now,
      updated_at: now,
      folder_id: input.folder_id ?? null
    };
    const insertTx = db.transaction(() => {
      db.prepare(
        'INSERT INTO notes (id, title, content, created_at, updated_at, folder_id) VALUES (@id, @title, @content, @created_at, @updated_at, @folder_id)'
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
   * 创建或更新：若有 id 则 update，否则 create；返回最终 Note。
   * 注意：update 分支仅改 title/content，**不修改 folder_id**（移动走 move 专用 API），
   * 以保证现有编辑器 auto-save / 关闭前保存流程零影响。
   */
  static upsert(input: Partial<Note> & { id?: string }): Note {
    if (input.id) {
      const exists = this.get(input.id);
      if (exists) {
        const updated = this.update(input.id, { title: input.title ?? exists.title, content: input.content ?? exists.content });
        if (updated) return updated;
      }
    }
    return this.create({
      title: input.title ?? '未命名记事',
      content: input.content ?? '',
      folder_id: input.folder_id ?? null
    });
  }

  /**
   * 移动记事到指定文件夹。folder_id 为 null 表示移回根目录。
   * 仅更新 folder_id 与 updated_at，不动 title/content。
   */
  static move(noteId: string, folderId: string | null): Note | null {
    const cur = this.get(noteId);
    if (!cur) return null;
    const db = getDb();
    const now = Date.now();
    const tx = db.transaction(() => {
      // 目标文件夹存在性校验（应用层兜底）
      if (folderId) {
        const p = db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId);
        if (!p) throw new Error('target folder not found');
      }
      db.prepare('UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?').run(
        folderId,
        now,
        noteId
      );
    });
    tx();
    return { ...cur, folder_id: folderId, updated_at: now };
  }

  static remove(id: string): boolean {
    const db = getDb();
    let changed = 0;
    const tx = db.transaction(() => {
      const info = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
      changed = info.changes;
    });
    tx();
    // 级联删除附件磁盘文件（chat/attachments DB 行由 FK CASCADE 自动删）
    if (changed > 0) AttachmentRepository.removeAllForNote(id);
    return changed > 0;
  }
}
