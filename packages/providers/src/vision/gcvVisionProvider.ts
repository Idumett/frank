import { ImageAnnotatorClient } from '@google-cloud/vision';
import { PerceptionResultSchema, type PerceptionResult, type Trace } from '@frank/contracts';
import type { VisionProvider } from './VisionProvider.js';

type VisionClient = {
  documentTextDetection(
    request: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<[any, ...unknown[]]>;
  labelDetection(
    request: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<[any, ...unknown[]]>;
};

export class GcvVisionProvider implements VisionProvider {
  private client: VisionClient;

  constructor(client?: VisionClient) {
    this.client = client ?? (new ImageAnnotatorClient() as unknown as VisionClient);
  }

  async analyzeOCR(args: {
    trace: Trace;
    imageBytes: Buffer;
    capturedAt: string;
  }): Promise<PerceptionResult> {
    const [res] = await this.client.documentTextDetection({
      image: { content: args.imageBytes.toString('base64') },
    }, providerOptions());

    const fullText = res.fullTextAnnotation?.text ?? undefined;

    const mapped: PerceptionResult = {
      trace: args.trace,
      provider: 'gcv',
      capturedAt: args.capturedAt,
      imageQuality: 'ok',
      imageQualityNotes: [],
      ocr: {
        fullText,
        confidence: undefined, // GCV doesn't always give a single scalar
        blocks: [],
      },
      labels: [],
    };

    return PerceptionResultSchema.parse(mapped);
  }

  async analyzeLabels(args: {
    trace: Trace;
    imageBytes: Buffer;
    capturedAt: string;
  }): Promise<PerceptionResult> {
    const [res] = await this.client.labelDetection({
      image: { content: args.imageBytes.toString('base64') },
    }, providerOptions());

    const labels =
      res.labelAnnotations?.slice(0, 10).map((l: { description?: string | null; score?: number | null }) => ({
        name: l.description ?? 'unknown',
        confidence: typeof l.score === 'number' ? l.score : undefined,
      })) ?? [];

    const mapped: PerceptionResult = {
      trace: args.trace,
      provider: 'gcv',
      capturedAt: args.capturedAt,
      imageQuality: 'ok',
      imageQualityNotes: [],
      labels,
    };

    return PerceptionResultSchema.parse(mapped);
  }
}

function providerOptions() {
  const parsed = Number(process.env.VISION_PROVIDER_TIMEOUT_MS);
  return { timeout: Number.isInteger(parsed) && parsed > 0 ? parsed : 9_000 };
}
