import type { PerceptionResult, ToolDecision, Trace } from '@frank/contracts';

export interface LlmProvider {
  decideToolOrAnswer(args: {
    trace: Trace;
    userUtterance?: string;
    perception: PerceptionResult;
    memoryHits: string[];
    conversationContext?: string;
    availableTools: { name: string; description: string }[];
    now: string;
  }): Promise<ToolDecision>;
}
