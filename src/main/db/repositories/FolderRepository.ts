import { randomUUID } from 'node:crypto';
import type { Folder } from '@shared/types';
import { getDb } from '../init';
import { AttachmentRepository } from './AttachmentRepository';

/**
 * FolderRepository - 仓储模式：封装 folders 表所有访问
 * 所有写入均使用事务，保证一致性
 *
 * 删除策略：parent_id 自引用 ON DELETE CASCADE 由 DB 自动递归删除子文件夹；
 * 但 notes.folder_id 无 DB 级 FK（ALTER ADD COLUMN 限制），故 remove 在事务内
 * 显式删除后代文件夹下挂的所有记事（chat 由 notes 的 CASCADE 自动清理）。
 */
export class FolderRepository {
  /** 返回全部文件夹（扁平），前端组装树。按 updated_at DESC 排序。 */
  static list(): Folder[] {
    const db = getDb();
    return db
      .prepare(
        'SELECT id, name, parent_id, created_at, updated_at FROM folders ORDER BY updated_at DESC'
      )
      .all() as Folder[];
  }

  /** 创建文件夹。parent_id 为 null 表示根级。 */
  static create(input: { name: string; parent_id: string | null }): Folder {
    const db = getDb();
    const id = randomUUID();
    const now = Date.now();
    const folder: Folder = {
      id,
      name: input.name?.trim() || '新建文件夹',
      parent_id: input.parent_id ?? null,
      created_at: now,
      updated_at: now
    };
    const tx = db.transaction(() => {
      // 父级存在性校验（应用层兜底，防止悬挂引用）
      if (input.parent_id) {
        const p = db.prepare('SELECT 1 FROM folders WHERE id = ?').get(input.parent_id);
        if (!p) throw new Error('parent folder not found');
      }
      db.prepare(
        'INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (@id, @name, @parent_id, @created_at, @updated_at)'
      ).run(folder);
    });
    tx();
    return folder;
  }

  /** 重命名文件夹。 */
  static rename(id: string, name: string): Folder | null {
    const db = getDb();
    const cur = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as Folder | undefined;
    if (!cur) return null;
    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(
        name?.trim() || '新建文件夹',
        now,
        id
      );
    });
    tx();
    return { ...cur, name, updated_at: now };
  }

  /**
   * 移动文件夹到新的父级下（newParentId = null 表示移到根级）。
   * 事务内做循环检测：newParentId 不能是 id 本身，也不能是 id 的任何后代，
   * 否则会形成 parent_id 环导致树结构损坏。
   */
  static move(id: string, newParentId: string | null): Folder | null {
    const db = getDb();
    const cur = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as Folder | undefined;
    if (!cur) return null;
    if (id === newParentId) throw new Error('不能移动文件夹到自身');
    if (newParentId) {
      // 父级存在性校验（应用层兜底，防止悬挂引用）
      const p = db.prepare('SELECT 1 FROM folders WHERE id = ?').get(newParentId);
      if (!p) throw new Error('目标文件夹不存在');
      // 循环检测：递归 CTE 收集 id 的所有后代，newParentId 不能在其中
      const desc = db
        .prepare(
          `WITH RECURSIVE desc(cid) AS (
             SELECT id FROM folders WHERE parent_id = ?
             UNION ALL
             SELECT f.id FROM folders f JOIN desc ON f.parent_id = desc.cid
           )
           SELECT cid FROM desc`
        )
        .all(id) as Array<{ cid: string }>;
      if (desc.some((r) => r.cid === newParentId)) {
        throw new Error('不能移动文件夹到自己的子文件夹下');
      }
    }
    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare('UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?').run(
        newParentId,
        now,
        id
      );
    });
    tx();
    return { ...cur, parent_id: newParentId, updated_at: now };
  }

  /**
   * 删除文件夹。事务内：
   *   1. 递归 CTE 收集本文件夹 + 所有后代文件夹 id
   *   2. 删除挂在这些文件夹下的 notes（应用层级联，notes.folder_id 无 DB FK）
   *   3. 删除文件夹本体（子文件夹由 parent_id CASCADE 自动删）
   *   4. 返回被删 note 数量，供 UI 提示
   * chat_sessions/messages 由 notes 的 CASCADE 自动清理。
   */
  static remove(id: string): { deletedNoteCount: number } {
    const db = getDb();
    let deletedNoteCount = 0;
    const tx = db.transaction(() => {
      // 递归 CTE 收集本文件夹 + 所有后代
      const ids = db
        .prepare(
          `WITH RECURSIVE desc(id) AS (
             SELECT id FROM folders WHERE id = ?
             UNION ALL
             SELECT f.id FROM folders f JOIN desc ON f.parent_id = desc.id
           )
           SELECT id FROM desc`
        )
        .all(id) as Array<{ id: string }>;
      const allIds = ids.map((r) => r.id);
      if (allIds.length === 0) return;

      // 删除挂在这些文件夹下的 notes（应用层级联）
      const placeholders = allIds.map(() => '?').join(',');
      // 先收集被删的 note id，以便在 DB CASCADE 之前清理磁盘附件
      const affectedNotes = db
        .prepare(
          `SELECT id FROM notes WHERE folder_id IN (${placeholders})`
        )
        .all(...allIds) as Array<{ id: string }>;

      const info = db
        .prepare(`DELETE FROM notes WHERE folder_id IN (${placeholders})`)
        .run(...allIds);
      deletedNoteCount = info.changes;

      // 删除文件夹本体（子文件夹由 parent_id CASCADE 自动删）
      db.prepare('DELETE FROM folders WHERE id = ?').run(id);

      // 清理附件磁盘文件（attachments DB 行由 FK CASCADE 自动删）
      for (const { id: nid } of affectedNotes) {
        AttachmentRepository.removeAllForNote(nid);
      }
    });
    tx();
    return { deletedNoteCount };
  }
}
