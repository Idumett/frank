import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { TtsProvider } from './TtsProvider.js';
import type { Trace } from '@frank/contracts';

type SynthesisClient = {
  synthesizeSpeech(
    request: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<[{ audioContent?: string | Uint8Array | null }, ...unknown[]]>;
};

export class GoogleTtsProvider implements TtsProvider {
  private client: SynthesisClient;

  constructor(client?: SynthesisClient) {
    this.client = client ?? (new TextToSpeechClient() as unknown as SynthesisClient);
  }

  async speak(args: {
    trace: Trace;
    text: string;
    languageCode?: string;
    voiceName?: string;
    speakingRate?: number;
    pitch?: number;
  }): Promise<{ audioBytes: Buffer; mimeType: string }> {
    const voice =
      args.voiceName && args.voiceName.trim().length > 0
        ? { languageCode: args.languageCode, name: args.voiceName }
        : { languageCode: args.languageCode };

    const [response] = await this.client.synthesizeSpeech({
      input: { text: args.text },
      voice,
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: args.speakingRate,
        pitch: args.pitch,
      },
    }, { timeout: positiveInt(process.env.TTS_PROVIDER_TIMEOUT_MS, 12_000) });

    const audioContent = response.audioContent;
    if (!audioContent) throw new Error('TTS: empty audioContent');

    // audioContent can be string or Buffer depending on runtime
    const audioBytes = Buffer.isBuffer(audioContent)
      ? audioContent
      : Buffer.from(audioContent as any, 'base64');

    return { audioBytes, mimeType: 'audio/mpeg' };
  }
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
