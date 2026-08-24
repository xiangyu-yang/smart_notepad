import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatSession } from '@shared/types';
import { getDb } from '../init';

/**
 * ChatRepository - 聊天会话与消息的 SQLite 持久化。
 *
 * 模型：
 *   chat_sessions  ←(1:N)→  chat_messages
 *         ↑ note_id
 *       notes.id (CASCADE 删除：删除记事会连带清掉该记事所有 chat 历史)
 *   chat_active_session(note_id PK, session_id) — 每篇记事最后选中的会话
 *
 * 所有写入走事务，防止"会话写成功但消息丢了"导致不一致。
 */
export class ChatRepository {
  /** 读取某个记事的所有会话，每条会话包含其 messages（按 ordering 升序）。 */
  static listSessionsForNote(noteId: string): ChatSession[] {
    const db = getDb();
    const sessions = db
      .prepare(
        `SELECT id, note_id, title, created_at, updated_at
         FROM chat_sessions
         WHERE note_id = ?
         ORDER BY updated_at ASC`
      )
      .all(noteId) as Array<Omit<ChatSession, 'messages'>>;

    if (sessions.length === 0) return [];

    const sessionIds = sessions.map((s) => s.id);
    const placeholders = sessionIds.map(() => '?').join(',');
    const messages = db
      .prepare(
        `SELECT id, session_id, role, content, reasoning, ordering, created_at, updated_at
         FROM chat_messages
         WHERE session_id IN (${placeholders})
         ORDER BY session_id ASC, ordering ASC, created_at ASC`
      )
      .all(...sessionIds) as Array<
      ChatMessage & { session_id: string; ordering: number; reasoning?: string | null }
    >;

    const bySession = new Map<string, ChatMessage[]>();
    for (const m of messages) {
      const arr = bySession.get(m.session_id) ?? [];
      arr.push({
        id: m.id,
        role: m.role,
        content: m.content,
        reasoning: m.reasoning ?? undefined
      });
      bySession.set(m.session_id, arr);
    }

    return sessions.map(
      (s): ChatSession => ({
        id: s.id,
        note_id: s.note_id,
        title: s.title,
        created_at: s.created_at,
        updated_at: s.updated_at,
        messages: bySession.get(s.id) ?? []
      })
    );
  }

  static getActiveSessionId(noteId: string): string | null {
    const db = getDb();
    const row = db
      .prepare('SELECT session_id FROM chat_active_session WHERE note_id = ?')
      .get(noteId) as { session_id: string | null } | undefined;
    return row?.session_id ?? null;
  }

  static setActiveSessionId(noteId: string, sessionId: string | null): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO chat_active_session (note_id, session_id) VALUES (@note_id, @session_id)
       ON CONFLICT(note_id) DO UPDATE SET session_id = excluded.session_id`
    ).run({ note_id: noteId, session_id: sessionId ?? null });
  }

  /**
   * 把一组完整的会话"快照"整批写入某记事：先删该记事全部现有会话/消息，
   * 再一口气插入新的。用事务保证原子性，同时避免"会话与消息一对一乱序"问题。
   * 此 API 由渲染端 Zustand store 调用，每次用户会话变化（新增消息、改标题、
   * 新建会话）时都把当前 note 下的完整 sessions 数组原样持久化回来。
   */
  static replaceAllForNote(
    noteId: string,
    sessions: ChatSession[],
    activeSessionId: string | null
  ): void {
    const db = getDb();
    const tx = db.transaction(() => {
      // 1) Delete existing messages + sessions for this note
      const sessIds: string[] = (db
        .prepare('SELECT id FROM chat_sessions WHERE note_id = ?')
        .all(noteId) as Array<{ id: string }>).map((r) => r.id);
      if (sessIds.length > 0) {
        const placeholders = sessIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM chat_messages WHERE session_id IN (${placeholders})`).run(
          ...sessIds
        );
      }
      db.prepare('DELETE FROM chat_sessions WHERE note_id = ?').run(noteId);

      // 2) Insert sessions and their messages
      const insertSess = db.prepare(
        `INSERT INTO chat_sessions (id, note_id, title, created_at, updated_at)
         VALUES (@id, @note_id, @title, @created_at, @updated_at)`
      );
      const insertMsg = db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, reasoning, ordering, created_at, updated_at)
         VALUES (@id, @session_id, @role, @content, @reasoning, @ordering, @created_at, @updated_at)`
      );
      const now = Date.now();
      sessions.forEach((se) => {
        const createdAt = se.created_at || now;
        const updatedAt = se.updated_at || now;
        insertSess.run({
          id: se.id || randomUUID(),
          note_id: noteId,
          title: se.title ?? '',
          created_at: createdAt,
          updated_at: updatedAt
        });
        (se.messages ?? []).forEach((msg, idx) => {
          insertMsg.run({
            id: msg.id || randomUUID(),
            session_id: se.id,
            role: msg.role,
            content: msg.content ?? '',
            reasoning: msg.reasoning ?? null,
            ordering: idx,
            created_at: createdAt,
            updated_at: updatedAt
          });
        });
      });

      // 3) Save which session was active
      db.prepare(
        `INSERT INTO chat_active_session (note_id, session_id) VALUES (@note_id, @session_id)
         ON CONFLICT(note_id) DO UPDATE SET session_id = excluded.session_id`
      ).run({ note_id: noteId, session_id: activeSessionId ?? null });
    });
    tx();
  }

  /** 单会话 upsert（兼容旧 ipc 接口，保留但当前 UI 不常调用）。 */
  static upsertSession(session: ChatSession): ChatSession {
    const db = getDb();
    const now = Date.now();
    const createdAt = session.created_at || now;
    const updatedAt = session.updated_at || now;
    const tx = db.transaction(() => {
      const exists = db
        .prepare('SELECT id FROM chat_sessions WHERE id = ?')
        .get(session.id) as { id: string } | undefined;
      if (exists) {
        db.prepare(
          `UPDATE chat_sessions SET title = @title, updated_at = @updated_at WHERE id = @id`
        ).run({
          id: session.id,
          title: session.title ?? '',
          updated_at: updatedAt
        });
        db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(session.id);
      } else {
        db.prepare(
          `INSERT INTO chat_sessions (id, note_id, title, created_at, updated_at)
           VALUES (@id, @note_id, @title, @created_at, @updated_at)`
        ).run({
          id: session.id || randomUUID(),
          note_id: session.note_id,
          title: session.title ?? '',
          created_at: createdAt,
          updated_at: updatedAt
        });
      }
      const insertMsg = db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, reasoning, ordering, created_at, updated_at)
         VALUES (@id, @session_id, @role, @content, @reasoning, @ordering, @created_at, @updated_at)`
      );
      (session.messages ?? []).forEach((msg, idx) => {
        insertMsg.run({
          id: msg.id || randomUUID(),
          session_id: session.id,
          role: msg.role,
          content: msg.content ?? '',
          reasoning: msg.reasoning ?? null,
          ordering: idx,
          created_at: createdAt,
          updated_at: updatedAt
        });
      });
    });
    tx();
    return session;
  }

  static deleteSession(id: string): boolean {
    const db = getDb();
    let changed = 0;
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);
      const info = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
      changed = info.changes;
    });
    tx();
    return changed > 0;
  }
}
