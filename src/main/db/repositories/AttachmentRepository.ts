import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { Attachment } from '@shared/types';
import { deriveMimeFromName } from '@shared/mime-utils';
import { getDb } from '../init';

/**
 * 附件本地存储根目录：与 DB 文件保持同目录，dev 模式放在项目根，生产在 userData
 * 实际路径：{root}/attachments/{noteId}/{attachmentId}
 */
export function getAttachmentsStorageRoot(): string {
  const isDev = process.env.NODE_ENV === 'development';
  const dbDir = isDev
    ? path.join(__dirname, '../..')
    : app.getPath('userData');
  const root = path.join(dbDir, 'attachments');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * 返回附件文件在磁盘上的绝对路径。
 * 会校验：1) 附件在 DB 中必须存在；2) 解析出的真实文件路径必须位于 storageRoot 目录内（防止路径穿越）。
 */
export function getAttachmentPathOrThrow(id: string): { attachment: Attachment; absolutePath: string } {
  const db = getDb();
  const attachment = db
    .prepare('SELECT * FROM attachments WHERE id = ?')
    .get(id) as Attachment | undefined;
  if (!attachment) throw new Error('attachment not found');

  const root = getAttachmentsStorageRoot();
  const expectedDir = path.join(root, attachment.note_id);
  const absolutePath = path.resolve(expectedDir, attachment.file_name);
  const realDir = path.resolve(path.dirname(absolutePath));
  if (realDir !== path.resolve(expectedDir)) {
    throw new Error('attachment path traversal detected');
  }
  return { attachment, absolutePath };
}

/**
 * AttachmentRepository
 * 注意：删除 DB 行时也会同步删除磁盘上的真实文件（recursive remove note_id 目录当为空时）。
 * notes 表的 FK CASCADE 会自动删 attachments DB 行，但磁盘文件需要应用层处理：
 * 我们在 NoteRepository.remove 中显式收集附件并清理磁盘文件。
 */
export class AttachmentRepository {
  /** 列出一篇记事下所有附件 */
  static listByNote(noteId: string): Attachment[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM attachments WHERE note_id = ? ORDER BY created_at ASC')
      .all(noteId) as Attachment[];
  }

  static get(id: string): Attachment | null {
    const db = getDb();
    return (
      (db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment | undefined) ?? null
    );
  }

  /**
   * 上传附件：把用户选择的文件拷贝/写入到存储目录，插入 DB。
   *
   * @param input.noteId    所属记事 id（必填且必须存在）
   * @param input.originalName 用户侧原始文件名
   * @param input.mimeType  文件 MIME
   * @param input.sourcePath 若可用：本地绝对路径，直接 fs.copyFile（避免在 IPC 传大 buffer）。
   *                         sourcePath 必须位于 app.getPath('temp') 或其上级目录（安全校验），
   *                         否则会被拒，必须用 buffer。
   * @param input.buffer    如果渲染端直接发送 ArrayBuffer，就落磁盘写
   * @returns {Attachment}  新建的 DB 行
   */
  static create(input: {
    noteId: string;
    originalName: string;
    mimeType: string;
    sourcePath?: string;
    buffer?: Uint8Array;
  }): Attachment {
    const db = getDb();
    const root = getAttachmentsStorageRoot();

    // 1) 校验记事存在
    const noteExists = db.prepare('SELECT 1 FROM notes WHERE id = ?').get(input.noteId);
    if (!noteExists) throw new Error('note not found');

    // 2) 安全文件名：UUID + 原扩展名，避免特殊字符/路径穿越
    const id = randomUUID();
    const ext = path.extname(input.originalName || '').slice(0, 20);
    const storedName = `${id}${ext}`;
    const noteDir = path.join(root, input.noteId);
    if (!fs.existsSync(noteDir)) fs.mkdirSync(noteDir, { recursive: true });
    const targetPath = path.join(noteDir, storedName);

    // 3) 写磁盘
    let size = 0;
    if (input.sourcePath) {
      // sourcePath 白名单：仅允许来自 temp 目录 / userData 的已知安全位置
      const allowedRoots = [
        app.getPath('temp'),
        app.getPath('userData'),
        app.getPath('downloads')
      ];
      const resolvedSource = path.resolve(input.sourcePath);
      const inWhitelist = allowedRoots.some((r) =>
        resolvedSource.startsWith(path.resolve(r) + path.sep)
      );
      if (!inWhitelist) {
        // 不直接抛错，回退到 buffer（有些渲染侧选择对话框的临时路径不规范）
        if (!input.buffer) {
          throw new Error('source path not in whitelist and no buffer provided');
        }
      } else {
        fs.copyFileSync(resolvedSource, targetPath);
        size = fs.statSync(targetPath).size;
      }
    }
    if (size === 0 && input.buffer) {
      fs.writeFileSync(targetPath, Buffer.from(input.buffer));
      size = fs.statSync(targetPath).size;
    }
    if (size === 0) {
      try { fs.unlinkSync(targetPath); } catch { /* ignore */ }
      throw new Error('attachment empty: no source path nor buffer');
    }

    // 4) 插入 DB
    const now = Date.now();
    // 空 mime 兜底：按扩展名推导一次，保证预览分派可正常工作
    const mime = input.mimeType || deriveMimeFromName(input.originalName);
    const att: Attachment = {
      id,
      note_id: input.noteId,
      file_name: storedName,
      original_name: input.originalName || storedName,
      mime_type: mime,
      size,
      created_at: now,
      updated_at: now
    };
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO attachments (id, note_id, file_name, original_name, mime_type, size, created_at, updated_at) VALUES (@id, @note_id, @file_name, @original_name, @mime_type, @size, @created_at, @updated_at)'
      ).run(att);
    });
    tx();
    return att;
  }

  /**
   * 删除单个附件：删 DB 行 + 删磁盘文件，清理空目录。
   */
  static remove(id: string): boolean {
    const db = getDb();
    let absolutePath: string | null = null;
    let noteId: string | null = null;
    try {
      const res = getAttachmentPathOrThrow(id);
      absolutePath = res.absolutePath;
      noteId = res.attachment.note_id;
    } catch {
      return false;
    }
    const tx = db.transaction(() => {
      const info = db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
      if (info.changes === 0) return;
      if (absolutePath && fs.existsSync(absolutePath)) {
        try { fs.unlinkSync(absolutePath); } catch { /* ignore */ }
      }
    });
    tx();
    // 清理空目录
    if (noteId) {
      const noteDir = path.join(getAttachmentsStorageRoot(), noteId);
      fsPromises.readdir(noteDir).then((entries) => {
        if (entries.length === 0) fsPromises.rmdir(noteDir).catch(() => {});
      }).catch(() => {});
    }
    return true;
  }

  /** 删除 note 下所有附件（DB 行 + 磁盘文件 + rmdir noteId 目录） */
  static removeAllForNote(noteId: string): void {
    const root = getAttachmentsStorageRoot();
    const noteDir = path.join(root, noteId);
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM attachments WHERE note_id = ?').run(noteId);
    });
    tx();
    if (fs.existsSync(noteDir)) {
      fsPromises.rm(noteDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
