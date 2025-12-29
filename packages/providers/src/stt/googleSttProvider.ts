import { SpeechClient } from '@google-cloud/speech';
import type { SttProvider } from './SttProvider.js';
import type { Trace } from '@frank/contracts';

export class GoogleSttProvider implements SttProvider {
  private client: SpeechClient;

  constructor() {
    this.client = new SpeechClient();
  }

  async transcribe(args: {
    trace: Trace;
    audioBytes: Buffer;
    mimeType: string;
    languageCode?: string;
    sampleRateHertz?: number;
  }): Promise<{ transcript: string; confidence?: number }> {
    const languageCode = args.languageCode ?? 'en-GB';

    // For V1 we assume LINEAR16 WAV or similar; refine later per our client capture.
    const [res] = await this.client.recognize({
      audio: { content: args.audioBytes.toString('base64') },
      config: {
        languageCode,
        encoding: 'LINEAR16',
        sampleRateHertz: args.sampleRateHertz ?? 16000,
      },
    });

    const alt = res.results?.[0]?.alternatives?.[0];
    return {
      transcript: alt?.transcript ?? '',
      confidence: alt?.confidence ?? undefined,
    };
  }
}
