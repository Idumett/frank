import type { FastifyInstance } from 'fastify';
import type { SqliteObservabilityStore } from '../observability/SqliteObservabilityStore.js';

export async function diagRoutes(
  app: FastifyInstance,
  deps: { observability: SqliteObservabilityStore },
) {
  app.get('/v1/diag/traces', async (req) => {
    const query = req.query as {
      source?: 'analyze' | 'device_frame' | 'device_stream';
      sessionId?: string;
      success?: string;
      from?: string;
      to?: string;
      limit?: string;
    };

    return {
      traces: deps.observability.getRecent({
        source: query.source,
        sessionId: query.sessionId,
        success: query.success === undefined ? undefined : query.success === 'true',
        from: query.from,
        to: query.to,
        limit: clampLimit(query.limit, 50),
      }),
    };
  });

  app.get('/v1/diag/traces/:requestId', async (req, reply) => {
    const params = req.params as {
      requestId: string;
    };

    const trace = deps.observability.getByRequestId(params.requestId);

    if (!trace) {
      return reply.code(404).send({
        error: 'trace_not_found',
        requestId: params.requestId,
      });
    }

    return { trace };
  });

  app.get('/v1/diag/session/:sessionId', async (req) => {
    const params = req.params as {
      sessionId: string;
    };

    const q = req.query as {
      limit?: string;
    };

    const limit = clampLimit(q.limit, 30);

    return {
      sessionId: params.sessionId,
      traces: deps.observability.getBySessionId(params.sessionId, limit),
    };
  });
}

function clampLimit(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;

  return Math.min(parsed, 200);
}
