import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { TtsProvider } from '@frank/providers';
import { CachedTtsProvider } from '../src/tts/CachedTtsProvider.js';
import { ttsCacheKey } from '../src/ttsCache.js';

const trace = { requestId: 'request-12345678', sessionId: 'session-12345678' };

test('coalesces identical synthesis requests and reuses the finished audio', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-tts-'));
  let calls = 0;
  const provider: TtsProvider = {
    async speak() {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { audioBytes: Buffer.from('speech'), mimeType: 'audio/mpeg' };
    },
  };
  const cached = new CachedTtsProvider(provider, cacheDir);

  try {
    const [first, second] = await Promise.all([
      cached.speak({ trace, text: 'Careful, there is a step ahead.' }),
      cached.speak({ trace, text: 'Careful, there is a step ahead.' }),
    ]);
    const third = await cached.speak({ trace, text: 'Careful, there is a step ahead.' });

    expect(calls).toBe(1);
    expect(new Set([first.cacheStatus, second.cacheStatus])).toEqual(new Set(['miss', 'shared']));
    expect(third.cacheStatus).toBe('hit');
    expect(third.audioBytes.toString()).toBe('speech');
    expect(fs.readdirSync(cacheDir).map((name) => path.extname(name))).toEqual(['.mp3']);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('cache identity includes every setting that changes generated speech', () => {
  const base = { text: 'Hello', voice: 'en-GB-Neural2-B', languageCode: 'en-GB' };
  const keys = new Set([
    ttsCacheKey(base),
    ttsCacheKey({ ...base, speakingRate: 1.1 }),
    ttsCacheKey({ ...base, pitch: 1 }),
    ttsCacheKey({ ...base, voice: 'en-GB-Neural2-A' }),
  ]);
  expect(keys.size).toBe(4);
});
