import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { DB_PATH } from './config.js';
import { MemoryItemSchema, type MemoryItem } from '@frank/contracts';

type SearchOptions = {
  limit: number;
};

export class SqliteMemoryStore {
  private db: Database.Database;

  constructor() {
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(DB_PATH);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  close() {
    this.db.close();
  }

  add(item: MemoryItem) {
    const validated = MemoryItemSchema.parse(item);

    const stmt = this.db.prepare(`
      INSERT INTO memory_items (
        id, type, title, content, tags_json, created_at, media_ref, embedding_ref,
        request_id, session_id
      ) VALUES (
        @id, @type, @title, @content, @tags_json, @created_at, @media_ref, @embedding_ref,
        @request_id, @session_id
      )
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
    });
  }

  recent(limit: number): Promise<MemoryItem[]> {
    const stmt = this.db.prepare(`
      SELECT *
      FROM memory_items
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit);
    return Promise.resolve(rows.map(rowToMemoryItem));
  }

  search(query: string, opts: SearchOptions): Promise<MemoryItem[]> {
    const q = query.trim().toLowerCase();
    if (!q) return Promise.resolve([]);

    // Simple keyword search with LIKE (v1)
    // Later: FTS5 or embeddings-based semantic search
    const like = `%${q}%`;

    const stmt = this.db.prepare(`
      SELECT *
      FROM memory_items
      WHERE
        LOWER(title) LIKE ? OR
        LOWER(content) LIKE ? OR
        LOWER(tags_json) LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(like, like, like, opts.limit);
    return Promise.resolve(rows.map(rowToMemoryItem));
  }

  delete(ids: string[]): Promise<number> {
    if (ids.length === 0) return Promise.resolve(0);

    const stmt = this.db.prepare(`
      DELETE FROM memory_items
      WHERE id = ?
    `);

    const tx = this.db.transaction((toDelete: string[]) => {
      let deleted = 0;
      for (const id of toDelete) {
        const res = stmt.run(id);
        deleted += res.changes;
      }
      return Promise.resolve(deleted);
    });

    return Promise.resolve(tx(ids));
  }
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
