import 'dotenv/config';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import crypto from 'node:crypto';

import {
  AssistantReplySchema,
  MemoryItemSchema,
  PerceptionResultSchema,
  UserRequestSchema,
  type AssistantReply,
  type PerceptionResult,
  type MemoryItem,
} from '@frank/contracts';

import { addMemory, deleteMemory, searchMemory, listRecent } from './memoryStore.js';

import { GcvVisionProvider, GeminiLlmProvider, GoogleTtsProvider } from '@frank/providers';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  genReqId: (req) => {
    const incoming = req.headers['x-request-id'];
    if (typeof incoming === 'string' && incoming.length >= 8) return incoming;
    return crypto.randomUUID();
  },
});

await app.register(sensible);

app.addHook('onSend', async (req, reply) => {
  reply.header('x-request-id', req.id);
});

// Providers (singletons)
const vision = new GcvVisionProvider();
const llm = new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
const tts = new GoogleTtsProvider();

app.get('/health', async () => ({ ok: true }));

app.post('/v1/analyze', async (req) => {
  const { z } = await import('zod');

  const BodySchema = UserRequestSchema.extend({
    imageBase64: z.string().min(10),
    // Optional: let client request audio or not
    wantAudio: z.boolean().default(true),
  });

  const body = BodySchema.parse(req.body);
  const now = new Date().toISOString();

  const imageBytes = Buffer.from(body.imageBase64, 'base64');

  req.log.info(
    { requestId: req.id, intent: body.intent, modality: body.modality },
    'analyze request received',
  );

  // 1) Vision calls in parallel (Google Cloud Vision)
  const [ocrRes, labelsRes] = await Promise.all([
    vision.analyzeOCR({ trace: body.trace, imageBytes, capturedAt: now }),
    vision.analyzeLabels({ trace: body.trace, imageBytes, capturedAt: now }),
  ]);

  // 2) Merge into one PerceptionResult (your contract)
  const perception: PerceptionResult = PerceptionResultSchema.parse({
    trace: body.trace,
    provider: 'gcv',
    capturedAt: now,
    imageQuality: 'ok',
    imageQualityNotes: [],
    ocr: ocrRes.ocr,
    labels: labelsRes.labels ?? [],
  });

  // 3) Memory hits (simple keyword for now)
  // Later you’ll replace this with embeddings.
  const memoryHits =
    body.intent === 'recall' && body.query
      ? searchMemory(body.query)
          .slice(0, 5)
          .map((m) => `${m.title}: ${m.content}`)
      : [];

  // 4) LLM reply (Gemini) grounded in perception + memory hits
  const reply: AssistantReply = await llm.generateReply({
    trace: body.trace,
    userUtterance: body.utterance,
    perception,
    memoryHits,
    now,
  });

  AssistantReplySchema.parse(reply);

  // 5) Store memory (only for remember_this in this skeleton)
  if (body.intent === 'remember_this') {
    const item: MemoryItem = {
      id: crypto.randomUUID(),
      type: 'mixed',
      title: perception.labels[0]?.name ?? 'Captured item',
      content: perception.ocr?.fullText?.trim() || reply.speak,
      tags: ['frank'],
      createdAt: now,
      trace: body.trace,
    };
    MemoryItemSchema.parse(item);
    addMemory(item);
  }

  // 6) TTS (Google Cloud Text-to-Speech)
  let audioBase64: string | undefined;
  let mimeType: string | undefined;

  if (body.wantAudio) {
    const audio = await tts.speak({
      trace: body.trace,
      text: reply.speak,
      languageCode: 'en-GB',
    });
    audioBase64 = audio.audioBytes.toString('base64');
    mimeType = audio.mimeType;
  }

  return {
    trace: body.trace,
    perception,
    reply,
    audioBase64,
    mimeType,
  };
});

// memory endpoints stay the same as you already set up...
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
