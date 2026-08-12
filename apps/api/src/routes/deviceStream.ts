import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';

import { TtsProvider, SttProvider } from '@frank/providers';
import { UserRequestSchema } from '@frank/contracts';
import { FrankOrchestrator, pickDeviceSpeak, type ObservabilityStore } from '@frank/core';

const TraceSchema = UserRequestSchema.shape.trace;

const ClientMsgSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    trace: TraceSchema,
    device: z.object({ model: z.string().optional(), fw: z.string().optional() }).optional(),
  }),
  z.object({
    type: z.literal('utterance'),
    trace: TraceSchema.optional(),
    text: z.string().min(1).max(4000),
    sentAt: z.string().optional(),
  }),
  z.object({
    type: z.literal('audio'),
    trace: TraceSchema.optional(),
    mime: z.enum(['audio/wav', 'audio/webm', 'audio/mpeg']),
    audioBase64: z.string().min(20),
    sentAt: z.string().optional(),
  }),
  z.object({
    type: z.literal('intent'),
    intent: z.enum(['read_text', 'describe_scene', 'remember_this', 'recall', 'help']),
    query: z.string().optional(),
  }),
  z.object({
    type: z.literal('frame'),
    trace: TraceSchema.optional(),
    seq: z.number().int().min(0),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    bytesBase64: z.string().min(20),
    capturedAt: z.string().optional(),
  }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('repeat') }),
  z.object({ type: z.literal('ping'), t: z.number() }),
]);

type DeviceTrace = { requestId: string; sessionId?: string };

