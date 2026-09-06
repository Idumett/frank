import { v2 } from '@google-cloud/speech';
import type { Trace } from '@frank/contracts';
import type { SttProvider } from './SttProvider.js';

type RecognitionResult = {
  results?: Array<{
    alternatives?: Array<{
      transcript?: string | null;
      confidence?: number | null;
    }> | null;
  }> | null;
};

type RecognitionClient = {
  recognize(request: Record<string, unknown>): Promise<[RecognitionResult, ...unknown[]]>;
};

export class GoogleSttProvider implements SttProvider {
  private client: RecognitionClient;
  private recognizer: string;

  constructor(options: { client?: RecognitionClient; recognizer?: string } = {}) {
    this.client = options.client ?? (new v2.SpeechClient() as unknown as RecognitionClient);
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID ?? 'your-project-id';
    this.recognizer =
      options.recognizer ??
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
    const primaryModel = process.env.GCP_STT_MODEL ?? 'short';
    const fallbackModel = process.env.GCP_STT_FALLBACK_MODEL ?? 'long';
    const models = [...new Set([primaryModel, fallbackModel])];

    for (const model of models) {
      const [response] = await this.client.recognize({
        recognizer: this.recognizer,
        content: args.audioBytes,
        config: {
          autoDecodingConfig: {},
          languageCodes: [args.languageCode ?? 'en-GB'],
          model,
          features: {
            enableAutomaticPunctuation: true,
          },
          // Zero disables Google's pre-recognition low-SNR rejection. Frank's
          // users must not have to raise their voice to pass a server-side gate.
          denoiserConfig: {
            denoiseAudio: false,
            snrThreshold: 0,
          },
        },
        // The named recognizer has defaults. Explicitly replace them so a stale
        // cloud-side model or SNR setting cannot undo the per-request policy.
        configMask: { paths: ['*'] },
      });

      const result = transcriptFrom(response);
      if (result.transcript) return result;
    }

    return { transcript: '' };
  }
}

function transcriptFrom(response: RecognitionResult): {
  transcript: string;
  confidence?: number;
} {
  const alternatives = response.results?.flatMap((result) => result.alternatives ?? []) ?? [];
  const transcript = alternatives
    .map((alternative) => alternative.transcript ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const confidenceValues = alternatives
    .map((alternative) => alternative.confidence)
    .filter((confidence): confidence is number => typeof confidence === 'number');
  const confidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : undefined;

  return { transcript, confidence };
}
