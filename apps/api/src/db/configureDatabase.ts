import type Database from 'better-sqlite3';

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_KIB = 20 * 1024;

export function configureDatabase(db: Database.Database) {
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${positiveInt(process.env.SQLITE_BUSY_TIMEOUT_MS, DEFAULT_BUSY_TIMEOUT_MS)}`);
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma(`cache_size = -${positiveInt(process.env.SQLITE_CACHE_KIB, DEFAULT_CACHE_KIB)}`);
}

export function enableWriteAheadLog(db: Database.Database) {
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 1000');
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
