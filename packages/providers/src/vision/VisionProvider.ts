import type { PerceptionResult, Trace } from '@frank/contracts';

export interface VisionProvider {
  analyzeOCR(args: {
    trace: Trace;
    imageBytes: Buffer;
    capturedAt: string;
  }): Promise<PerceptionResult>;
  analyzeLabels(args: {
    trace: Trace;
    imageBytes: Buffer;
    capturedAt: string;
  }): Promise<PerceptionResult>;
}
