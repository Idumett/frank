import { z } from 'zod';

export const ToolAnswerSchema = z.object({
  type: z.literal('answer'),
  speak: z.string().min(1),
});

export const ToolCallSchema = z.object({
  type: z.literal('tool_call'),
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
});

export const ToolDecisionSchema = z.discriminatedUnion('type', [ToolAnswerSchema, ToolCallSchema]);

export type ToolAnswer = z.infer<typeof ToolAnswerSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolDecision = z.infer<typeof ToolDecisionSchema>;
