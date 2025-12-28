import { z } from 'zod';

export const LabelSchema = z.object({
  name: z.string(),
  confidence: z.number().min(0).max(1),
});

export const PerceptionResultSchema = z.object({
  text: z.string().optional(),
  textConfidence: z.number().min(0).max(1).optional(),
  labels: z.array(LabelSchema).default([]),
  capturedAt: z.string(), // ISO string
  imageQuality: z.enum(['good', 'ok', 'poor']).default('ok'),
  provider: z.string().default('unknown'),
});

export type PerceptionResult = z.infer<typeof PerceptionResultSchema>;
