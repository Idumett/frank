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
import { observedStage } from './observability/stage.js';
import { SqliteConversationStore } from './conversation/SqliteConversationStore.js';
import { TokenRegistry } from './security/auth.js';
import { RateLimiter } from './security/rateLimiter.js';
import { SessionOwnershipError, SessionOwnershipStore } from './security/sessionOwnership.js';
import { applyRetention } from './security/retention.js';
import { TTS_CACHE_DIR } from './ttsCache.js';

migrate();
const sqlite = new SqliteMemoryStore();
const memoryStore = {
  add: async (userId: string, item: MemoryItem) => sqlite.add(userId, item),
  search: async (userId: string, query: string, limit: number) => sqlite.search(userId, query, { limit }),
  recent: (userId: string, limit: number) => sqlite.recent(userId, limit),
  delete: (userId: string, ids: string[]) => sqlite.delete(userId, ids),
};
const prefs = new UserPrefsStore(sqlite.rawDb);
const conversationStore = new SqliteConversationStore(sqlite.rawDb);
const sessions = new SessionOwnershipStore(sqlite.rawDb);
const observabilityStore =
  process.env.OBSERVABILITY_ENABLED === 'true'
    ? new SqliteObservabilityStore(sqlite.rawDb)
    : new NoopObservabilityStore();
const frank = makeFrank(memoryStore, conversationStore, observabilityStore);
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', redact: { paths: ['req.headers.authorization', 'req.body', 'res.headers.set-cookie'], censor: '[redacted]' } },
  bodyLimit: 12 * 1024 * 1024,
  genReqId: () => crypto.randomUUID(),
});
const stt = new GoogleSttProvider();
const tts = new GoogleTtsProvider();

await app.register(sensible);

const authFile = process.env.FRANK_AUTH_FILE;
if (process.env.NODE_ENV === 'production' && !authFile) throw new Error('FRANK_AUTH_FILE is required in production');
const tokens = authFile ? new TokenRegistry(authFile) : null;
const authFailures = new RateLimiter(20, 60_000);
const productRequests = new RateLimiter(Number(process.env.PRODUCT_RATE_LIMIT ?? 90), 60_000);
const streamRequests = new RateLimiter(Number(process.env.STREAM_RATE_LIMIT ?? 20), 60_000);

