import { describe, expect, it, vi } from 'vitest';
import type { AssistantReply, MemoryItem, PerceptionResult, UserRequest } from '@frank/contracts';
import { BasicPolicyEngine, BasicQualityGater, FrankOrchestrator } from '@frank/core';
import type { ObservabilityStore, RequestTraceRecord, TraceStage } from '@frank/core';

class TraceRecorder implements ObservabilityStore {
  records = new Map<string, RequestTraceRecord>();
  async start(record: RequestTraceRecord) { this.records.set(record.requestId, record); }
  async addStage(requestId: string, stage: TraceStage) { this.records.get(requestId)?.stages.push(stage); }
  async finish(requestId: string, output: unknown) { const record = this.records.get(requestId)!; record.endedAt = new Date().toISOString(); record.output = output; }
  async fail(requestId: string, error: string) { const record = this.records.get(requestId)!; record.endedAt = new Date().toISOString(); record.error = error; }
}

function request(intent: UserRequest['intent'], utterance?: string): UserRequest {
  return {
    trace: { requestId: `request-${intent}`, sessionId: 'v1-test' },
    intent,
    modality: 'voice',
    utterance,
    hasImage: true,
    requestedAt: '2026-08-13T10:00:00.000Z',
  };
}

function makeFrank(overrides: { quality?: 'good' | 'poor'; failLlm?: boolean } = {}) {
  const traces = new TraceRecorder();
  const stored: MemoryItem[] = [];
  const llm = vi.fn(async (args: any): Promise<AssistantReply> => {
    if (overrides.failLlm) throw new Error('LLM unavailable');
    return {
      trace: args.trace,
      speak: 'A carton of milk is in front of you.',
      createdAt: args.now,
      suggestedAction: 'none',
      groundedIn: { usedOcr: true, usedLabels: true, usedMemoryHits: 0 },
    };
  });
  const perception = (trace: any, ocr?: string): PerceptionResult => ({
    trace,
    provider: 'gcv',
    capturedAt: '2026-08-13T10:00:00.000Z',
    imageQuality: 'good',
    imageQualityNotes: [],
    ocr: { fullText: ocr, blocks: [] },
    labels: [{ name: 'carton', confidence: 0.9 }],
  });
  const frank = new FrankOrchestrator({
    vision: {
      analyzeOCR: async ({ trace }: any) => perception(trace, overrides.quality === 'poor' ? undefined : 'MILK'),
      analyzeLabels: async ({ trace }: any) => overrides.quality === 'poor'
        ? { ...perception(trace), labels: [] }
        : perception(trace),
    },
    llm: { generateReply: llm },
    memory: {
      add: async (item: MemoryItem) => { stored.push(item); },
      search: async () => [],
      recent: async () => [],
      delete: async () => 0,
    },
    conversation: { getRecent: async () => [], addTurn: async () => {} },
    observability: traces,
    policy: new BasicPolicyEngine(),
    quality: {
      assess: async () => ({ imageQuality: overrides.quality ?? 'good', notes: overrides.quality === 'poor' ? ['very_small_image'] : [] }),
    },
  });
  return { frank, traces, stored, llm };
}

describe('V1 orchestrator', () => {
  it('produces a grounded reply and records the processing stages', async () => {
    const { frank, traces, llm } = makeFrank();
    const reply = await frank.handleUserRequest(request('describe_scene', 'What is here?'), Buffer.alloc(20_000, 120));
    expect(reply.speak).toContain('milk');
    expect(llm).toHaveBeenCalledOnce();
    expect(traces.records.get('request-describe_scene')?.stages.map((stage) => stage.name)).toEqual(expect.arrayContaining(['quality.assess', 'vision.ocr', 'vision.labels', 'llm.generate_reply']));
  });

  it('asks for another image without calling the LLM when evidence is unusable', async () => {
    const { frank, llm } = makeFrank({ quality: 'poor' });
    const reply = await frank.handleUserRequest(request('read_text'), Buffer.alloc(100));
    expect(reply.suggestedAction).toBe('recapture');
    expect(llm).not.toHaveBeenCalled();
  });

  it('stores a useful memory only for the remember intent', async () => {
    const { frank, stored } = makeFrank();
    await frank.handleUserRequest(request('remember_this', 'Remember this milk.'), Buffer.alloc(20_000, 120));
    expect(stored).toHaveLength(1);
    expect(stored[0].trace?.requestId).toBe('request-remember_this');
  });

  it('finishes a failed trace when the LLM provider throws', async () => {
    const { frank, traces } = makeFrank({ failLlm: true });
    await expect(frank.handleUserRequest(request('help', 'Help me.'), Buffer.alloc(20_000, 120))).rejects.toThrow('LLM unavailable');
    expect(traces.records.get('request-help')?.error).toBe('LLM unavailable');
  });

  it('marks an empty image as poor instead of dividing by zero', async () => {
    await expect(new BasicQualityGater().assess(Buffer.alloc(0))).resolves.toEqual({ imageQuality: 'poor', notes: ['empty_image'] });
  });
});
