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
          session_id,
          role,
          text,
          created_at
        ) VALUES (?, ?, ?, ?)
        `,
      )
      .run(turn.sessionId, turn.role, turn.text, turn.createdAt);

    return Promise.resolve();
  }

  async getRecent(sessionId: string, limit: number): Promise<ConversationTurn[]> {
    const rows = this.db
      .prepare(
        `
        SELECT session_id, role, text, created_at
        FROM conversation_turns
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        `,
      )
      .all(sessionId, limit);

    // DB returns newest first; reverse so prompt reads oldest -> newest
    const turns: ConversationTurn[] = rows
      .map((row: any) => ({
        sessionId: row.session_id,
        role: row.role,
        text: row.text,
        createdAt: row.created_at,
      }))
      .reverse();

    return Promise.resolve(turns);
  }
}
