import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './config.js';

export function migrate() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // better resilience
  db.pragma('foreign_keys = ON');

  // memory_items: our primary store
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      media_ref TEXT,
      embedding_ref TEXT,

      -- optional trace for debugging
      request_id TEXT,
      session_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memory_items_created_at
      ON memory_items(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_memory_items_title
      ON memory_items(title);

    CREATE INDEX IF NOT EXISTS idx_memory_items_content
      ON memory_items(content);
  `);

  // embeddings: optional (for later semantic search)
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      embedding_ref TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dims INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_embeddings_created_at
      ON embeddings(created_at DESC);
  `);

  db.close();
}
