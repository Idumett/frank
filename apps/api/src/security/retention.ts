import fs from 'node:fs';
import path from 'node:path';
const day = 86_400_000;
export function applyRetention(db: { prepare: (sql: string) => any }, cacheDir: string) {
  const now = Date.now();
  db.prepare('DELETE FROM request_traces WHERE started_at < ?').run(new Date(now - days('TRACE_RETENTION_DAYS', 14) * day).toISOString());
  db.prepare('DELETE FROM conversation_turns WHERE created_at < ?').run(new Date(now - days('CONVERSATION_RETENTION_DAYS', 1) * day).toISOString());
  db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(new Date(now - days('SESSION_RETENTION_DAYS', 30) * day).toISOString());
  const before = now - days('TTS_CACHE_RETENTION_DAYS', 7) * day;
  if (fs.existsSync(cacheDir)) for (const name of fs.readdirSync(cacheDir)) {
    const filename = path.join(cacheDir, name);
    const stat = fs.statSync(filename);
    if (stat.isFile() && stat.mtimeMs < before) fs.unlinkSync(filename);
  }
}
function days(name: string, fallback: number) {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
