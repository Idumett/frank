import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';

import { TtsProvider, SttProvider } from '@frank/providers';
import { UserRequestSchema } from '@frank/contracts';
import { FrankOrchestrator, pickDeviceSpeak, withDeadline, type ObservabilityStore } from '@frank/core';

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
    audioBase64: z.string().min(20).max(12_000_000),
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
    bytesBase64: z.string().min(20).max(11_000_000),
    capturedAt: z.string().optional(),
  }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('repeat') }),
  z.object({ type: z.literal('ping'), t: z.number() }),
]);

type DeviceTrace = { requestId: string; sessionId?: string };
type PendingFrame = { bytes: Buffer; seq: number; capturedAt?: string; trace?: DeviceTrace; receivedAt: number };

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
  claim: (userId: string, sessionId?: string) => void = () => {},
  takeRequest: (userId: string) => { allowed: boolean; retryAfterSeconds: number } = () => ({ allowed: true, retryAfterSeconds: 0 }),
) {
  await app.register(websocket, { options: { maxPayload: 12 * 1024 * 1024 } });

  app.get('/v1/device/stream', { websocket: true }, (socket, req) => {
    let connectionTrace: DeviceTrace | null = null;
    let activeTrace: DeviceTrace | null = null;
    let lastIntent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help' =
      'describe_scene';
    let lastQuery: string | undefined;
    let pendingFrame: PendingFrame | null = null;
    let lastReplyText: string | null = null;
    let lastAudioBytesBase64: string | null = null;
    let inFlight = false;
    let activeOperation = 0;
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
        try { claim(req.userId, m.trace.sessionId); }
        catch { safeSend(socket, { type: 'error', message: 'Session unavailable', code: 'SESSION_FORBIDDEN' }); socket.close(1008); return; }
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
        if (!connectionTrace) {
          return safeSend(socket, { type: 'error', message: 'Send hello first', code: 'NO_HELLO' });
        }
        pendingFrame = {
          bytes: Buffer.from(m.bytesBase64, 'base64'),
          seq: m.seq,
          capturedAt: m.capturedAt,
          trace: m.trace,
          receivedAt: Date.now(),
        };
        return;
      }

      if (m.type === 'utterance') {
        if (!takeRequest(req.userId).allowed) return safeSend(socket, { type: 'error', message: 'Too many requests', code: 'RATE_LIMITED' });
        await maybeProcess(m.text, resolveTrace(m.trace), false, m.sentAt);
        return;
      }

      if (m.type === 'audio') {
        if (!takeRequest(req.userId).allowed) return safeSend(socket, { type: 'error', message: 'Too many requests', code: 'RATE_LIMITED' });
        if (!connectionTrace) {
          return safeSend(socket, { type: 'error', message: 'Send hello first', code: 'NO_HELLO' });
        }
        const requestTrace = resolveTrace(m.trace);
        if (inFlight) {
          return safeSend(socket, { type: 'error', trace: requestTrace, message: 'Frank is still processing', code: 'BUSY' });
        }

        inFlight = true;
        activeTrace = requestTrace;
        const operationId = ++activeOperation;
        const frame = takeFrame(requestTrace);
        const audioBytes = Buffer.from(m.audioBase64, 'base64');

        await observability.start({
          requestId: requestTrace.requestId,
          userId: req.userId,
          sessionId: requestTrace.sessionId,
          source: 'device_stream',
          startedAt: new Date().toISOString(),
          input: streamInput(frame, audioBytes.length, m.mime, m.sentAt),
          stages: [],
        });

        try {
          const sttResult = await stage(requestTrace, 'stt.transcribe', () =>
            withDeadline(
              () => stt.transcribe({ trace: requestTrace, audioBytes, mimeType: m.mime }),
              15_000,
              'stt.transcribe',
            ),
            { audioBytes: audioBytes.length, mime: m.mime },
          );

          if (!sttResult.transcript.trim()) {
            throw new Error('No speech recognized');
          }

          safeSend(socket, {
            type: 'transcript',
            trace: requestTrace,
            transcript: sttResult.transcript,
            confidence: sttResult.confidence,
          });

          await maybeProcess(sttResult.transcript, requestTrace, true, m.sentAt, operationId, frame);
        } catch (error: any) {
          await observability.fail(requestTrace.requestId, error?.message ?? 'STT failed');
          safeSend(socket, { type: 'error', trace: requestTrace, message: error?.message ?? 'STT failed', code: 'STT_FAIL' });
        } finally {
          if (activeOperation === operationId) inFlight = false;
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
        activeOperation += 1;
        inFlight = false;
        if (activeTrace) await observability.fail(activeTrace.requestId, 'Stopped by client');
        safeSend(socket, { type: 'stopped', trace: activeTrace });
      }
    });

    socket.on('close', async () => {
      abort.abort();
      activeOperation += 1;
      if (inFlight && activeTrace) {
        await observability.fail(activeTrace.requestId, 'Client disconnected');
      }
    });

    function resolveTrace(messageTrace?: DeviceTrace): DeviceTrace {
      return {
        requestId: messageTrace?.requestId ?? crypto.randomUUID(),
        sessionId: connectionTrace?.sessionId,
      };
    }

    function takeFrame(requestTrace: DeviceTrace): PendingFrame | null {
      const frame = pendingFrame;
      pendingFrame = null;
      if (!frame || Date.now() - frame.receivedAt > 5_000) return null;
      if (frame.trace && frame.trace.requestId !== requestTrace.requestId) return null;
      return frame;
    }

    function streamInput(frame: PendingFrame | null, audioBytes?: number, audioMime?: string, clientSentAt?: string) {
      return {
        intent: lastIntent,
        query: lastQuery,
        audioBytes,
        audioMime,
        imageBytes: frame?.bytes.length ?? 0,
        frameSeq: frame?.seq,
        frameCapturedAt: frame?.capturedAt,
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
      reservedOperation?: number,
      reservedFrame?: PendingFrame | null,
    ) {
      if (!connectionTrace) {
        return safeSend(socket, { type: 'error', message: 'Send hello first', code: 'NO_HELLO' });
      }
      if (inFlight && reservedOperation === undefined) {
        return safeSend(socket, { type: 'error', trace: requestTrace, message: 'Frank is still processing', code: 'BUSY' });
      }

      const operationId = reservedOperation ?? ++activeOperation;
      const frame = reservedFrame === undefined ? takeFrame(requestTrace) : reservedFrame;
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
          input: { ...streamInput(frame, undefined, undefined, clientSentAt), utterance },
          stages: [],
        });
      }

      try {
        const request = UserRequestSchema.parse({
          trace: requestTrace,
          intent: lastIntent,
          modality: 'button',
          utterance,
          hasImage: Boolean(frame),
          query: lastIntent === 'recall' ? lastQuery : undefined,
          requestedAt: new Date().toISOString(),
        });

        const assistantReply = await frank.handleUserRequest(
          request,
          frame?.bytes,
          { source: 'device_stream', finishTrace: false, userId: req.userId },
        );
        if (localAbort.signal.aborted) return;

        lastReplyText = assistantReply.speak;
        if (frame) {
          safeSend(socket, { type: 'ack', seq: frame.seq, trace: requestTrace, processed: true });
        }
        safeSend(socket, {
          type: 'meta', trace: requestTrace, reply: assistantReply,
          timings: { totalMs: Date.now() - startedAt, frameSeq: frame?.seq }, costUnits: 3,
        });

        const speakText = pickDeviceSpeak(assistantReply);
        const audio = await stage(requestTrace, 'tts.synthesize', () => withDeadline(() => tts.speak({
          trace: requestTrace,
          text: speakText,
          voiceName: 'en-GB-Chirp3-HD-Sadachbia',
          languageCode: 'en-GB',
          speakingRate: 1.0,
          pitch: 0,
        }), 15_000, 'tts.synthesize'), { textCharacters: speakText.length });
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
          frameSeq: frame?.seq,
        });
      } catch (error: any) {
        if (!localAbort.signal.aborted) {
          await observability.fail(requestTrace.requestId, error?.message ?? 'Unknown error');
          safeSend(socket, { type: 'error', trace: requestTrace, message: error?.message ?? 'Unknown error', code: 'PROCESS_FAIL' });
        }
      } finally {
        if (activeOperation === operationId) inFlight = false;
      }
    }
  });
}
