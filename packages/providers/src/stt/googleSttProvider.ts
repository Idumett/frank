import { v2 } from '@google-cloud/speech';
import type { SttProvider } from './SttProvider.js';
import type { Trace } from '@frank/contracts';

export class GoogleSttProvider implements SttProvider {
  private client: v2.SpeechClient;
  private recognizer: string;

  constructor() {
    this.client = new v2.SpeechClient();
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID ?? 'your-project-id';
    this.recognizer =
      process.env.GCP_STT_RECOGNIZER ??
      `projects/${projectId}/locations/global/recognizers/frank-default-v2`;
  }

  async transcribe(args: {
    trace: Trace;
    audioBytes: Buffer;
  }): Promise<{ transcript: string; confidence?: number }> {
    const [res] = await this.client.recognize({
      recognizer: this.recognizer,
      content: args.audioBytes,
    });

    // v2 nesting is slightly different: results -> alternatives
    const alt = res.results?.[0]?.alternatives?.[0];

    return {
      transcript: alt?.transcript ?? '',
      confidence: alt?.confidence ?? undefined,
    };
  }
}
