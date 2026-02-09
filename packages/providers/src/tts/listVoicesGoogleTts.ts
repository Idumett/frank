import { TextToSpeechClient } from '@google-cloud/text-to-speech';

export type TtsVoice = {
  name: string;
  languageCodes: string[];
  ssmlGender?: string;
  naturalSampleRateHertz?: number;
};

type ListVoicesArgs = {
  languageCode?: string; // e.g. "en-GB"
  cacheTtlMs?: number; // default 24h
};

const client = new TextToSpeechClient();

// Simple in-memory cache (process-local)
let cache: { at: number; voices: TtsVoice[] } | null = null;

export async function listVoicesGoogleTts(args: ListVoicesArgs = {}): Promise<TtsVoice[]> {
  const ttl = args.cacheTtlMs ?? 24 * 60 * 60 * 1000;

  if (cache && Date.now() - cache.at < ttl) {
    return filter(cache.voices, args.languageCode);
  }

  const [res] = await client.listVoices({});
  const voices: TtsVoice[] = (res.voices ?? [])
    .filter((v) => !!v.name)
    .map((v) => ({
      name: v.name!,
      languageCodes: v.languageCodes ?? [],
      ssmlGender: v.ssmlGender?.toString(),
      naturalSampleRateHertz: v.naturalSampleRateHertz ?? undefined,
    }));

  cache = { at: Date.now(), voices };

  return filter(voices, args.languageCode);
}

export function clearVoicesCache() {
  cache = null;
}

function filter(voices: TtsVoice[], languageCode?: string): TtsVoice[] {
  if (!languageCode) return voices;
  return voices.filter((v) => v.languageCodes.includes(languageCode));
}
