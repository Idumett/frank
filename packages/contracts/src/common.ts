import { z } from 'zod';

/** ISO 8601 timestamp string */
export const IsoDateTimeSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid ISO datetime');

export const ConfidenceSchema = z.number().min(0).max(1);

export const ProviderIdSchema = z.string().min(1); // e.g. "gcv", "openai", "azure"

export const ImageQualitySchema = z.enum(['good', 'ok', 'poor']);

/** Useful for tracing requests across modules */
export const TraceSchema = z.object({
  requestId: z.string().min(8),
  sessionId: z.string().min(1).optional(), // for multi-turn voice sessions
});

export type Trace = z.infer<typeof TraceSchema>;
