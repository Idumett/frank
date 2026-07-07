import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import crypto from 'node:crypto';
import sharp from 'sharp';

import {
  AssistantReplySchema,
  MemoryItem,
  MemoryItemSchema,
  UserRequestSchema,
} from '@frank/contracts';
import { makeFrank } from './coreWiring.js';
import { migrate } from './db/migrate.js';
import { SqliteMemoryStore } from './db/sqliteMemoryStore.js';
import { UserPrefsStore } from './prefs/UserPrefsStore.js';
import { checkCooldown } from './rateLimit.js';

import { sttRoutes } from './routes/stt.js';
import { ttsRoutes } from './routes/tts.js';
import { deviceRoutes } from './routes/device.js';
import { deviceStreamRoutes } from './routes/deviceStream.js';
import { prefsTtsRoutes } from './routes/prefs.js';
import { ttsVoicesRoutes } from './routes/ttsVoices.js';
import { diagRoutes } from './routes/diag.js';
import { GoogleSttProvider, GoogleTtsProvider } from '@frank/providers';
import { NoopObservabilityStore } from '@frank/core';
import { SqliteObservabilityStore } from './observability/SqliteObservabilityStore.js';
import { SqliteConversationStore } from './conversation/SqliteConversationStore.js';

migrate();
const sqlite = new SqliteMemoryStore();
const memoryStore = {
  add: async (item: MemoryItem) => sqlite.add(item),
  search: async (query: string, limit: number) => sqlite.search(query, { limit }),
  recent: (limit: number) => sqlite.recent(limit),
  delete: (ids: string[]) => sqlite.delete(ids),
};
const prefs = new UserPrefsStore(sqlite.rawDb);
const conversationStore = new SqliteConversationStore(sqlite.rawDb);
const observabilityStore =
  process.env.OBSERVABILITY_ENABLED === 'true'
    ? new SqliteObservabilityStore(sqlite.rawDb)
    : new NoopObservabilityStore();
const frank = makeFrank(memoryStore, conversationStore, observabilityStore);
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 20 * 1024 * 1024,
  genReqId: (req) => {
    const incoming = req.headers['x-request-id'];
    if (typeof incoming === 'string' && incoming.length >= 8) return incoming;
    return crypto.randomUUID();
  },
});
const stt = new GoogleSttProvider();
const tts = new GoogleTtsProvider();

await app.register(sensible);

async function normalizeImage(imageBytes: Buffer) {
  return await sharp(imageBytes)
    .rotate() // respect EXIF orientation
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

process.on('SIGINT', () => {
  sqlite.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  sqlite.close();
  process.exit(0);
});

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
  const imageBytes = await normalizeImage(Buffer.from(body.imageBase64, 'base64'));

  const key =
    body.trace.sessionId ?? body.trace.requestId ?? (req.ip ? `ip:${req.ip}` : `req:${req.id}`);
  const cooldownMs = Number(process.env.COOLDOWN_MS ?? 1200);
  const cd = checkCooldown(key, cooldownMs);
  if (!cd.allowed) {
    const now = new Date().toISOString();

    req.log.info({ requestId: req.id, cooldownKey: key, waitMs: cd.waitMs }, 'cooldown_blocked');

    const reply = AssistantReplySchema.parse({
      trace: body.trace,
      speak: 'One moment. Try again.',
      createdAt: now,
      suggestedAction: 'none',
      groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 },
    });

    return { trace: body.trace, reply, blockedByCooldown: true, waitMs: cd.waitMs };
  }

  // Structured logs: intent, modality, image size
  req.log.info(
    {
      requestId: req.id,
      intent: body.intent,
      modality: body.modality,
      imageBytes: imageBytes.length,
    },
    'analyze_start',
  );

  const reply = await frank.handleUserRequest(body, imageBytes);
  req.log.info(
    {
      requestId: req.id,
      intent: body.intent,
      suggestedAction: reply.suggestedAction,
      usedOcr: reply.groundedIn?.usedOcr,
      usedLabels: reply.groundedIn?.usedLabels,
      usedMemoryHits: reply.groundedIn?.usedMemoryHits,
    },
    'analyze_done',
  );

  return { trace: body.trace, reply };
});

app.post('/v1/memory/add', async (req) => {
  const { z } = await import('zod');

  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace,
    item: MemoryItemSchema,
  });

  const body = BodySchema.parse(req.body);

  // store in SQLite
  memoryStore.add(body.item);

  req.log.info({ requestId: req.id, memoryId: body.item.id }, 'memory_add');
  return { trace: body.trace, ok: true };
});

app.post('/v1/memory/search', async (req) => {
  const { z } = await import('zod');
  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace.optional(),
    query: z.string().min(1),
    limit: z.number().min(1).max(50).default(10),
  });
  const body = BodySchema.parse(req.body);
  const items = await memoryStore.search(body.query, body.limit);
  return { trace: body.trace ?? { requestId: req.id }, count: items.length, items };
});

app.post('/v1/memory/delete', async (req) => {
  const { z } = await import('zod');
  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace.optional(),
    ids: z.array(z.string().min(1)).min(1).max(100),
  });

  const body = BodySchema.parse(req.body);
  const deleted = await memoryStore.delete(body.ids);
  return { trace: body.trace ?? { requestId: req.id }, deleted };
});

app.get('/v1/memory/recent', async (req) => {
  const limit = Number((req.query as any)?.limit ?? 10);
  const items = await memoryStore.recent(limit);
  return { count: items.length, items };
});

// Visit docs/voice-summary.md for explanation
await sttRoutes(app, stt);
await ttsRoutes(app, tts);

await ttsVoicesRoutes(app);
await prefsTtsRoutes(app, { prefs });

if (observabilityStore instanceof SqliteObservabilityStore) {
  await diagRoutes(app, { observability: observabilityStore });
}

await deviceRoutes(app, frank, stt, tts, { prefs });
await deviceStreamRoutes(app, frank, stt, tts);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
