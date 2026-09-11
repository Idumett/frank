import { z } from 'zod';
import { IsoDateTimeSchema, TraceSchema } from './common.js';
import { SelectedContextV1Schema } from './contextSnapshotV1.js';

export const IntentSchema = z.enum([
  'read_text', // OCR-focused
  'describe_scene', // object/label-focused
  'remember_this', // store current observation
  'recall', // search memory
  'help', // general help / commands
]);

export const InputModalitySchema = z.enum(['voice', 'button', 'app', 'unknown']);

export const UserRequestSchema = z.object({
  trace: TraceSchema,
  intent: IntentSchema,
  modality: InputModalitySchema.default('unknown'),

  /** Raw user utterance if intent came from voice */
  utterance: z.string().optional(),

  /**
   * If the request includes an image capture (most will), you can reference it.
   * The actual image bytes/file live outside the contract (transport layer).
   */
  hasImage: z.boolean().default(true),

  imageEvidence: z
    .object({
      frameId: z.string().min(8),
      capturedAt: IsoDateTimeSchema,
      ageMs: z.number().int().min(0),
      clientQuality: z.enum(['unknown', 'good', 'poor']).default('unknown'),
    })
    .optional(),

  /** Optional query for recall/search intent */
  query: z.string().optional(),

  /** Semantic retrieval terms selected for this turn without changing its intent. */
  memoryQuery: z.string().max(200).optional(),

  requestedAt: IsoDateTimeSchema,
  context: SelectedContextV1Schema.optional(),
});

export type UserRequest = z.infer<typeof UserRequestSchema>;
export type Intent = z.infer<typeof IntentSchema>;
