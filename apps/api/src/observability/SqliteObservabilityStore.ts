import type { ObservabilityStore, RequestTraceRecord, TraceFilters, TraceStage } from '@frank/core';

type DbLike = {
  prepare: (sql: string) => any;
};

export class SqliteObservabilityStore implements ObservabilityStore {
  constructor(private db: DbLike) {}

  async start(record: RequestTraceRecord): Promise<void> {
    this.db
      .prepare(
        `
          INSERT OR REPLACE INTO request_traces (
            request_id,
            session_id,
            source,
            started_at,
            ended_at,
            total_ms,
            input_json,
            output_json,
            error,
            stages_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.requestId,
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
    const row = this.db
      .prepare(
        `
          SELECT stages_json
          FROM request_traces
          WHERE request_id = ?
        `,
      )
      .get(requestId);

    const stages: TraceStage[] = row?.stages_json ? safeParse(row.stages_json, []) : [];

    stages.push(stage);

    this.db
      .prepare(
        `
          UPDATE request_traces
          SET stages_json = ?
          WHERE request_id = ?
        `,
      )
      .run(safeJson(stages), requestId);
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

  getRecent(filters: TraceFilters = {}) {
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

  getByRequestId(requestId: string) {
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

  getBySessionId(sessionId: string, limit = 30) {
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

function rowToTrace(row: any) {
  return {
    requestId: row.request_id,
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
