import type { ConversationStore, ConversationTurn } from '@frank/core';

type BetterSqliteDbLike = {
  prepare: (sql: string) => any;
};

export class SqliteConversationStore implements ConversationStore {
  constructor(private db: BetterSqliteDbLike) {}

  async addTurn(turn: ConversationTurn): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO conversation_turns (
          user_id,
          session_id,
          role,
          text,
          created_at
        ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(turn.userId, turn.sessionId, turn.role, turn.text, turn.createdAt);

    return Promise.resolve();
  }

  async getRecent(userId: string, sessionId: string, limit: number): Promise<ConversationTurn[]> {
    const cutoff = new Date(Date.now() - 9 * 60 * 1000).toISOString();

    const rows = this.db
      .prepare(
        `
          SELECT user_id, session_id, role, text, created_at
          FROM conversation_turns
          WHERE user_id = ? AND session_id = ?
            AND created_at >= ?
          ORDER BY created_at DESC
          LIMIT ?
    `,
      )
      .all(userId, sessionId, cutoff, limit);

    // DB returns newest first; reverse so prompt reads oldest -> newest
    const turns: ConversationTurn[] = rows
      .map((row: any) => ({
        userId: row.user_id,
        sessionId: row.session_id,
        role: row.role,
        text: row.text,
        createdAt: row.created_at,
      }))
      .reverse();

    return Promise.resolve(turns);
  }
}
