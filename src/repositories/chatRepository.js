import { getDb } from '../db/database.js';

function parseJson(text, fallback = {}) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export const chatRepository = {
  ensureSession({ sessionId, userId, title }) {
    const db = getDb();
    db.prepare(`
      INSERT INTO chat_sessions (session_id, user_id, title, created_at, updated_at)
      VALUES (@sessionId, @userId, @title, datetime('now'), datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        updated_at = datetime('now'),
        title = COALESCE(excluded.title, chat_sessions.title)
    `).run({ sessionId, userId: userId || null, title: title || null });
  },

  createMessage({ sessionId, role, content, metadata = {} }) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, metadata, created_at)
      VALUES (@sessionId, @role, @content, @metadata, datetime('now'))
    `).run({ sessionId, role, content, metadata: JSON.stringify(metadata) });

    db.prepare('UPDATE chat_sessions SET updated_at = datetime(\'now\') WHERE session_id = ?').run(sessionId);

    return result.lastInsertRowid;
  },

  listSessions({ limit = 50, userId }) {
    const db = getDb();
    const rows = userId
      ? db.prepare(`
          SELECT s.session_id, s.user_id, s.title, s.created_at, s.updated_at,
                 COUNT(m.id) AS message_count
          FROM chat_sessions s
          LEFT JOIN chat_messages m ON m.session_id = s.session_id
          WHERE s.user_id = ?
          GROUP BY s.session_id
          ORDER BY s.updated_at DESC
          LIMIT ?
        `).all(userId, limit)
      : db.prepare(`
          SELECT s.session_id, s.user_id, s.title, s.created_at, s.updated_at,
                 COUNT(m.id) AS message_count
          FROM chat_sessions s
          LEFT JOIN chat_messages m ON m.session_id = s.session_id
          GROUP BY s.session_id
          ORDER BY s.updated_at DESC
          LIMIT ?
        `).all(limit);

    return rows.map((row) => ({
      sessionId: row.session_id,
      userId: row.user_id,
      title: row.title,
      messageCount: row.message_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  listMessages(sessionId, limit = 100) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM chat_messages
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, limit);

    return rows.reverse().map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      metadata: parseJson(row.metadata, {}),
      createdAt: row.created_at,
    }));
  },

  deleteSession(sessionId) {
    const db = getDb();
    return db.prepare('DELETE FROM chat_sessions WHERE session_id = ?').run(sessionId).changes;
  },
};
