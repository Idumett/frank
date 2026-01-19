import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';

import { makeFrank } from '../coreWiring.js';
import { GoogleTtsProvider } from '@frank/providers';
import { MemoryItem, UserRequestSchema } from '@frank/contracts';
import { SqliteMemoryStore } from '../db/sqliteMemoryStore.js';

const sqlite = new SqliteMemoryStore();
const memoryStore = {
  add: async (item: MemoryItem) => sqlite.add(item),
  search: async (query: string, limit: number) => sqlite.search(query, { limit }),
  recent: (limit: number) => sqlite.recent(limit),
  delete: (ids: string[]) => sqlite.delete(ids),
};
const frank = makeFrank(memoryStore);
const tts = new GoogleTtsProvider();

// ---- Zod schemas for messages (keeps it safe) ----
const TraceSchema = UserRequestSchema.shape.trace;

const ClientMsgSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    trace: TraceSchema,
    device: z
      .object({
        model: z.string().optional(),
        fw: z.string().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal('utterance'), text: z.string().min(1).max(4000) }),
  z.object({
    type: z.literal('intent'),
    intent: z.enum(['read_text', 'describe_scene', 'remember_this', 'recall', 'help']),
    query: z.string().optional(),
  }),
  z.object({
    type: z.literal('frame'),
    seq: z.number().int().min(0),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    bytesBase64: z.string().min(20),
  }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('repeat') }),
  z.object({ type: z.literal('ping'), t: z.number() }),
]);

function safeSend(conn: any, msg: unknown) {
  try {
    conn.socket.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

export async function deviceStreamRoutes(app: FastifyInstance) {
  await app.register(websocket);

  app.get('/v1/device/stream', { websocket: true }, (conn, req) => {
    // ---- Session state ----
    let trace: { requestId: string; sessionId?: string } | null = null;
    let lastIntent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help' =
      'describe_scene';
    let lastQuery: string | undefined;
    let lastUtterance: string | undefined;
    let lastFrameBytes: Buffer | null = null;
    let lastFrameSeq: number | null = null;

    // For "repeat"
    let lastReplyText: string | null = null;
    let lastAudioBytesBase64: string | null = null;

    // Cancellation (best-effort)
    let inFlight = false;
    let abort = new AbortController();

    safeSend(conn, { type: 'ready', trace: { sessionId: 'unknown', requestId: req.id } });

    conn.socket.on('message', async (raw: any) => {
      // Parse JSON messages
      let parsed: any;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        return safeSend(conn, { type: 'error', message: 'Invalid JSON', code: 'BAD_JSON' });
      }

      const msg = ClientMsgSchema.safeParse(parsed);
      if (!msg.success) {
        return safeSend(conn, { type: 'error', message: 'Invalid message shape', code: 'BAD_MSG' });
      }

      const m = msg.data;

      if (m.type === 'ping') {
        return safeSend(conn, { type: 'pong', t: m.t });
      }

      if (m.type === 'hello') {
        trace = m.trace;
        safeSend(conn, { type: 'ready', trace });
        return;
      }

      if (m.type === 'intent') {
        lastIntent = m.intent;
        lastQuery = m.query;
        return;
      }

      if (m.type === 'utterance') {
        lastUtterance = m.text;
        return;
      }

      if (m.type === 'frame') {
        // Ack quickly so device knows we got it
        safeSend(conn, { type: 'ack', seq: m.seq });

        lastFrameBytes = Buffer.from(m.bytesBase64, 'base64');
        lastFrameSeq = m.seq;

        // Decide whether to process now:
        // For v1: process whenever a new frame arrives.
        // We can later require an utterance first.
        await maybeProcess();
        return;
      }

      if (m.type === 'repeat') {
        if (lastReplyText) {
          safeSend(conn, {
            type: 'meta',
            trace: trace ?? { requestId: req.id, sessionId: 'unknown' },
            reply: { speak: lastReplyText },
          });
        }
        if (lastAudioBytesBase64) {
          safeSend(conn, { type: 'audio', mime: 'audio/mpeg', bytesBase64: lastAudioBytesBase64 });
        }
        return;
      }

      if (m.type === 'stop') {
        // Best-effort cancel: prevents sending further results
        abort.abort();
        abort = new AbortController();
        inFlight = false;
        safeSend(conn, { type: 'stopped' });
        return;
      }
    });

    conn.socket.on('close', () => {
      abort.abort();
    });

    async function maybeProcess() {
      if (!trace) {
        // Can still run, but better to require hello
        return safeSend(conn, { type: 'error', message: 'Send hello first', code: 'NO_HELLO' });
      }
      if (!lastFrameBytes) return;

      // Prevent overlapping work (simple backpressure)
      if (inFlight) return;

      inFlight = true;
      const startedAt = Date.now();
      const localAbort = abort;

      try {
        // Build UserRequest contract
        const request = UserRequestSchema.parse({
          trace,
          intent: lastIntent,
          modality: 'button', // device
          utterance: lastUtterance,
          hasImage: true,
          query: lastIntent === 'recall' ? lastQuery : undefined,
          requestedAt: new Date().toISOString(),
        });

        // Run Frank core
        const reply = await frank.handleUserRequest(request, lastFrameBytes);

        // If stop was requested mid-flight, do not send results
        if (localAbort.signal.aborted) return;

        const totalMs = Date.now() - startedAt;

        lastReplyText = reply.speak;

        safeSend(conn, {
          type: 'meta',
          trace,
          reply,
          timings: { totalMs, frameSeq: lastFrameSeq },
          costUnits: 3,
        });

        // TTS (optional: only if device wants audio; v1 always sends)
        const audio = await tts.speak({
          trace,
          text: reply.speak,
          languageCode: 'en-GB',
        });

        if (localAbort.signal.aborted) return;

        const b64 = audio.audioBytes.toString('base64');
        lastAudioBytesBase64 = b64;

        safeSend(conn, { type: 'audio', mime: 'audio/mpeg', bytesBase64: b64 });
      } catch (e: any) {
        if (!localAbort.signal.aborted) {
          safeSend(conn, {
            type: 'error',
            message: e?.message ?? 'Unknown error',
            code: 'PROCESS_FAIL',
          });
        }
      } finally {
        inFlight = false;
      }
    }
  });
}
