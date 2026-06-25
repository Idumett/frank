import type { ObservabilityStore, RequestTraceRecord, TraceStage } from './types.js';

export class NoopObservabilityStore implements ObservabilityStore {
  async start(_record: RequestTraceRecord): Promise<void> {}

  async addStage(_requestId: string, _stage: TraceStage): Promise<void> {}

  async finish(_requestId: string, _output: unknown): Promise<void> {}

  async fail(_requestId: string, _error: string): Promise<void> {}
}
