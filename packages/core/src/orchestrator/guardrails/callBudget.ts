export class CallBudget {
  private visionCalls = 0;
  private llmCalls = 0;

  constructor(private limits: { maxVisionCalls: number; maxLlmCalls: number }) {}

  useVisionCall() {
    this.visionCalls += 1;
    if (this.visionCalls > this.limits.maxVisionCalls) {
      throw new Error('Call budget exceeded: vision');
    }
  }

  useLlmCall() {
    this.llmCalls += 1;
    if (this.llmCalls > this.limits.maxLlmCalls) {
      throw new Error('Call budget exceeded: llm');
    }
  }

  snapshot() {
    return { visionCalls: this.visionCalls, llmCalls: this.llmCalls };
  }
}
