export class SessionOwnershipError extends Error {
  constructor() { super('Session belongs to another user'); }
}

export class SessionOwnershipStore {
  constructor(private db: { prepare: (sql: string) => any; transaction: (fn: (...args: any[]) => any) => any }) {}

  claim(userId: string, sessionId: string | undefined) {
    if (!sessionId) return;
    this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.prepare(`INSERT OR IGNORE INTO sessions (session_id, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)`)
        .run(sessionId, userId, now, now);
      const row = this.db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').get(sessionId);
      if (row?.user_id !== userId) throw new SessionOwnershipError();
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE session_id = ? AND user_id = ?').run(now, sessionId, userId);
    })();
  }
}
