import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { DB_PATH } from './config.js';
import { MemoryItemSchema, type MemoryItem } from '@frank/contracts';
import { configureDatabase, enableWriteAheadLog } from './configureDatabase.js';

type SearchOptions = {
  limit: number;
};

export class SqliteMemoryStore {
  private db: Database.Database;
  private ownsConnection: boolean;

  constructor(dbPath: string | Database.Database = DB_PATH) {
    if (typeof dbPath !== 'string') {
      this.db = dbPath;
      this.ownsConnection = false;
      return;
    }
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.ownsConnection = true;

    enableWriteAheadLog(this.db);
    configureDatabase(this.db);
  }

  close() {
    if (this.ownsConnection) this.db.close();
  }

  //the any isnt recommended.
  get rawDb(): any {
    return this.db;
  }

  add(userId: string, item: MemoryItem) {
    const validated = MemoryItemSchema.parse(item);

    const stmt = this.db.prepare(`
      INSERT INTO memory_items (
        id, type, title, content, tags_json, created_at, media_ref, embedding_ref,
        request_id, session_id, user_id
      ) VALUES (
        @id, @type, @title, @content, @tags_json, @created_at, @media_ref, @embedding_ref,
        @request_id, @session_id, @user_id
      )
      ON CONFLICT(user_id, id) DO UPDATE SET
        type = excluded.type,
        title = excluded.title,
        content = excluded.content,
        tags_json = excluded.tags_json,
        created_at = excluded.created_at,
        media_ref = excluded.media_ref,
        embedding_ref = excluded.embedding_ref,
        request_id = excluded.request_id,
        session_id = excluded.session_id
    `);

    stmt.run({
      id: validated.id,
      type: validated.type,
      title: validated.title,
      content: validated.content,
      tags_json: JSON.stringify(validated.tags ?? []),
      created_at: validated.createdAt,
      media_ref: validated.mediaRef ?? null,
      embedding_ref: validated.embeddingRef ?? null,
      request_id: validated.trace?.requestId ?? null,
      session_id: validated.trace?.sessionId ?? null,
      user_id: userId,
    });
  }

  recent(userId: string, limit: number): Promise<MemoryItem[]> {
    const stmt = this.db.prepare(`
      SELECT *
      FROM memory_items
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(userId, limit);
    return Promise.resolve(rows.map(rowToMemoryItem));
  }

  search(userId: string, query: string, opts: SearchOptions): Promise<MemoryItem[]> {
    const q = query.trim().toLowerCase();
    if (!q) return Promise.resolve([]);

    // 1) tokenize: remove punctuation, split words
    const tokens = normalizeSearchText(q)
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => t.length >= 3);

    // 2) remove common filler words (tiny stoplist)
    const STOP = new Set([
      'the',
      'and',
      'for',
      'with',
      'this',
      'that',
      'what',
      'does',
      'have',
      'to',
      'you',
      'your',
      'from',
      'into',
      'about',
      'are',
      'was',
      'were',
      'will',
      'can',
      'could',
      'should',
      'would',
    ]);
    const keywords = tokens.filter((t) => !STOP.has(t));

    // If everything got filtered out, fall back to raw
    const finalTokens = (keywords.length ? keywords : tokens).slice(0, 6);
    if (finalTokens.length === 0) return Promise.resolve([]);

    // Rank a bounded candidate set in application code. This lets a rewritten
    // semantic query favour a matching subject without widening the result to
    // unrelated personal facts.
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_items
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 500
    `).all(userId) as any[];

    const ranked = rows
      .map((row) => ({ row, score: relevanceScore(row, finalTokens) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || String(b.row.created_at).localeCompare(String(a.row.created_at)))
      .slice(0, opts.limit)
      .map(({ row }) => rowToMemoryItem(row));
    return Promise.resolve(ranked);
  }

  delete(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return Promise.resolve(0);

    const stmt = this.db.prepare(`
      DELETE FROM memory_items
      WHERE id = ? AND user_id = ?
    `);

    const tx = this.db.transaction((toDelete: string[]) => {
      let deleted = 0;
      for (const id of toDelete) {
        const res = stmt.run(id, userId);
        deleted += res.changes;
      }
      return deleted;
    });

    return Promise.resolve(tx(ids));
  }
}

function relevanceScore(row: any, tokens: string[]) {
  const title = normalizeSearchText(row.title);
  const content = normalizeSearchText(row.content);
  const tags = normalizeSearchText(safeJsonArray(row.tags_json).join(' '));
  return tokens.reduce(
    (score, token) =>
      score + (title.includes(token) ? 5 : 0) + (content.includes(token) ? 3 : 0) +
      (tags.includes(token) ? 2 : 0),
    0,
  );
}

function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\bcolours?\b/g, 'color')
    .replace(/\bfavourites?\b/g, 'favorite')
    .replace(/[^a-z0-9\s:-]/g, ' ');
}

function rowToMemoryItem(row: any): MemoryItem {
  const item: MemoryItem = {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    tags: safeJsonArray(row.tags_json),
    createdAt: row.created_at,
    mediaRef: row.media_ref ?? undefined,
    embeddingRef: row.embedding_ref ?? undefined,
    trace:
      row.request_id || row.session_id
        ? { requestId: row.request_id ?? 'unknown', sessionId: row.session_id ?? undefined }
        : undefined,
  };

  return MemoryItemSchema.parse(item);
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
