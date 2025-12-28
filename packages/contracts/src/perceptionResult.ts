import { z } from 'zod';
import {
  ConfidenceSchema,
  ImageQualitySchema,
  IsoDateTimeSchema,
  ProviderIdSchema,
  TraceSchema,
} from './common.js';

export const LabelSchema = z.object({
  name: z.string().min(1),
  confidence: ConfidenceSchema.optional(),
});

export const OcrBlockSchema = z.object({
  text: z.string().min(1),
  confidence: ConfidenceSchema.optional(),
});

/**
 * Minimal perception result:
 * - OCR text (optional)
 * - Labels (optional)
 * - Quality summary
 */
export const PerceptionResultSchema = z.object({
  trace: TraceSchema,
  provider: ProviderIdSchema, // e.g. "gcv"
  capturedAt: IsoDateTimeSchema,
  imageQuality: ImageQualitySchema.default('ok'),
  imageQualityNotes: z.array(z.string()).default([]), // e.g. ["blurry", "low_light"]

  ocr: z
    .object({
      fullText: z.string().optional(),
      confidence: ConfidenceSchema.optional(),
      blocks: z.array(OcrBlockSchema).default([]),
    })
    .optional(),

  labels: z.array(LabelSchema).default([]),
});

export type PerceptionResult = z.infer<typeof PerceptionResultSchema>;
export type Label = z.infer<typeof LabelSchema>;
