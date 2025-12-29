import type { AssistantReply, PerceptionResult, Trace } from '@frank/contracts';

export interface LlmProvider {
  generateReply(args: {
    trace: Trace;
    userUtterance?: string;
    perception: PerceptionResult;
    memoryHits: string[];
    now: string;
  }): Promise<AssistantReply>;
}
