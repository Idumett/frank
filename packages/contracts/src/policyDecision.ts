import { z } from 'zod';
import { ConfidenceSchema, TraceSchema } from './common.js';

export const NextActionSchema = z.enum([
  'proceed',
  'request_recapture',
  'ask_clarifying_question',
  'skip_call_too_expensive',
]);

export const PolicyDecisionSchema = z.object({
  trace: TraceSchema,

  nextAction: NextActionSchema,

  /** Overall confidence Frank has in proceeding */
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),

  /** Reasons for logs / debugging / future UX */
  reasons: z.array(z.string()).default([]),

  /** If we want user to re-capture */
  recapturePrompt: z.string().optional(),

  /** Cost controls */
  estimatedCostUnits: z.number().min(0).default(0), // our own internal "units"
  allowVisionCalls: z.boolean().default(true),
  allowLlmCall: z.boolean().default(true),

  /** Should we store memory automatically? */
  shouldStore: z.boolean().default(false),
  requireUserConfirmToStore: z.boolean().default(true),

  /** Optional numeric thresholds we computed (helpful but not required) */
  ocrConfidence: ConfidenceSchema.optional(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type NextAction = z.infer<typeof NextActionSchema>;
