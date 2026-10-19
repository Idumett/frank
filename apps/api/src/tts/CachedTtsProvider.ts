import type { TtsProvider } from '@frank/providers';
import {
  TTS_CACHE_DIR,
  readCachedTts,
  ttsCacheKey,
  writeCachedTts,
} from '../ttsCache.js';

type SpeakArgs = Parameters<TtsProvider['speak']>[0];
type SpeakResult = Awaited<ReturnType<TtsProvider['speak']>>;

export class CachedTtsProvider implements TtsProvider {
  private readonly pending = new Map<string, Promise<SpeakResult>>();

  constructor(
    private readonly provider: TtsProvider,
    private readonly cacheDir = TTS_CACHE_DIR,
  ) {}

  async speak(args: SpeakArgs): Promise<SpeakResult> {
    const key = ttsCacheKey({
      text: args.text,
      voice: args.voiceName,
      languageCode: args.languageCode,
      speakingRate: args.speakingRate,
      pitch: args.pitch,
    });
    const cached = readCachedTts(key, this.cacheDir);
    if (cached) return { audioBytes: cached, mimeType: 'audio/mpeg', cacheStatus: 'hit' };

    const existing = this.pending.get(key);
    if (existing) {
      const result = await existing;
      return { ...result, cacheStatus: 'shared' };
    }

    const synthesis = this.synthesize(key, args);
    this.pending.set(key, synthesis);
    try {
      return await synthesis;
    } finally {
      if (this.pending.get(key) === synthesis) this.pending.delete(key);
    }
  }

  private async synthesize(key: string, args: SpeakArgs): Promise<SpeakResult> {
    const result = await this.provider.speak(args);
    writeCachedTts(key, result.audioBytes, this.cacheDir);
    return { ...result, cacheStatus: 'miss' };
  }
}
