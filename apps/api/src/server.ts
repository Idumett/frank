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
import { checkCooldown } from './rateLimit.js';

import { sttRoutes } from './routes/stt.js';
import { ttsRoutes } from './routes/tts.js';
import { deviceRoutes } from './routes/device.js';
import { deviceStreamRoutes } from './routes/deviceStream.js';
import { prefsTtsRoutes } from './routes/prefs.js';
import { ttsVoicesRoutes } from './routes/ttsVoices.js';
import { diagRoutes } from './routes/diag.js';
import { GeminiLlmProvider, GoogleSttProvider, GoogleTtsProvider } from '@frank/providers';
import { ConcurrencyGate, NoopObservabilityStore } from '@frank/core';
import { SqliteObservabilityStore } from './observability/SqliteObservabilityStore.js';
import { observedStage } from './observability/stage.js';
import { TokenRegistry } from './security/auth.js';
import { RateLimiter } from './security/rateLimiter.js';
import { SessionOwnershipError } from './security/sessionOwnership.js';
import { applyRetention } from './security/retention.js';
import { TTS_CACHE_DIR } from './ttsCache.js';
import { SqliteProductDataAdapter } from './productData/SqliteProductDataAdapter.js';
import { productDataRoutes } from './routes/productData.js';
import { inferIntent } from './evidence/policy.js';
import { CachedTtsProvider } from './tts/CachedTtsProvider.js';
import { ServiceLifecycle } from './lifecycle.js';

migrate();
const sqlite = new SqliteMemoryStore();
const productData = new SqliteProductDataAdapter(sqlite.rawDb);
const memoryStore = productData;
const prefs = productData;
const conversationStore = productData;
const observabilityStore =
  process.env.OBSERVABILITY_ENABLED === 'true'
    ? new SqliteObservabilityStore(sqlite.rawDb)
    : new NoopObservabilityStore();
const gemini = new GeminiLlmProvider({
  model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
});
const geminiGate = new ConcurrencyGate({
  maxConcurrent: Number(process.env.GEMINI_MAX_CONCURRENCY ?? 6),
  maxQueue: Number(process.env.GEMINI_MAX_QUEUE ?? 24),
  queueTimeoutMs: Number(process.env.GEMINI_QUEUE_TIMEOUT_MS ?? 3_000),
});
const frank = makeFrank(memoryStore, conversationStore, observabilityStore, {
  generateReply: (args) => geminiGate.run(() => gemini.generateReply(args)),
});
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['req.headers.authorization', 'req.body', 'res.headers.set-cookie'],
      censor: '[redacted]',
    },
  },
  bodyLimit: 12 * 1024 * 1024,
  genReqId: () => crypto.randomUUID(),
});
const stt = new GoogleSttProvider();
const tts = new CachedTtsProvider(new GoogleTtsProvider());
const lifecycle = new ServiceLifecycle();

await app.register(sensible);

const authFile = process.env.FRANK_AUTH_FILE;
if (process.env.NODE_ENV === 'production' && !authFile)
  throw new Error('FRANK_AUTH_FILE is required in production');
const tokens = authFile ? new TokenRegistry(authFile) : null;
const authFailures = new RateLimiter(20, 60_000);
const productRequests = new RateLimiter(Number(process.env.PRODUCT_RATE_LIMIT ?? 90), 60_000);
const streamRequests = new RateLimiter(Number(process.env.STREAM_RATE_LIMIT ?? 20), 60_000);

