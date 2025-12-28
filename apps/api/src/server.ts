import 'dotenv/config';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import crypto from 'node:crypto';

import {
  AssistantReplySchema,
  type AssistantReply,
  MemoryItemSchema,
  type MemoryItem,
  UserRequestSchema,
} from '@frank/contracts';

import { addMemory, deleteMemory, searchMemory, listRecent } from './memoryStore.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },

  // Ensure every request has a requestId (Fastify uses it in logs)
  genReqId: (req) => {
    const incoming = req.headers['x-request-id'];
    if (typeof incoming === 'string' && incoming.length >= 8) return incoming;
    return crypto.randomUUID();
  },
});

await app.register(sensible);

// A tiny hook to make requestId obvious in responses too
app.addHook('onSend', async (req, reply) => {
  reply.header('x-request-id', req.id);
});

// ---------- Health ----------
app.get('/health', async (req) => {
  req.log.info({ requestId: req.id }, 'health check');
  return { ok: true };
});

// ---------- /v1/analyze ----------
// For skeleton: accept JSON with a base64 image string.
// Later: support multipart/form-data (file upload) or stream.
app.post('/v1/analyze', async (req) => {
  const BodySchema = UserRequestSchema.extend({
    imageBase64: (await import('zod')).z.string().min(10), // simple placeholder
  });

  const body = BodySchema.parse(req.body);

  req.log.info(
    {
      requestId: req.id,
      intent: body.intent,
      modality: body.modality,
      hasImage: body.hasImage,
    },
    'analyze request received',
  );

  // TODO: real flow later
  // 1) quality gating
  // 2) call GCV OCR + labels
  // 3) policy decision
  // 4) LLM response
  // 5) memory store decision

  // For now, generate a mocked reply + mock memory item
  const now = new Date().toISOString();

  // Example: store a memory item only if intent suggests it
  const shouldStore = body.intent === 'remember_this';

  if (shouldStore) {
    const memoryItem: MemoryItem = {
      id: crypto.randomUUID(),
      type: 'mixed',
      title: 'Captured item (mock)',
      content: `Mock content stored from request: ${body.utterance ?? '(no utterance)'}`,
      tags: ['mock'],
      createdAt: now,
      trace: body.trace,
    };

    // Validate contract
    MemoryItemSchema.parse(memoryItem);
    addMemory(memoryItem);

    req.log.info({ requestId: req.id, memoryId: memoryItem.id }, 'memory stored (mock)');
  }

  const reply: AssistantReply = {
    trace: body.trace,
    speak:
      body.intent === 'read_text'
        ? 'I am ready to read. (Mock response)'
        : body.intent === 'describe_scene'
          ? 'I can describe what is in front of you. (Mock response)'
          : body.intent === 'remember_this'
            ? 'Okay. I will remember this. (Mock response)'
            : body.intent === 'recall'
              ? 'Tell me what you want me to recall. (Mock response)'
              : 'How can I help? (Mock response)',
    followUpQuestion:
      body.intent === 'remember_this' ? 'Do you want to add a tag for this?' : undefined,
    suggestedAction: body.intent === 'remember_this' ? 'store_memory' : 'none',
    createdAt: now,
    groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 },
  };

  // Validate and return
  return AssistantReplySchema.parse(reply);
});

// ---------- /v1/memory/search ----------
app.post('/v1/memory/search', async (req) => {
  const { z } = await import('zod');

  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace,
    query: z.string().min(1),
    limit: z.number().min(1).max(50).default(10),
  });

  const body = BodySchema.parse(req.body);

  req.log.info(
    { requestId: req.id, query: body.query, limit: body.limit },
    'memory search requested',
  );

  const matches = searchMemory(body.query).slice(0, body.limit);

  return {
    trace: body.trace,
    count: matches.length,
    items: matches.map((m) => MemoryItemSchema.parse(m)),
  };
});

// ---------- /v1/memory/delete ----------
app.post('/v1/memory/delete', async (req) => {
  const { z } = await import('zod');

  const BodySchema = z.object({
    trace: UserRequestSchema.shape.trace,
    ids: z.array(z.string().min(1)).min(1).max(100),
  });

  const body = BodySchema.parse(req.body);

  const deleted = deleteMemory(body.ids);
  req.log.info({ requestId: req.id, deleted }, 'memory delete performed');

  return { trace: body.trace, deleted };
});

// (Optional) handy endpoint for dev: recent memory
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
