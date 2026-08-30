import type { FastifyInstance } from 'fastify';
import type { TraceFilters, TraceSource } from '@frank/core';
import type { SqliteObservabilityStore } from '../observability/SqliteObservabilityStore.js';

const sources: TraceSource[] = ['analyze', 'device_frame', 'device_stream', 'stt', 'tts'];

export async function diagRoutes(
  app: FastifyInstance,
  deps: { observability: SqliteObservabilityStore },
) {
  app.get('/v1/diag/traces', async (req) => {
    const filters = readFilters(req.query);
    return { traces: deps.observability.getRecent(filters) };
  });

  app.get('/v1/diag/summary', async (req) => {
    const filters = readFilters(req.query);
    return { filters, summary: deps.observability.getSummary(filters) };
  });

  app.get('/v1/diag/context-incidents', async (req) => {
    const filters = readFilters(req.query);
    return { filters, incidents: deps.observability.getContextIncidents(filters) };
  });

  app.get('/v1/diag/traces/:requestId', async (req, reply) => {
    const params = req.params as { requestId: string };
    const trace = deps.observability.getByRequestId(params.requestId);

    if (!trace) {
      return reply.code(404).send({ error: 'trace_not_found', requestId: params.requestId });
    }

    return { trace };
  });

  app.get('/v1/diag/session/:sessionId', async (req) => {
    const params = req.params as { sessionId: string };
    const q = req.query as { limit?: string };
    return {
      sessionId: params.sessionId,
      traces: deps.observability.getBySessionId(params.sessionId, clampLimit(q.limit, 30)),
    };
  });
}

function readFilters(raw: unknown): TraceFilters {
  const query = raw as {
    source?: string;
    sessionId?: string;
    success?: string;
    from?: string;
    to?: string;
    limit?: string;
  };

  return {
    source: sources.includes(query.source as TraceSource) ? query.source as TraceSource : undefined,
    sessionId: query.sessionId,
    success: query.success === 'true' ? true : query.success === 'false' ? false : undefined,
    from: validDate(query.from),
    to: validDate(query.to),
    limit: clampLimit(query.limit, 50),
  };
}

function validDate(value: string | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function clampLimit(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 200);
}
