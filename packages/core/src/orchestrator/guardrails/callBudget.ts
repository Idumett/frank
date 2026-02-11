type BudgetLimits = { maxVisionCalls: number; maxLlmCalls: number };

export class CallBudget {
  private visionCalls = 0;
  private llmCalls = 0;

  constructor(private limits: BudgetLimits) {}

  canCallVision() {
    return this.visionCalls < this.limits.maxVisionCalls;
  }

  canCallLlm() {
    return this.llmCalls < this.limits.maxLlmCalls;
  }

  recordVisionCall() {
    this.visionCalls++;
  }

  recordLlmCall() {
    this.llmCalls++;
  }

  snapshot() {
    return {
      visionCalls: this.visionCalls,
      llmCalls: this.llmCalls,
      limits: this.limits,
    };
  }
}
