import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';

import { TtsProvider, SttProvider } from '@frank/providers';
import { UserRequestSchema } from '@frank/contracts';
import { FrankOrchestrator, pickDeviceSpeak } from '@frank/core';

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
  z.object({
    type: z.literal('utterance'),
    text: z.string().min(1).max(4000),
  }),
  z.object({
    type: z.literal('audio'),
    mime: z.enum(['audio/wav', 'audio/webm', 'audio/mpeg']),
    audioBase64: z.string().min(20),
  }),
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

function safeSend(socket: any, msg: unknown) {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

export async function deviceStreamRoutes(
  app: FastifyInstance,
  frank: FrankOrchestrator,
  stt: SttProvider,
  tts: TtsProvider,
) {
  await app.register(websocket);

  app.get('/v1/device/stream', { websocket: true }, (socket, req) => {
    let trace: { requestId: string; sessionId?: string } | null = null;
    let lastIntent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help' =
      'describe_scene';
    let lastQuery: string | undefined;
    let lastFrameBytes: Buffer | null = null;
    let lastFrameSeq: number | null = null;

    let lastReplyText: string | null = null;
    let lastAudioBytesBase64: string | null = null;

    let inFlight = false;
    let abort = new AbortController();

    safeSend(socket, { type: 'ready', trace: { sessionId: 'unknown', requestId: req.id } });

    socket.on('message', async (raw: any) => {
      let parsed: any;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        return safeSend(socket, { type: 'error', message: 'Invalid JSON', code: 'BAD_JSON' });
      }

      const msg = ClientMsgSchema.safeParse(parsed);
      if (!msg.success) {
        return safeSend(socket, {
          type: 'error',
          message: 'Invalid message shape',
          code: 'BAD_MSG',
        });
      }

      const m = msg.data;

      if (m.type === 'ping') {
        return safeSend(socket, { type: 'pong', t: m.t });
      }

      if (m.type === 'hello') {
        trace = m.trace;
        safeSend(socket, { type: 'ready', trace });
        return;
      }

      if (m.type === 'intent') {
        lastIntent = m.intent;
        lastQuery = m.query;
        return;
      }

      if (m.type === 'frame') {
        lastFrameBytes = Buffer.from(m.bytesBase64, 'base64');
        lastFrameSeq = m.seq;
        safeSend(socket, { type: 'ack', seq: m.seq });
        return;
      }

      if (m.type === 'utterance') {
        await maybeProcess(m.text);
        return;
      }

      if (m.type === 'audio') {
        if (!trace) {
          return safeSend(socket, {
            type: 'error',
            message: 'Send hello first',
            code: 'NO_HELLO',
          });
        }

        try {
          const audioBytes = Buffer.from(m.audioBase64, 'base64');
          const sttResult = await stt.transcribe({ trace, audioBytes });

          // safeSend(socket, {
          //   type: 'transcript',
          //   trace,
          //   transcript: sttResult.transcript,
          //   confidence: sttResult.confidence,
          // });

          await maybeProcess(sttResult.transcript);
        } catch (e: any) {
          safeSend(socket, {
            type: 'error',
            message: e?.message ?? 'STT failed',
            code: 'STT_FAIL',
          });
        }
        return;
      }

      if (m.type === 'repeat') {
        if (lastReplyText) {
          safeSend(socket, {
            type: 'meta',
            trace: trace ?? { requestId: req.id, sessionId: 'unknown' },
            reply: { speak: lastReplyText },
          });
        }
        if (lastAudioBytesBase64) {
          safeSend(socket, {
            type: 'audio',
            mime: 'audio/mpeg',
            bytesBase64: lastAudioBytesBase64,
          });
        }
        return;
      }

      if (m.type === 'stop') {
        abort.abort();
        abort = new AbortController();
        inFlight = false;
        safeSend(socket, { type: 'stopped' });
      }
    });

    socket.on('close', () => {
      abort.abort();
    });

    async function maybeProcess(utterance: string) {
      if (!trace) {
        return safeSend(socket, {
          type: 'error',
          message: 'Send hello first',
          code: 'NO_HELLO',
        });
      }

      if (inFlight) return;

      inFlight = true;
      const startedAt = Date.now();
      const localAbort = abort;

      try {
        const request = UserRequestSchema.parse({
          trace,
          intent: lastIntent,
          modality: 'button',
          utterance,
          hasImage: !!lastFrameBytes,
          query: lastIntent === 'recall' ? lastQuery : undefined,
          requestedAt: new Date().toISOString(),
        });

        const assistantReply = await frank.handleUserRequest(request, lastFrameBytes ?? undefined);

        if (localAbort.signal.aborted) return;

        const totalMs = Date.now() - startedAt;

        lastReplyText = assistantReply.speak;

        safeSend(socket, {
          type: 'meta',
          trace,
          reply: assistantReply,
          timings: { totalMs, frameSeq: lastFrameSeq },
          costUnits: 3,
        });

        const speakText = pickDeviceSpeak(assistantReply);
        const audio = await tts.speak({
          trace,
          text: speakText,
          voiceName: 'en-GB-Chirp3-HD-Sadachbia',
          languageCode: 'en-GB',
          speakingRate: 1.0,
          pitch: 0,
        });

        if (localAbort.signal.aborted) return;

        const b64 = audio.audioBytes.toString('base64');
        lastAudioBytesBase64 = b64;

        safeSend(socket, {
          type: 'audio',
          mime: 'audio/mpeg',
          bytesBase64: b64,
        });
      } catch (e: any) {
        if (!localAbort.signal.aborted) {
          safeSend(socket, {
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
