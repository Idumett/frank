import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { hashToken, TokenRegistry } from '../src/security/auth.js';
import { RateLimiter } from '../src/security/rateLimiter.js';
import { SessionOwnershipError, SessionOwnershipStore } from '../src/security/sessionOwnership.js';

describe('online product boundary', () => {
  it('keeps product and diagnostics credentials separate and reloads rotations', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-auth-'));
    const file = path.join(dir, 'auth.json');
    const first = crypto.randomBytes(32).toString('hex');
    const next = crypto.randomBytes(32).toString('hex');
    const diagnostic = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, JSON.stringify({ users: [{ id: 'dan', tokenHashes: [hashToken(first)] }], diagnosticTokenHashes: [hashToken(diagnostic)] }));
    const registry = new TokenRegistry(file);
    expect(registry.authenticate(`Bearer ${first}`)).toEqual({ kind: 'user', userId: 'dan' });
    expect(registry.authenticate(`Bearer ${first}`, true)).toBeNull();
    expect(registry.authenticate(`Bearer ${diagnostic}`)).toBeNull();
    expect(registry.authenticate(`Bearer ${diagnostic}`, true)).toEqual({ kind: 'diagnostics' });
    fs.writeFileSync(file, JSON.stringify({ users: [{ id: 'dan', tokenHashes: [hashToken(next)] }], diagnosticTokenHashes: [hashToken(diagnostic)] }));
    const future = new Date(Date.now() + 1000); fs.utimesSync(file, future, future);
    expect(registry.authenticate(`Bearer ${first}`)).toBeNull();
    expect(registry.authenticate(`Bearer ${next}`)).toEqual({ kind: 'user', userId: 'dan' });
    fs.rmSync(dir, { recursive: true });
  });

  it('never lets another user claim an existing session', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE sessions (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)');
    const sessions = new SessionOwnershipStore(db);
    sessions.claim('dan', 'phone');
    expect(() => sessions.claim('another-user', 'phone')).toThrow(SessionOwnershipError);
    db.close();
  });

  it('returns a retry time after the request allowance is spent', () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.take('dan', 100).allowed).toBe(true);
    expect(limiter.take('dan', 101).allowed).toBe(true);
    expect(limiter.take('dan', 102)).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});
