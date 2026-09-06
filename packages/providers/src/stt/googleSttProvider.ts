import { v1, v2 } from '@google-cloud/speech';
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
  private fallbackClient: RecognitionClient;
  private recognizer: string;

  constructor(
    options: {
      client?: RecognitionClient;
      fallbackClient?: RecognitionClient;
      recognizer?: string;
    } = {},
  ) {
    this.client = options.client ?? (new v2.SpeechClient() as unknown as RecognitionClient);
    this.fallbackClient =
      options.fallbackClient ?? (new v1.SpeechClient() as unknown as RecognitionClient);
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
    let lastError: unknown;

    for (const model of models) {
      try {
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
          },
          configMask: { paths: ['*'] },
        });

        const result = transcriptFrom(response);
        if (result.transcript) return result;
      } catch (error) {
        lastError = error;
      }
    }

    // V1 uses a separate recognizer path. It is deliberately kept as the last
    // attempt because it has proved more tolerant of quiet, short commands than
    // an empty V2 result on some microphones.
    try {
      const [response] = await this.fallbackClient.recognize({
        audio: { content: args.audioBytes },
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: args.sampleRateHertz ?? 16_000,
          languageCode: args.languageCode ?? 'en-GB',
          alternativeLanguageCodes: ['en-US'],
          model: process.env.GCP_STT_V1_FALLBACK_MODEL ?? 'command_and_search',
          enableAutomaticPunctuation: true,
        },
      });
      return transcriptFrom(response);
    } catch (error) {
      if (lastError) throw new AggregateError([lastError, error], 'Speech recognition failed');
      throw error;
    }
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
