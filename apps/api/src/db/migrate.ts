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

    CREATE TABLE IF NOT EXISTS user_prefs (
      session_id TEXT PRIMARY KEY,
      tts_language_code TEXT,
      tts_voice_name TEXT,
      tts_speaking_rate REAL,
      tts_pitch REAL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_turns_session_created
    ON conversation_turns(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS request_traces (
      request_id TEXT PRIMARY KEY,
      session_id TEXT,
      source TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      total_ms INTEGER,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      stages_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_request_traces_session_started
    ON request_traces(session_id, started_at DESC);
  `);

  ensureColumn(db, 'memory_items', "user_id TEXT NOT NULL DEFAULT 'legacy'");
  ensureColumn(db, 'user_prefs', "user_id TEXT NOT NULL DEFAULT 'legacy'");
  ensureColumn(db, 'conversation_turns', "user_id TEXT NOT NULL DEFAULT 'legacy'");
  ensureColumn(db, 'request_traces', "user_id TEXT NOT NULL DEFAULT 'legacy'");
  const legacyUserId = process.env.LEGACY_USER_ID?.trim();
  if (legacyUserId) {
    for (const table of ['memory_items', 'user_prefs', 'conversation_turns', 'request_traces']) {
      db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = 'legacy'`).run(legacyUserId);
    }
  }
  scopeMemoryIdsToUsers(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_memory_user_created ON memory_items(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_items_created_at ON memory_items(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_items_title ON memory_items(title);
    CREATE INDEX IF NOT EXISTS idx_memory_items_content ON memory_items(content);
    CREATE INDEX IF NOT EXISTS idx_conversation_user_session ON conversation_turns(user_id, session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prefs_user_session ON user_prefs(user_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_traces_user_started ON request_traces(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_seen ON sessions(user_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS product_entities (
      owner_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      schema_version TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_product_entities_owner_updated
      ON product_entities(owner_id, entity_type, updated_at DESC);
    CREATE TABLE IF NOT EXISTS product_operations (
      owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS pending_product_actions (
      owner_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_product_actions_expiry
      ON pending_product_actions(expires_at);
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

function ensureColumn(db: Database.Database, table: string, definition: string) {
  const name = definition.split(' ')[0];
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function scopeMemoryIdsToUsers(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(memory_items)').all() as Array<{
    name: string;
    pk: number;
  }>;
  if (columns.find((column) => column.name === 'user_id')?.pk) return;
  db.exec(`
    CREATE TABLE memory_items_scoped (
      id TEXT NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
      media_ref TEXT, embedding_ref TEXT, request_id TEXT, session_id TEXT,
      PRIMARY KEY (user_id, id)
    );
    INSERT INTO memory_items_scoped
      (id, user_id, type, title, content, tags_json, created_at, media_ref, embedding_ref, request_id, session_id)
      SELECT id, user_id, type, title, content, tags_json, created_at, media_ref, embedding_ref, request_id, session_id FROM memory_items;
    DROP TABLE memory_items;
    ALTER TABLE memory_items_scoped RENAME TO memory_items;
  `);
}