app.addHook('onRequest', async (req, reply) => {
  if (lifecycle.isDraining && req.url !== '/health' && req.url !== '/ready')
    return reply.header('retry-after', '5').code(503).send({ error: 'Server is restarting' });
  req.userId = 'legacy';
  if (!tokens || req.url === '/health' || req.url === '/ready' || req.url === '/privacy') return;
  const diagnostics = req.url.startsWith('/v1/diag');
  const auth = tokens.authenticate(req.headers.authorization, diagnostics);
  if (!auth) {
    const attempt = authFailures.take(req.ip);
    if (!attempt.allowed)
      return reply
        .header('retry-after', attempt.retryAfterSeconds)
        .code(429)
        .send({ error: 'Too many attempts' });
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (auth.kind === 'user') {
    req.userId = auth.userId;
    const rate = productRequests.take(
      `${auth.userId}:${req.routeOptions.url ?? req.url.split('?')[0]}`,
    );
    if (!rate.allowed)
      return reply
        .header('retry-after', rate.retryAfterSeconds)
        .code(429)
        .send({ error: 'Too many requests' });
  }
});

app.setErrorHandler((error: any, req, reply) => {
  if (error instanceof SessionOwnershipError)
    return reply.code(403).send({ error: 'Session unavailable', requestId: req.id });
  const status =
    error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
  req.log.error({ requestId: req.id, status, errorType: error.name }, 'request_failed');
  return reply
    .code(status)
    .send({ error: status === 500 ? 'Request failed' : 'Invalid request', requestId: req.id });
});

async function normalizeImage(imageBytes: Buffer) {
  return await sharp(imageBytes)
    .rotate() // respect EXIF orientation
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

app.addHook('onSend', async (req, reply) => {
  reply.header('x-request-id', req.id);
});

app.get('/health', async () => ({ ok: true, draining: lifecycle.isDraining }));
app.get('/ready', async (_req, reply) => {
  if (lifecycle.isDraining) return reply.code(503).send({ ok: false, draining: true });
  return { ok: true, draining: false };
});

app.get('/privacy', async (_req, reply) => reply
  .type('text/html; charset=utf-8')
  .send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Frank privacy notice</title><style>body{font:18px/1.55 system-ui;max-width:48rem;margin:auto;padding:2rem;color:#172033}h1,h2{line-height:1.2}</style><main><h1>Frank privacy notice</h1><p>Last updated 4 September 2026.</p><p>Frank is an accessibility assistant in private testing. It processes voice recordings and, only when relevant, camera images and device context to answer a request. Location is optional and is used for current context and user-confirmed places or hazards.</p><h2>Storage</h2><p>Temporary audio and camera evidence are processed for the request and are not retained as ordinary history. Conversation context is retained for one day, diagnostic traces for 14 days, cached speech for seven days, and inactive sessions for 30 days. User-confirmed memories, places and hazards remain until they expire or the user deletes them. Raw location history is not stored.</p><h2>Providers</h2><p>Requests may be processed by Google Cloud Speech-to-Text, Vision, Text-to-Speech and Gemini. Operational data is stored in the Frank Google Cloud project.</p><h2>Control and safety</h2><p>Camera and location access are optional and can be revoked in Android settings. Frank is not a navigation, emergency or road-crossing service. Private testers can request access to, correction of, or deletion of their test data through the testing contact shown on the Google Play listing.</p></main></html>`));

const claim = (userId: string, sessionId?: string) => productData.claimSession(userId, sessionId);
const runRetention = () => {
  applyRetention(sqlite.rawDb, TTS_CACHE_DIR);
  productData.applyRetention();
};
runRetention();
const retentionTimer = setInterval(
  runRetention,
  24 * 60 * 60 * 1000,
);
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
    await observabilityStore.fail(
      body.trace.requestId,
      error?.message ?? 'Image normalization failed',
    );
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
await productDataRoutes(app, productData);

if (observabilityStore instanceof SqliteObservabilityStore) {
  await diagRoutes(app, { observability: observabilityStore });
}

await deviceRoutes(app, frank, stt, tts, { prefs, observability: observabilityStore, claim });
await deviceStreamRoutes(
  app,
  frank,
  stt,
  tts,
  observabilityStore,
  claim,
  (userId) => streamRequests.take(userId),
  productData,
  async (utterance, userId, sessionId) => {
    const turns = sessionId ? await conversationStore.getRecent(userId, sessionId, 6) : [];
    const context = turns
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join(' | ')
      .slice(-2400);
    try {
      return await geminiGate.run(() => gemini.classifyTurn(utterance, context));
    } catch {
      return {
        intent: inferIntent(utterance),
        productAction: { schemaVersion: '1' as const, action: 'none' as const },
        memoryQuery: utterance,
      };
    }
  },
);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const shutdown = (signal: string) => {
  app.log.info({ signal }, 'graceful_shutdown_started');
  const hardStop = setTimeout(() => {
    app.log.error({ signal }, 'graceful_shutdown_timed_out');
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 12_000));
  hardStop.unref();
  void lifecycle
    .shutdown(
      () => app.close(),
      () => {
        clearInterval(retentionTimer);
        sqlite.close();
      },
    )
    .then(() => {
      clearTimeout(hardStop);
      app.log.info({ signal }, 'graceful_shutdown_complete');
      process.exitCode = 0;
    })
    .catch((error) => {
      clearTimeout(hardStop);
      app.log.error({ signal, errorType: error?.name }, 'graceful_shutdown_failed');
      process.exitCode = 1;
    });
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
