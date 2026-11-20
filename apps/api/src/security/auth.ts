import crypto from 'node:crypto';
import fs from 'node:fs';

type AuthFile = {
  users: Array<{ id: string; tokenHashes: string[] }>;
  diagnosticTokenHashes: string[];
};

export type AuthResult = { kind: 'user'; userId: string } | { kind: 'diagnostics' };

export class TokenRegistry {
  private modified = -1;
  private config: AuthFile = { users: [], diagnosticTokenHashes: [] };
  constructor(private filename: string) {}

  authenticate(header: string | undefined, diagnostics = false): AuthResult | null {
    this.reload();
    const token = readBearer(header);
    if (!token) return null;
    const hash = hashToken(token);
    if (diagnostics) {
      return this.config.diagnosticTokenHashes.some((candidate) => safeEqual(hash, candidate))
        ? { kind: 'diagnostics' }
        : null;
    }
    for (const user of this.config.users) {
      if (user.tokenHashes.some((candidate) => safeEqual(hash, candidate))) {
        return { kind: 'user', userId: user.id };
      }
    }
    return null;
  }

  private reload() {
    const stat = fs.statSync(this.filename);
    if (stat.mtimeMs === this.modified) return;
    const parsed = validateAuthFile(JSON.parse(fs.readFileSync(this.filename, 'utf8')));
    this.config = parsed;
    this.modified = stat.mtimeMs;
  }
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readBearer(header: string | undefined) {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length >= 32 && token.length <= 512 ? token : null;
}

function validHash(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}
function safeEqual(left: string, right: string) {
  return (
    left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

function validateAuthFile(input: unknown): AuthFile {
  if (!input || typeof input !== 'object') throw new Error('Invalid Frank auth file');
  const parsed = input as Partial<AuthFile>;
  if (!Array.isArray(parsed.users) || !Array.isArray(parsed.diagnosticTokenHashes))
    throw new Error('Invalid Frank auth file');

  const userIds = new Set<string>();
  const tokenOwners = new Map<string, string>();
  for (const user of parsed.users) {
    if (
      !user ||
      typeof user.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(user.id) ||
      userIds.has(user.id) ||
      !Array.isArray(user.tokenHashes) ||
      user.tokenHashes.length === 0 ||
      user.tokenHashes.some((hash) => !validHash(hash))
    )
      throw new Error('Invalid Frank user token entry');
    userIds.add(user.id);
    for (const hash of user.tokenHashes) {
      if (tokenOwners.has(hash)) throw new Error('Frank token hash is assigned more than once');
      tokenOwners.set(hash, user.id);
    }
  }

  const diagnosticHashes = new Set<string>();
  for (const hash of parsed.diagnosticTokenHashes) {
    if (!validHash(hash)) throw new Error('Invalid Frank diagnostics token entry');
    if (diagnosticHashes.has(hash) || tokenOwners.has(hash))
      throw new Error('Frank token hash is assigned more than once');
    diagnosticHashes.add(hash);
  }
  return parsed as AuthFile;
}
