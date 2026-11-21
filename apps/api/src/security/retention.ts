import fs from 'node:fs';
import path from 'node:path';
const day = 86_400_000;
export function applyRetention(
  db: { prepare: (sql: string) => any; transaction?: (work: () => unknown) => () => unknown },
  cacheDir: string,
  current = new Date(),
) {
  const now = current.getTime();
  const removeDatabaseRecords = () => ({
    traces: db
      .prepare('DELETE FROM request_traces WHERE started_at < ?')
      .run(new Date(now - days('TRACE_RETENTION_DAYS', 14, 90) * day).toISOString()).changes,
    conversations: db
      .prepare('DELETE FROM conversation_turns WHERE created_at < ?')
      .run(new Date(now - days('CONVERSATION_RETENTION_DAYS', 1, 30) * day).toISOString()).changes,
    sessions: db
      .prepare('DELETE FROM sessions WHERE last_seen_at < ?')
      .run(new Date(now - days('SESSION_RETENTION_DAYS', 30, 365) * day).toISOString()).changes,
  });
  const records = db.transaction
    ? db.transaction(removeDatabaseRecords)()
    : removeDatabaseRecords();
  const before = now - days('TTS_CACHE_RETENTION_DAYS', 7, 30) * day;
  let cacheFiles = 0;
  if (fs.existsSync(cacheDir))
    for (const name of fs.readdirSync(cacheDir)) {
      const filename = path.join(cacheDir, name);
      const stat = fs.lstatSync(filename);
      if (stat.isFile() && stat.mtimeMs < before) {
        fs.unlinkSync(filename);
        cacheFiles += 1;
      }
    }
  return {
    ...(records as { traces: number; conversations: number; sessions: number }),
    cacheFiles,
  };
}
function days(name: string, fallback: number, maximum: number) {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}