app.addHook('onRequest', async (req, reply) => {
  req.userId = 'legacy';
  if (!tokens || req.url === '/health') return;
  const diagnostics = req.url.startsWith('/v1/diag');
  const auth = tokens.authenticate(req.headers.authorization, diagnostics);
  if (!auth) {
    const attempt = authFailures.take(req.ip);
    if (!attempt.allowed) return reply.header('retry-after', attempt.retryAfterSeconds).code(429).send({ error: 'Too many attempts' });
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (auth.kind === 'user') {
    req.userId = auth.userId;
    const rate = productRequests.take(`${auth.userId}:${req.routeOptions.url ?? req.url.split('?')[0]}`);
    if (!rate.allowed) return reply.header('retry-after', rate.retryAfterSeconds).code(429).send({ error: 'Too many requests' });
  }
});

app.setErrorHandler((error: any, req, reply) => {
  if (error instanceof SessionOwnershipError) return reply.code(403).send({ error: 'Session unavailable', requestId: req.id });
  const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
  req.log.error({ requestId: req.id, status, errorType: error.name }, 'request_failed');
  return reply.code(status).send({ error: status === 500 ? 'Request failed' : 'Invalid request', requestId: req.id });
});

async function normalizeImage(imageBytes: Buffer) {
  return await sharp(imageBytes)
    .rotate() // respect EXIF orientation
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

process.on('SIGINT', () => {
  clearInterval(retentionTimer);
  sqlite.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  clearInterval(retentionTimer);
  sqlite.close();
  process.exit(0);
});

app.addHook('onSend', async (req, reply) => {
  reply.header('x-request-id', req.id);
});

app.get('/health', async () => ({ ok: true }));

const claim = (userId: string, sessionId?: string) => sessions.claim(userId, sessionId);
applyRetention(sqlite.rawDb, TTS_CACHE_DIR);
const retentionTimer = setInterval(() => applyRetention(sqlite.rawDb, TTS_CACHE_DIR), 24 * 60 * 60 * 1000);
retentionTimer.unref();

app.post('/v1/analyze', async (req) => {
  const { z } = await import('zod');
  const BodySchema = UserRequestSchema.extend({
    imageBase64: z.string().min(10).max(11_000_000),
    wantAudio: z.boolean().default(false),
  });

  const body = BodySchema.parse(req.body);
  claim(req.userId, body.trace.sessionId);
  const sourceBytes = Buffer.from(body.imageBase64, 'base64');
  await observabilityStore.start({
    requestId: body.trace.requestId,
    userId: req.userId,
    sessionId: body.trace.sessionId,
    source: 'analyze',
    startedAt: new Date().toISOString(),
    input: { intent: body.intent, modality: body.modality, imageBytes: sourceBytes.length },
    stages: [],
  });

  let imageBytes: Buffer;
  try {
    imageBytes = await observedStage(
      observabilityStore,
      body.trace.requestId,
      'image.normalize',
      () => normalizeImage(sourceBytes),
      { inputBytes: sourceBytes.length },
    );
  } catch (error: any) {
    await observabilityStore.fail(body.trace.requestId, error?.message ?? 'Image normalization failed');
    throw error;
  }

  const key =
    body.trace.sessionId ?? body.trace.requestId ?? (req.ip ? `ip:${req.ip}` : `req:${req.id}`);
  const cooldownMs = Number(process.env.COOLDOWN_MS ?? 1200);
  const cd = await observedStage(
    observabilityStore,
    body.trace.requestId,
    'cooldown.check',
    async () => checkCooldown(key, cooldownMs),
    { cooldownMs },
  );
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

    const output = { trace: body.trace, reply, blockedByCooldown: true, waitMs: cd.waitMs };
    await observabilityStore.finish(body.trace.requestId, {
      blockedByCooldown: true,
      waitMs: cd.waitMs,
    });
    return output;
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

  const reply = await frank.handleUserRequest(body, imageBytes, { userId: req.userId });
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
  claim(req.userId, body.trace.sessionId);

  // store in SQLite
  await memoryStore.add(req.userId, body.item);

  req.log.info({ requestId: req.id, memoryId: body.item.id }, 'memory_add');
  return { trace: body.trace, ok: true };
});

app.post('/v1/memory/search', async (req) => {
  const { z } = await import('zod');
  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace.optional(),
    query: z.string().min(1).max(1000),
    limit: z.number().min(1).max(50).default(10),
  });
  const body = BodySchema.parse(req.body);
  claim(req.userId, body.trace?.sessionId);
  const items = await memoryStore.search(req.userId, body.query, body.limit);
  return { trace: body.trace ?? { requestId: req.id }, count: items.length, items };
});

app.post('/v1/memory/delete', async (req) => {
  const { z } = await import('zod');
  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace.optional(),
    ids: z.array(z.string().min(1)).min(1).max(100),
  });

  const body = BodySchema.parse(req.body);
  claim(req.userId, body.trace?.sessionId);
  const deleted = await memoryStore.delete(req.userId, body.ids);
  return { trace: body.trace ?? { requestId: req.id }, deleted };
});

app.get('/v1/memory/recent', async (req) => {
  const limit = Number((req.query as any)?.limit ?? 10);
  const items = await memoryStore.recent(req.userId, Math.min(Math.max(limit, 1), 50));
  return { count: items.length, items };
});

// Visit docs/voice-summary.md for explanation
await sttRoutes(app, stt, observabilityStore, claim);
await ttsRoutes(app, tts, observabilityStore, claim);

await ttsVoicesRoutes(app);
await prefsTtsRoutes(app, { prefs, claim });

if (observabilityStore instanceof SqliteObservabilityStore) {
  await diagRoutes(app, { observability: observabilityStore });
}

await deviceRoutes(app, frank, stt, tts, { prefs, observability: observabilityStore, claim });
await deviceStreamRoutes(app, frank, stt, tts, observabilityStore, claim, (userId) => streamRequests.take(userId));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
