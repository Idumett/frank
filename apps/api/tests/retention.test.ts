import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRetention } from '../src/security/retention.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe('retention cleanup', () => {
  it('removes expired records and cache files while preserving current data', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE request_traces (started_at TEXT NOT NULL);
      CREATE TABLE conversation_turns (created_at TEXT NOT NULL);
      CREATE TABLE sessions (last_seen_at TEXT NOT NULL);
    `);
    for (const table of ['request_traces', 'conversation_turns', 'sessions']) {
      const column =
        table === 'request_traces'
          ? 'started_at'
          : table === 'conversation_turns'
            ? 'created_at'
            : 'last_seen_at';
      db.prepare(`INSERT INTO ${table} (${column}) VALUES (?), (?)`).run(
        '2026-01-01T00:00:00.000Z',
        '2026-11-21T00:00:00.000Z',
      );
    }
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-retention-'));
    dirs.push(cacheDir);
    const expired = path.join(cacheDir, 'expired.mp3');
    const current = path.join(cacheDir, 'current.mp3');
    fs.writeFileSync(expired, 'old');
    fs.writeFileSync(current, 'new');
    fs.utimesSync(expired, new Date('2026-01-01'), new Date('2026-01-01'));
    fs.utimesSync(current, new Date('2026-11-20'), new Date('2026-11-20'));

    expect(applyRetention(db, cacheDir, new Date('2026-11-21T12:00:00.000Z'))).toEqual({
      traces: 1,
      conversations: 1,
      sessions: 1,
      cacheFiles: 1,
    });
    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(current)).toBe(true);
    db.close();
  });
});
