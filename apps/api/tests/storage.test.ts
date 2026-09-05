import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteMemoryStore } from '../src/db/sqliteMemoryStore.js';
import { SqliteConversationStore } from '../src/conversation/SqliteConversationStore.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe('V1 SQLite storage', () => {
  it('deletes every requested memory and reports the real count', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-storage-'));
    dirs.push(dir);
    const memory = new SqliteMemoryStore(path.join(dir, 'frank.db'));
    createTables(memory);
    for (const id of ['memory-1', 'memory-2', 'memory-3']) {
      memory.add('user-1', { id, type: 'mixed', title: id, content: 'saved', tags: [], createdAt: '2026-08-13T10:00:00.000Z' });
    }
    expect(await memory.delete('user-1', ['memory-1', 'missing', 'memory-3'])).toBe(2);
    expect((await memory.recent('user-1', 10)).map((item) => item.id)).toEqual(['memory-2']);
    memory.close();
  });

  it('keeps memory and conversation writes valid on the same database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-storage-'));
    dirs.push(dir);
    const memory = new SqliteMemoryStore(path.join(dir, 'frank.db'));
    createTables(memory);
    const conversation = new SqliteConversationStore(memory.rawDb);
    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      memory.add('user-1', { id: `memory-${index}`, type: 'mixed', title: `Item ${index}`, content: 'saved', tags: [], createdAt: new Date(1_786_000_000_000 + index).toISOString() });
      await conversation.addTurn({ userId: 'user-1', sessionId: 'session-1', role: index % 2 ? 'assistant' : 'user', text: `Turn ${index}`, createdAt: new Date().toISOString() });
    }));
    expect((await memory.recent('user-1', 30))).toHaveLength(20);
    expect(memory.rawDb.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(memory.rawDb.prepare('SELECT COUNT(*) count FROM conversation_turns').get().count).toBe(20);
    memory.close();
  });

  it('does not return or delete another user\'s memory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-storage-'));
    dirs.push(dir);
    const memory = new SqliteMemoryStore(path.join(dir, 'frank.db'));
    createTables(memory);
    memory.add('user-1', { id: 'private-1', type: 'mixed', title: 'Private', content: 'secret', tags: [], createdAt: new Date().toISOString() });
    memory.add('user-2', { id: 'private-1', type: 'mixed', title: 'Other', content: 'separate', tags: [], createdAt: new Date().toISOString() });
    expect((await memory.recent('user-2', 10)).map((item) => item.content)).toEqual(['separate']);
    expect(await memory.search('user-2', 'secret', { limit: 10 })).toEqual([]);
    expect(await memory.delete('user-2', ['private-1'])).toBe(1);
    expect(await memory.recent('user-1', 10)).toHaveLength(1);
    memory.close();
  });
});

function createTables(memory: SqliteMemoryStore) {
  memory.rawDb.exec(`
    CREATE TABLE memory_items (
      id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
      tags_json TEXT NOT NULL, created_at TEXT NOT NULL, media_ref TEXT, embedding_ref TEXT,
      request_id TEXT, session_id TEXT, user_id TEXT NOT NULL, PRIMARY KEY (user_id, id)
    );
    CREATE TABLE conversation_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL,
      text TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}
