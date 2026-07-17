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
  mimeType?: string;
  languageCode?: string;
  sampleRateHertz?: number;
}): Promise<{ transcript: string; confidence?: number }> {
  const [res] = await this.client.recognize({
    recognizer: this.recognizer,
    content: args.audioBytes,
    config: {
      autoDecodingConfig: {},
      languageCodes: [args.languageCode ?? 'en-GB'],
      model: 'long',
    },
    // configMask: '*',
  });

  const alternatives =
    res.results?.flatMap(result => result.alternatives ?? []) ?? [];

  const transcript = alternatives
    .map(alternative => alternative.transcript ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const confidenceValues = alternatives
    .map(alternative => alternative.confidence)
    .filter(
      (confidence): confidence is number =>
        typeof confidence === 'number'
    );

  const confidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length
      : undefined;

  return {
    transcript,
    confidence,
  };
}
}
