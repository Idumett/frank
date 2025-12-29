import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { TtsProvider } from './TtsProvider.js';
import type { Trace } from '@frank/contracts';

export class GoogleTtsProvider implements TtsProvider {
  private client: TextToSpeechClient;

  constructor() {
    this.client = new TextToSpeechClient();
  }

  async speak(args: {
    trace: Trace;
    text: string;
    languageCode?: string;
    voiceName?: string;
  }): Promise<{ audioBytes: Buffer; mimeType: string }> {
    const languageCode = args.languageCode ?? 'en-GB';

    const [response] = await this.client.synthesizeSpeech({
      input: { text: args.text },
      voice: {
        languageCode,
        name: args.voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3',
      },
    });

    const audioContent = response.audioContent;
    if (!audioContent) throw new Error('TTS: empty audioContent');

    // audioContent can be string or Buffer depending on runtime
    const audioBytes = Buffer.isBuffer(audioContent)
      ? audioContent
      : Buffer.from(audioContent as any, 'base64');

    return { audioBytes, mimeType: 'audio/mpeg' };
  }
}
