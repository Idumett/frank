import { ImageAnnotatorClient } from '@google-cloud/vision';
import { PerceptionResultSchema, type PerceptionResult, type Trace } from '@frank/contracts';
import type { VisionProvider } from './VisionProvider.js';

export class GcvVisionProvider implements VisionProvider {
  private client: ImageAnnotatorClient;

  constructor() {
    this.client = new ImageAnnotatorClient();
  }

  async analyzeOCR(args: {
    trace: Trace;
    imageBytes: Buffer;
    capturedAt: string;
  }): Promise<PerceptionResult> {
    const [res] = await this.client.documentTextDetection({
      image: { content: args.imageBytes.toString('base64') },
    });

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
    });

    const labels =
      res.labelAnnotations?.slice(0, 10).map((l) => ({
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
