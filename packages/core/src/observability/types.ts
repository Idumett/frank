export type TraceStage = {
  name: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type RequestTraceRecord = {
  requestId: string;
  sessionId?: string;
  source?: 'analyze' | 'device_frame' | 'device_stream';
  startedAt: string;
  endedAt?: string;
  totalMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  stages: TraceStage[];
};

export interface ObservabilityStore {
  start(record: RequestTraceRecord): Promise<void>;
  addStage(requestId: string, stage: TraceStage): Promise<void>;
  finish(requestId: string, output: unknown): Promise<void>;
  fail(requestId: string, error: string): Promise<void>;
}
