import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { Recording } from '@shared/types';
import { getDb } from '../init';

/**
 * 录音文件磁盘存储根目录：与附件存储保持一致的模式。
 * dev 模式放在项目根目录，生产模式放在 userData。
 * 实际路径：{root}/recordings/{noteId}/{recordingId}.wav | .txt
 */
export function getRecordingsStorageRoot(): string {
  const isDev = process.env.NODE_ENV === 'development';
  const dbDir = isDev
    ? path.join(__dirname, '../..')
    : app.getPath('userData');
  const root = path.join(dbDir, 'recordings');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * RecordingRepository - 会议录音的 SQLite 持久化 + 磁盘文件管理。
 *
 * 存储模型：
 *   磁盘：{root}/recordings/{noteId}/{recordingId}.wav  （音频文件）
 *         {root}/recordings/{noteId}/{recordingId}.txt  （转写文本文件）
 *   SQLite：recordings 表保存元数据 + 文件相对路径
 *
 * 删除记事时 FK CASCADE 清理 DB 行，磁盘文件由应用层清理。
 */
export class RecordingRepository {
  /** 读取某篇记事的所有录音，按创建时间降序（最新在前）。 */
  static listForNote(noteId: string): Recording[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, note_id, title, transcript, duration, audio_path, transcript_path, created_at, updated_at
         FROM recordings
         WHERE note_id = ?
         ORDER BY created_at DESC`
      )
      .all(noteId) as Recording[];
    return rows;
  }

  /**
   * 新建一条录音记录：
   * 1. 将音频数据写入磁盘 .wav 文件
   * 2. 将转写文本写入磁盘 .txt 文件
   * 3. 在 SQLite 中保存元数据 + 文件相对路径
   */
  static create(input: {
    note_id: string;
    title: string;
    transcript: string;
    duration: number;
    /** WAV 音频二进制数据 */
    audioUint8: Uint8Array;
  }): Recording {
    const db = getDb();
    const root = getRecordingsStorageRoot();
    const id = randomUUID();
    const now = Date.now();

    // 文件名：{recordingId}.wav / {recordingId}.txt
    const audioFileName = `${id}.wav`;
    const transcriptFileName = `${id}.txt`;
    // 相对路径（相对于 recordings 存储根目录）
    const audioRelPath = path.join(input.note_id, audioFileName);
    const transcriptRelPath = path.join(input.note_id, transcriptFileName);

    // 确保笔记目录存在
    const noteDir = path.join(root, input.note_id);
    if (!fs.existsSync(noteDir)) fs.mkdirSync(noteDir, { recursive: true });

    // 写入音频文件
    const audioAbsPath = path.join(noteDir, audioFileName);
    fs.writeFileSync(audioAbsPath, Buffer.from(input.audioUint8));

    // 写入转写文本文件
    const transcriptAbsPath = path.join(noteDir, transcriptFileName);
    fs.writeFileSync(transcriptAbsPath, input.transcript, 'utf-8');

    // 插入 DB 记录
    db.prepare(
      `INSERT INTO recordings (id, note_id, title, transcript, duration, audio_path, transcript_path, created_at, updated_at)
       VALUES (@id, @note_id, @title, @transcript, @duration, @audio_path, @transcript_path, @created_at, @updated_at)`
    ).run({
      id,
      note_id: input.note_id,
      title: input.title,
      transcript: input.transcript,
      duration: input.duration,
      audio_path: audioRelPath,
      transcript_path: transcriptRelPath,
      created_at: now,
      updated_at: now
    });

    return {
      id,
      note_id: input.note_id,
      title: input.title,
      transcript: input.transcript,
      duration: input.duration,
      audio_path: audioRelPath,
      transcript_path: transcriptRelPath,
      created_at: now,
      updated_at: now
    };
  }

  /**
   * 更新录音标题或转写文本。
   * 如果更新转写文本，同步刷新磁盘上的 .txt 文件。
   */
  static update(
    id: string,
    patch: Partial<Pick<Recording, 'title' | 'transcript'>>
  ): Recording | null {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM recordings WHERE id = ?')
      .get(id) as Recording | undefined;
    if (!existing) return null;

    const now = Date.now();
    const fields: string[] = ['updated_at = @updated_at'];
    const params: Record<string, unknown> = { id, updated_at: now };
    if (patch.title !== undefined) {
      fields.push('title = @title');
      params.title = patch.title;
    }
    if (patch.transcript !== undefined) {
      fields.push('transcript = @transcript');
      params.transcript = patch.transcript;
      // 同步更新磁盘上的 .txt 文件
      const root = getRecordingsStorageRoot();
      const transcriptAbsPath = path.join(root, existing.transcript_path);
      try {
        fs.writeFileSync(transcriptAbsPath, patch.transcript, 'utf-8');
      } catch (e) {
        console.error('[RecordingRepository] update: failed to write transcript file:', e);
      }
    }
    db.prepare(`UPDATE recordings SET ${fields.join(', ')} WHERE id = @id`).run(params);

    const row = db
      .prepare(
        `SELECT id, note_id, title, transcript, duration, audio_path, transcript_path, created_at, updated_at
         FROM recordings WHERE id = ?`
      )
      .get(id) as Recording;
    return row;
  }

  /**
   * 删除一条录音：删 DB 行 + 删磁盘上的 .wav 和 .txt 文件。
   * 如果笔记目录变空，自动清理空目录。
   */
  static delete(id: string): boolean {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM recordings WHERE id = ?')
      .get(id) as Recording | undefined;
    if (!existing) return false;

    const root = getRecordingsStorageRoot();
    const noteDir = path.join(root, existing.note_id);

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
    });
    tx();

    // 删除磁盘文件
    const audioAbsPath = path.join(root, existing.audio_path);
    const transcriptAbsPath = path.join(root, existing.transcript_path);
    try { if (fs.existsSync(audioAbsPath)) fs.unlinkSync(audioAbsPath); } catch { /* ignore */ }
    try { if (fs.existsSync(transcriptAbsPath)) fs.unlinkSync(transcriptAbsPath); } catch { /* ignore */ }

    // 清理空目录
    fsPromises.readdir(noteDir).then((entries) => {
      if (entries.length === 0) fsPromises.rmdir(noteDir).catch(() => {});
    }).catch(() => {});

    return true;
  }

  /** 删除 note 下所有录音（DB 行 + 磁盘文件 + rmdir noteId 目录） */
  static removeAllForNote(noteId: string): void {
    const root = getRecordingsStorageRoot();
    const noteDir = path.join(root, noteId);
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM recordings WHERE note_id = ?').run(noteId);
    });
    tx();
    if (fs.existsSync(noteDir)) {
      fsPromises.rm(noteDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
