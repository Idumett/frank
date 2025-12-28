import { z } from 'zod';
import { IsoDateTimeSchema, TraceSchema } from './common.js';

export const AssistantActionSchema = z.enum([
  'none',
  'store_memory',
  'repeat',
  'recapture',
  'search_memory',
]);

export const AssistantReplySchema = z.object({
  trace: TraceSchema,

  /** Primary speech output */
  speak: z.string().min(1),

  /** Optional: shorter version for quick mode */
  speakShort: z.string().optional(),

  /** If Frank wants user input next */
  followUpQuestion: z.string().optional(),

  /** Action hint for the client/app */
  suggestedAction: AssistantActionSchema.default('none'),

  /** Useful metadata (not spoken) */
  createdAt: IsoDateTimeSchema,

  /** If this reply is grounded in something, summarize it here */
  groundedIn: z
    .object({
      usedOcr: z.boolean().default(false),
      usedLabels: z.boolean().default(false),
      usedMemoryHits: z.number().min(0).default(0),
    })
    .default({ usedOcr: false, usedLabels: false, usedMemoryHits: 0 }),
});

export type AssistantReply = z.infer<typeof AssistantReplySchema>;
export type AssistantAction = z.infer<typeof AssistantActionSchema>;
