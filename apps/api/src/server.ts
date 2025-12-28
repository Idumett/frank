import 'dotenv/config';
import Fastify from 'fastify';
import { PerceptionResultSchema, type PerceptionResult } from '@frank/contracts';

const app = Fastify({
  logger: true,
});

app.get('/health', async () => {
  return { ok: true };
});

// Temporary endpoint: returns a mocked PerceptionResult to prove the wiring works
app.post('/v1/analyze', async (_req, _reply) => {
  const result: PerceptionResult = {
    text: 'Hello from Frank (mock).',
    textConfidence: 0.99,
    labels: [{ name: 'demo', confidence: 1.0 }],
    capturedAt: new Date().toISOString(),
    imageQuality: 'good',
    provider: 'mock',
  };

  // Runtime validation (protects from bugs when providers change)
  return PerceptionResultSchema.parse(result);
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