function safeSend(socket: any, msg: unknown) {
  try {
    socket.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

export async function deviceStreamRoutes(
  app: FastifyInstance,
  frank: FrankOrchestrator,
  stt: SttProvider,
  tts: TtsProvider,
  observability: ObservabilityStore,
) {
  await app.register(websocket);

  app.get('/v1/device/stream', { websocket: true }, (socket, req) => {
    let connectionTrace: DeviceTrace | null = null;
    let activeTrace: DeviceTrace | null = null;
    let lastIntent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help' =
      'describe_scene';
    let lastQuery: string | undefined;
    let lastFrameBytes: Buffer | null = null;
    let lastFrameSeq: number | null = null;
    let lastFrameCapturedAt: string | undefined;
    let lastReplyText: string | null = null;
    let lastAudioBytesBase64: string | null = null;
    let inFlight = false;
    let abort = new AbortController();

    safeSend(socket, { type: 'connected', trace: { requestId: req.id } });

    socket.on('message', async (raw: any) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        return safeSend(socket, { type: 'error', message: 'Invalid JSON', code: 'BAD_JSON' });
      }

      const msg = ClientMsgSchema.safeParse(parsed);
      if (!msg.success) {
        return safeSend(socket, { type: 'error', message: 'Invalid message shape', code: 'BAD_MSG' });
      }

      const m = msg.data;
      if (m.type === 'ping') return safeSend(socket, { type: 'pong', t: m.t });

      if (m.type === 'hello') {
        connectionTrace = m.trace;
        safeSend(socket, { type: 'ready', trace: connectionTrace });
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
        lastFrameCapturedAt = m.capturedAt;
        safeSend(socket, { type: 'ack', seq: m.seq, trace: m.trace });
        return;
      }

      if (m.type === 'utterance') {
        await maybeProcess(m.text, resolveTrace(m.trace), false, m.sentAt);
        return;
      }

      if (m.type === 'audio') {
        const requestTrace = resolveTrace(m.trace);
        activeTrace = requestTrace;
        const audioBytes = Buffer.from(m.audioBase64, 'base64');

        await observability.start({
          requestId: requestTrace.requestId,
          sessionId: requestTrace.sessionId,
          source: 'device_stream',
          startedAt: new Date().toISOString(),
          input: streamInput(audioBytes.length, m.mime, m.sentAt),
          stages: [],
        });

        try {
          const sttResult = await stage(requestTrace, 'stt.transcribe', () =>
            stt.transcribe({ trace: requestTrace, audioBytes, mimeType: m.mime }),
            { audioBytes: audioBytes.length, mime: m.mime },
          );

          safeSend(socket, {
            type: 'transcript',
            trace: requestTrace,
            transcript: sttResult.transcript,
            confidence: sttResult.confidence,
          });

          await maybeProcess(sttResult.transcript, requestTrace, true, m.sentAt);
        } catch (error: any) {
          await observability.fail(requestTrace.requestId, error?.message ?? 'STT failed');
          safeSend(socket, { type: 'error', trace: requestTrace, message: error?.message ?? 'STT failed', code: 'STT_FAIL' });
        }
        return;
      }

      if (m.type === 'repeat') {
        if (lastReplyText) safeSend(socket, { type: 'meta', trace: activeTrace, reply: { speak: lastReplyText } });
        if (lastAudioBytesBase64) safeSend(socket, { type: 'audio', trace: activeTrace, mime: 'audio/mpeg', bytesBase64: lastAudioBytesBase64 });
        return;
      }

      if (m.type === 'stop') {
        abort.abort();
        abort = new AbortController();
        inFlight = false;
        if (activeTrace) await observability.fail(activeTrace.requestId, 'Stopped by client');
        safeSend(socket, { type: 'stopped', trace: activeTrace });
      }
    });

    socket.on('close', async () => {
      abort.abort();
      if (inFlight && activeTrace) {
        await observability.fail(activeTrace.requestId, 'Client disconnected');
      }
    });

    function resolveTrace(messageTrace?: DeviceTrace): DeviceTrace {
      return messageTrace ?? {
        requestId: crypto.randomUUID(),
        sessionId: connectionTrace?.sessionId,
      };
    }

    function streamInput(audioBytes?: number, audioMime?: string, clientSentAt?: string) {
      return {
        intent: lastIntent,
        query: lastQuery,
        audioBytes,
        audioMime,
        imageBytes: lastFrameBytes?.length ?? 0,
        frameSeq: lastFrameSeq,
        frameCapturedAt: lastFrameCapturedAt,
        clientSentAt,
      };
    }

    async function stage<T>(
      requestTrace: DeviceTrace,
      name: string,
      fn: () => Promise<T>,
      data?: unknown,
    ): Promise<T> {
      const startedAt = new Date().toISOString();
      const start = Date.now();
      try {
        const result = await fn();
        await observability.addStage(requestTrace.requestId, {
          name, startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - start, ok: true, data,
        });
        return result;
      } catch (error: any) {
        await observability.addStage(requestTrace.requestId, {
          name, startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - start, ok: false, data,
          error: error?.message ?? 'Unknown error',
        });
        throw error;
      }
    }

    async function maybeProcess(
      utterance: string,
      requestTrace: DeviceTrace,
      traceStarted: boolean,
      clientSentAt?: string,
    ) {
      if (!connectionTrace) {
        return safeSend(socket, { type: 'error', message: 'Send hello first', code: 'NO_HELLO' });
      }
      if (inFlight) return safeSend(socket, { type: 'error', trace: requestTrace, message: 'Frank is still processing', code: 'BUSY' });

      inFlight = true;
      activeTrace = requestTrace;
      const startedAt = Date.now();
      const localAbort = abort;

      if (!traceStarted) {
        await observability.start({
          requestId: requestTrace.requestId,
          sessionId: requestTrace.sessionId,
          source: 'device_stream',
          startedAt: new Date().toISOString(),
          input: { ...streamInput(undefined, undefined, clientSentAt), utterance },
          stages: [],
        });
      }

      try {
        const request = UserRequestSchema.parse({
          trace: requestTrace,
          intent: lastIntent,
          modality: 'button',
          utterance,
          hasImage: !!lastFrameBytes,
          query: lastIntent === 'recall' ? lastQuery : undefined,
          requestedAt: new Date().toISOString(),
        });

        const assistantReply = await frank.handleUserRequest(
          request,
          lastFrameBytes ?? undefined,
          { source: 'device_stream', finishTrace: false },
        );
        if (localAbort.signal.aborted) return;

        lastReplyText = assistantReply.speak;
        safeSend(socket, {
          type: 'meta', trace: requestTrace, reply: assistantReply,
          timings: { totalMs: Date.now() - startedAt, frameSeq: lastFrameSeq }, costUnits: 3,
        });

        const speakText = pickDeviceSpeak(assistantReply);
        const audio = await stage(requestTrace, 'tts.synthesize', () => tts.speak({
          trace: requestTrace,
          text: speakText,
          voiceName: 'en-GB-Chirp3-HD-Sadachbia',
          languageCode: 'en-GB',
          speakingRate: 1.0,
          pitch: 0,
        }), { textCharacters: speakText.length });
        if (localAbort.signal.aborted) return;

        const b64 = audio.audioBytes.toString('base64');
        lastAudioBytesBase64 = b64;
        const sent = await stage(requestTrace, 'stream.send_audio', async () => safeSend(socket, {
          type: 'audio', trace: requestTrace, mime: audio.mimeType, bytesBase64: b64,
        }), { audioBytes: audio.audioBytes.length });
        if (!sent) throw new Error('Failed to send audio');

        await observability.finish(requestTrace.requestId, {
          speak: assistantReply.speak,
          suggestedAction: assistantReply.suggestedAction,
          audioBytes: audio.audioBytes.length,
          frameSeq: lastFrameSeq,
        });
      } catch (error: any) {
        if (!localAbort.signal.aborted) {
          await observability.fail(requestTrace.requestId, error?.message ?? 'Unknown error');
          safeSend(socket, { type: 'error', trace: requestTrace, message: error?.message ?? 'Unknown error', code: 'PROCESS_FAIL' });
        }
      } finally {
        inFlight = false;
      }
    }
  });
}
