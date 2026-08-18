import type { ObservabilityStore, RequestTraceRecord, TraceFilters, TraceStage } from '@frank/core';

type DbLike = {
  prepare: (sql: string) => any;
};

export class SqliteObservabilityStore implements ObservabilityStore {
  constructor(private db: DbLike) {}

  async start(record: RequestTraceRecord): Promise<void> {
    const owner = this.db.prepare('SELECT user_id FROM request_traces WHERE request_id = ?').get(record.requestId);
    if (owner && owner.user_id !== (record.userId ?? 'legacy')) throw new Error('Request ID already belongs to another user');
    this.db
      .prepare(
        `
          INSERT OR REPLACE INTO request_traces (
            request_id,
            user_id,
            session_id,
            source,
            started_at,
            ended_at,
            total_ms,
            input_json,
            output_json,
            error,
            stages_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(request_id) DO UPDATE SET
            user_id = excluded.user_id,
            session_id = CASE
              WHEN request_traces.ended_at IS NULL THEN COALESCE(request_traces.session_id, excluded.session_id)
              ELSE excluded.session_id
            END,
            source = CASE
              WHEN request_traces.ended_at IS NULL THEN COALESCE(request_traces.source, excluded.source)
              ELSE excluded.source
            END,
            started_at = CASE
              WHEN request_traces.ended_at IS NULL THEN request_traces.started_at
              ELSE excluded.started_at
            END,
            ended_at = CASE WHEN request_traces.ended_at IS NULL THEN request_traces.ended_at ELSE NULL END,
            total_ms = CASE WHEN request_traces.ended_at IS NULL THEN request_traces.total_ms ELSE NULL END,
            input_json = CASE
              WHEN request_traces.ended_at IS NULL THEN COALESCE(request_traces.input_json, excluded.input_json)
              ELSE excluded.input_json
            END,
            output_json = CASE WHEN request_traces.ended_at IS NULL THEN request_traces.output_json ELSE NULL END,
            error = CASE WHEN request_traces.ended_at IS NULL THEN request_traces.error ELSE NULL END,
            stages_json = CASE
              WHEN request_traces.ended_at IS NULL THEN request_traces.stages_json
              ELSE excluded.stages_json
            END
        `,
      )
      .run(
        record.requestId,
        record.userId ?? 'legacy',
        record.sessionId ?? null,
        record.source ?? null,
        record.startedAt,
        record.endedAt ?? null,
        record.totalMs ?? null,
        safeJson(record.input),
        record.output ? safeJson(record.output) : null,
        record.error ?? null,
        safeJson(record.stages ?? []),
      );
  }

  async addStage(requestId: string, stage: TraceStage): Promise<void> {
    this.db
      .prepare(
        `
          UPDATE request_traces
          SET stages_json = json_insert(
            COALESCE(stages_json, '[]'),
            '$[#]',
            json(?)
          )
          WHERE request_id = ?
        `,
      )
      .run(safeJson(stage), requestId);
  }

  async finish(requestId: string, output: unknown): Promise<void> {
    const row = this.db
      .prepare(
        `
          SELECT started_at
          FROM request_traces
          WHERE request_id = ?
        `,
      )
      .get(requestId);

    const endedAt = new Date().toISOString();
    const totalMs = row?.started_at ? Date.now() - new Date(row.started_at).getTime() : null;

    this.db
      .prepare(
        `
          UPDATE request_traces
          SET ended_at = ?, total_ms = ?, output_json = ?, error = NULL
          WHERE request_id = ?
        `,
      )
      .run(endedAt, totalMs, safeJson(output), requestId);
  }

  async fail(requestId: string, error: string): Promise<void> {
    const row = this.db
      .prepare(
        `
          SELECT started_at
          FROM request_traces
          WHERE request_id = ?
        `,
      )
      .get(requestId);

    const endedAt = new Date().toISOString();
    const totalMs = row?.started_at ? Date.now() - new Date(row.started_at).getTime() : null;

    this.db
      .prepare(
        `
          UPDATE request_traces
          SET ended_at = ?, total_ms = ?, error = ?
          WHERE request_id = ?
        `,
      )
      .run(endedAt, totalMs, error, requestId);
  }

  getRecent(filters: TraceFilters = {}): RequestTraceRecord[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.source) {
      conditions.push('source = ?');
      values.push(filters.source);
    }

    if (filters.sessionId) {
      conditions.push('session_id = ?');
      values.push(filters.sessionId);
    }

    if (filters.success !== undefined) {
      conditions.push(filters.success ? 'error IS NULL' : 'error IS NOT NULL');
    }

    if (filters.from) {
      conditions.push('started_at >= ?');
      values.push(filters.from);
    }

    if (filters.to) {
      conditions.push('started_at <= ?');
      values.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limit = Math.min(filters.limit ?? 50, 200);

    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM request_traces
        ${where}
        ORDER BY started_at DESC
        LIMIT ?
        `,
      )
      .all(...values, limit);

    return rows.map(rowToTrace);
  }

  getSummary(filters: TraceFilters = {}) {
    const traces = this.getRecent({ ...filters, limit: Math.min(filters.limit ?? 200, 200) });
    const stageMap = new Map<string, { durations: number[]; failures: number }>();

    for (const trace of traces) {
      for (const stage of trace.stages) {
        const current = stageMap.get(stage.name) ?? { durations: [], failures: 0 };
        if (typeof stage.durationMs === 'number') current.durations.push(stage.durationMs);
        if (!stage.ok) current.failures += 1;
        stageMap.set(stage.name, current);
      }
    }

    const stages = [...stageMap.entries()].map(([name, value]) => ({
      name,
      calls: value.durations.length,
      failures: value.failures,
      minMs: percentile(value.durations, 0),
      avgMs: average(value.durations),
      p50Ms: percentile(value.durations, 0.5),
      p95Ms: percentile(value.durations, 0.95),
      maxMs: percentile(value.durations, 1),
    })).sort((a, b) => b.avgMs - a.avgMs);

    const completed = traces.filter((trace) => trace.endedAt);
    const failed = traces.filter((trace) => trace.error);
    const totals = completed.flatMap((trace) =>
      typeof trace.totalMs === 'number' ? [trace.totalMs] : [],
    );

    return {
      traces: traces.length,
      completed: completed.length,
      inFlight: traces.length - completed.length,
      failures: failed.length,
      successRate: completed.length === 0
        ? null
        : Math.round(((completed.length - failed.length) / completed.length) * 1000) / 10,
      totalMs: {
        avg: average(totals),
        p50: percentile(totals, 0.5),
        p95: percentile(totals, 0.95),
        max: percentile(totals, 1),
      },
      stages,
    };
  }

  getByRequestId(requestId: string): RequestTraceRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM request_traces
          WHERE request_id = ?
        `,
      )
      .get(requestId);

    return row ? rowToTrace(row) : null;
  }

  getBySessionId(sessionId: string, limit = 30): RequestTraceRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM request_traces
          WHERE session_id = ?
          ORDER BY started_at DESC
          LIMIT ?
        `,
      )
      .all(sessionId, limit);

    return rows.map(rowToTrace);
  }
}

function rowToTrace(row: any): RequestTraceRecord {
  return {
    requestId: row.request_id,
    userId: row.user_id,
    sessionId: row.session_id ?? undefined,
    source: row.source ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    totalMs: row.total_ms ?? undefined,
    input: safeParse(row.input_json, undefined),
    output: safeParse(row.output_json, undefined),
    error: row.error ?? undefined,
    stages: safeParse(row.stages_json, []),
  };
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(Math.floor(sorted.length * ratio), sorted.length - 1)];
}
