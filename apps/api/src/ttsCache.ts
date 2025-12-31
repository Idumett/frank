import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = process.env.TTS_CACHE_DIR ?? './data/tts-cache';

export function ensureTtsCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function ttsCacheKey(args: { text: string; voice?: string; languageCode?: string }) {
  const payload = JSON.stringify({
    text: args.text,
    voice: args.voice ?? '',
    languageCode: args.languageCode ?? '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function ttsCachePath(key: string) {
  return path.join(CACHE_DIR, `${key}.mp3`);
}

export function readCachedTts(key: string): Buffer | null {
  const p = ttsCachePath(key);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

export function writeCachedTts(key: string, audio: Buffer) {
  fs.writeFileSync(ttsCachePath(key), audio);
}
