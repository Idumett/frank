import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteObservabilityStore } from '../src/observability/SqliteObservabilityStore.js';

function makeStore() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE request_traces (
      request_id TEXT PRIMARY KEY,
      session_id TEXT,
      source TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      total_ms INTEGER,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      stages_json TEXT NOT NULL
    )
  `);
  return { db, store: new SqliteObservabilityStore(db) };
}

describe('request diagnostics', () => {
  it('keeps stages when a route and the orchestrator share a trace', async () => {
    const { db, store } = makeStore();
    await store.start({
      requestId: 'req-12345678',
      sessionId: 'session-1',
      source: 'device_stream',
      startedAt: new Date(Date.now() - 20).toISOString(),
      input: { audioBytes: 100 },
      stages: [],
    });
    await Promise.all([
      store.addStage('req-12345678', { name: 'vision.ocr', startedAt: new Date().toISOString(), durationMs: 8, ok: true }),
      store.addStage('req-12345678', { name: 'vision.labels', startedAt: new Date().toISOString(), durationMs: 12, ok: true }),
    ]);
    await store.start({
      requestId: 'req-12345678',
      sessionId: 'session-1',
      source: 'analyze',
      startedAt: new Date().toISOString(),
      input: { hasImage: true },
      stages: [],
    });
    await store.finish('req-12345678', { speak: 'Done' });

    const trace = store.getByRequestId('req-12345678');
    expect(trace?.source).toBe('device_stream');
    expect(trace?.stages.map((stage) => stage.name)).toEqual(['vision.ocr', 'vision.labels']);

    const summary = store.getSummary();
    expect(summary.traces).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.failures).toBe(0);
    expect(summary.stages).toHaveLength(2);
    db.close();
  });

  it('starts clean when a completed request ID is reused', async () => {
    const { db, store } = makeStore();
    const first = { requestId: 'req-reused1', source: 'stt' as const, startedAt: '2026-08-13T10:00:00.000Z', stages: [] };
    await store.start(first);
    await store.addStage(first.requestId, { name: 'stt.transcribe', startedAt: first.startedAt, durationMs: 10, ok: false, error: 'failed' });
    await store.fail(first.requestId, 'failed');

    await store.start({ ...first, source: 'tts', startedAt: '2026-08-13T10:01:00.000Z' });
    const trace = store.getByRequestId(first.requestId);
    expect(trace).toMatchObject({ source: 'tts', startedAt: '2026-08-13T10:01:00.000Z', stages: [] });
    expect(trace?.endedAt).toBeUndefined();
    expect(trace?.error).toBeUndefined();
    db.close();
  });

  it('counts failed stages and failed requests', async () => {
    const { db, store } = makeStore();
    await store.start({ requestId: 'req-failed1', source: 'tts', startedAt: new Date().toISOString(), stages: [] });
    await store.addStage('req-failed1', { name: 'tts.synthesize', startedAt: new Date().toISOString(), durationMs: 15, ok: false, error: 'provider down' });
    await store.fail('req-failed1', 'provider down');

    const summary = store.getSummary();
    expect(summary.failures).toBe(1);
    expect(summary.successRate).toBe(0);
    expect(summary.stages[0]).toMatchObject({ name: 'tts.synthesize', failures: 1 });
    db.close();
  });
});
