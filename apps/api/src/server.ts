import 'dotenv/config';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import crypto from 'node:crypto';

import { MemoryItemSchema, UserRequestSchema } from '@frank/contracts';
import { deleteMemory, searchMemory, listRecent } from './memoryStore.js';
import { makeFrank } from './coreWiring.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  genReqId: (req) => {
    const incoming = req.headers['x-request-id'];
    if (typeof incoming === 'string' && incoming.length >= 8) return incoming;
    return crypto.randomUUID();
  },
});
const frank = makeFrank();

await app.register(sensible);

app.addHook('onSend', async (req, reply) => {
  reply.header('x-request-id', req.id);
});

app.get('/health', async () => ({ ok: true }));

app.post('/v1/analyze', async (req) => {
  const { z } = await import('zod');
  const BodySchema = UserRequestSchema.extend({
    imageBase64: z.string().min(10),
    wantAudio: z.boolean().default(false),
  });

  const body = BodySchema.parse(req.body);
  const imageBytes = Buffer.from(body.imageBase64, 'base64');

  const reply = await frank.handleUserRequest(body, imageBytes);
  return { trace: body.trace, reply };
});

app.post('/v1/memory/search', async (req) => {
  const { z } = await import('zod');

  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace,
    query: z.string().min(1),
    limit: z.number().min(1).max(50).default(10),
  });
  const body = BodySchema.parse(req.body);
  const matches = searchMemory(body.query).slice(0, body.limit);

  return {
    trace: body.trace,
    count: matches.length,
    items: matches.map((m) => MemoryItemSchema.parse(m)),
  };
});

app.post('/v1/memory/delete', async (req) => {
  const { z } = await import('zod');

  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace,
    ids: z.array(z.string().min(1)).min(1).max(100),
  });
  const body = BodySchema.parse(req.body);
  const deleted = deleteMemory(body.ids);

  return { trace: body.trace, deleted };
});

app.get('/v1/memory/recent', async (req) => {
  const limit = Number((req.query as any)?.limit ?? 10);
  const items = listRecent(Math.min(Math.max(limit, 1), 50));

  return { count: items.length, items };
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
