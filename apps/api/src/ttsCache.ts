import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TTS_CACHE_DIR = process.env.TTS_CACHE_DIR ?? './data/tts-cache';

export function ensureTtsCacheDir(cacheDir = TTS_CACHE_DIR) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

export function ttsCacheKey(args: {
  text: string;
  voice?: string;
  languageCode?: string;
  speakingRate?: number;
  pitch?: number;
}) {
  const payload = JSON.stringify({
    text: args.text,
    voice: args.voice ?? '',
    languageCode: args.languageCode ?? '',
    speakingRate: args.speakingRate ?? null,
    pitch: args.pitch ?? null,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function ttsCachePath(key: string, cacheDir = TTS_CACHE_DIR) {
  return path.join(cacheDir, `${key}.mp3`);
}

export function readCachedTts(key: string, cacheDir = TTS_CACHE_DIR): Buffer | null {
  try {
    const audio = fs.readFileSync(ttsCachePath(key, cacheDir));
    return audio.length > 0 ? audio : null;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function writeCachedTts(key: string, audio: Buffer, cacheDir = TTS_CACHE_DIR) {
  if (audio.length === 0) throw new Error('Refusing to cache empty speech audio');
  ensureTtsCacheDir(cacheDir);
  const destination = ttsCachePath(key, cacheDir);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, audio, { flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
