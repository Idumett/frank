import type { FastifyInstance } from 'fastify';
import type { SqliteObservabilityStore } from '../observability/SqliteObservabilityStore.js';

export async function diagRoutes(
  app: FastifyInstance,
  deps: { observability: SqliteObservabilityStore },
) {
  app.get('/v1/diag/traces', async (req) => {
    const q = req.query as {
      limit?: string;
    };

    const limit = clampLimit(q.limit, 50);

    return {
      traces: deps.observability.getRecent(limit),
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
