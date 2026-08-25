import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';

import { TtsProvider, SttProvider } from '@frank/providers';
import {
  ContextSnapshotV1Schema,
  UserRequestSchema,
  type ContextSnapshotV1,
} from '@frank/contracts';
import {
  FrankOrchestrator,
  pickDeviceSpeak,
  withDeadline,
  type ObservabilityStore,
} from '@frank/core';
import { frameAge, inferIntent, intentNeedsImage, maxFrameAgeMs } from '../evidence/policy.js';
import {
  ContextSnapshotError,
  selectContext,
  validateSnapshot,
} from '../context/contextSnapshot.js';

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
    trace: TraceSchema,
    frameId: z.string().min(8).max(100),
    seq: z.number().int().min(0),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    bytesBase64: z.string().min(20).max(11_000_000),
    capturedAt: z.string(),
    ageMs: z.number().int().min(0).max(60_000),
    quality: z.enum(['unknown', 'good', 'poor']).default('unknown'),
  }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('context_snapshot'), snapshot: ContextSnapshotV1Schema }),
  z.object({ type: z.literal('repeat') }),
  z.object({ type: z.literal('ping'), t: z.number() }),
]);

type DeviceTrace = { requestId: string; sessionId?: string };
type PendingFrame = {
  bytes: Buffer;
  seq: number;
  frameId: string;
  capturedAt: string;
  ageMs: number;
  clientQuality: 'unknown' | 'good' | 'poor';
  trace: DeviceTrace;
  receivedAt: number;
};
type PendingTurn = {
  utterance: string;
  trace: DeviceTrace;
  operationId: number;
  sentAt?: string;
  timeout: NodeJS.Timeout;
};

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
  takeRequest: (userId: string) => { allowed: boolean; retryAfterSeconds: number } = () => ({
    allowed: true,
    retryAfterSeconds: 0,
  }),
) {
  await app.register(websocket, { options: { maxPayload: 12 * 1024 * 1024 } });

  app.get('/v1/device/stream', { websocket: true }, (socket, req) => {
    let connectionTrace: DeviceTrace | null = null;
    let activeTrace: DeviceTrace | null = null;
    let lastIntent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help' = 'help';
    let lastQuery: string | undefined;
    let pendingFrame: PendingFrame | null = null;
    let pendingTurn: PendingTurn | null = null;
    let lastReplyText: string | null = null;
    let lastAudioBytesBase64: string | null = null;
    let inFlight = false;
    let activeOperation = 0;
    let abort = new AbortController();
    let currentContext: ContextSnapshotV1 | null = null;

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
        return safeSend(socket, {
          type: 'error',
          message: 'Invalid message shape',
          code: 'BAD_MSG',
        });
      }

      const m = msg.data;
      if (m.type === 'ping') return safeSend(socket, { type: 'pong', t: m.t });

      if (m.type === 'hello') {
        try {
          claim(req.userId, m.trace.sessionId);
        } catch {
          safeSend(socket, {
            type: 'error',
            message: 'Session unavailable',
            code: 'SESSION_FORBIDDEN',
          });
          socket.close(1008);
          return;
        }
        connectionTrace = m.trace;
        safeSend(socket, { type: 'ready', trace: connectionTrace });
        return;
      }

      if (m.type === 'intent') {
        lastIntent = m.intent;
        lastQuery = m.query;
        return;
      }

      if (m.type === 'context_snapshot') {
        if (!connectionTrace?.sessionId)
          return safeSend(socket, { type: 'error', message: 'Send hello first', code: 'NO_HELLO' });
        try {
          currentContext = validateSnapshot(m.snapshot, connectionTrace.sessionId);
          return safeSend(socket, {
            type: 'context_ack',
            snapshotId: currentContext.snapshotId,
            acceptedAt: new Date().toISOString(),
          });
        } catch (error) {
          const code = error instanceof ContextSnapshotError ? error.code : 'BAD_CONTEXT';
          return safeSend(socket, {
            type: 'error',
            message: 'Context snapshot was rejected',
            code,
          });
        }
      }

      if (m.type === 'frame') {
        if (!connectionTrace) {
          return safeSend(socket, { type: 'error', message: 'Send hello first', code: 'NO_HELLO' });
        }
        if (!pendingTurn || pendingTurn.trace.requestId !== m.trace.requestId) {
          return safeSend(socket, {
            type: 'error',
            trace: m.trace,
            message: 'No camera evidence was requested for this turn.',
            code: 'UNEXPECTED_FRAME',
          });
        }
        const freshness = frameAge(m.capturedAt, m.ageMs);
        if (!freshness.valid || freshness.ageMs > maxFrameAgeMs()) {
          return safeSend(socket, {
            type: 'error',
            trace: m.trace,
            message: 'That camera view is too old. Point the camera at the subject and try again.',
            code: 'STALE_FRAME',
          });
        }
        pendingFrame = {
          bytes: Buffer.from(m.bytesBase64, 'base64'),
          seq: m.seq,
          frameId: m.frameId,
          capturedAt: m.capturedAt,
          ageMs: freshness.ageMs,
          clientQuality: m.quality,
          trace: m.trace,
          receivedAt: Date.now(),
        };
        const turn = pendingTurn;
        pendingTurn = null;
        clearTimeout(turn.timeout);
        await maybeProcess(
          turn.utterance,
          turn.trace,
          true,
          turn.sentAt,
          turn.operationId,
          takeFrame(turn.trace),
        );
        return;
      }

      if (m.type === 'utterance') {
        if (!takeRequest(req.userId).allowed)
          return safeSend(socket, {
            type: 'error',
            message: 'Too many requests',
            code: 'RATE_LIMITED',
          });
        const requestTrace = resolveTrace(m.trace);
        lastIntent = inferIntent(m.text, lastIntent);
        const frame = intentNeedsImage(lastIntent) ? takeFrame(requestTrace) : null;
        if (intentNeedsImage(lastIntent) && !frame) {
          safeSend(socket, {
            type: 'error',
            trace: requestTrace,
            message: 'Point the camera at what you want me to check and try again.',
            code: 'FRAME_REQUIRED',
          });
          lastIntent = 'help';
          return;
        }
        await maybeProcess(m.text, requestTrace, false, m.sentAt, undefined, frame);
        return;
      }

      if (m.type === 'audio') {
        if (!takeRequest(req.userId).allowed)
          return safeSend(socket, {
            type: 'error',
            message: 'Too many requests',
            code: 'RATE_LIMITED',
          });
        if (!connectionTrace) {
          return safeSend(socket, { type: 'error', message: 'Send hello first', code: 'NO_HELLO' });
        }
        const requestTrace = resolveTrace(m.trace);
        if (inFlight) {
          return safeSend(socket, {
            type: 'error',
            trace: requestTrace,
            message: 'Frank is still processing',
            code: 'BUSY',
          });
        }

        inFlight = true;
        activeTrace = requestTrace;
        const operationId = ++activeOperation;
        const frame = null;
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

        let deferredForFrame = false;
        try {
          const sttResult = await stage(
            requestTrace,
            'stt.transcribe',
            () =>
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

          lastIntent = inferIntent(sttResult.transcript, lastIntent);
          if (intentNeedsImage(lastIntent) && !frame) {
            deferredForFrame = true;
            const timeout = setTimeout(
              async () => {
                if (pendingTurn?.operationId !== operationId) return;
                pendingTurn = null;
                inFlight = false;
                lastIntent = 'help';
                await observability.fail(
                  requestTrace.requestId,
                  'Fresh camera evidence was not received',
                );
                safeSend(socket, {
                  type: 'error',
                  trace: requestTrace,
                  message: 'Point the camera at what you want me to check and try again.',
                  code: 'FRAME_REQUIRED',
                });
              },
              positiveInt(process.env.FRAME_WAIT_MS, 3_000),
            );
            pendingTurn = {
              utterance: sttResult.transcript,
              trace: requestTrace,
              operationId,
              sentAt: m.sentAt,
              timeout,
            };
            safeSend(socket, {
              type: 'frame_required',
              trace: requestTrace,
              maxAgeMs: maxFrameAgeMs(),
              reason: lastIntent,
            });
          } else {
            await maybeProcess(
              sttResult.transcript,
              requestTrace,
              true,
              m.sentAt,
              operationId,
              intentNeedsImage(lastIntent) ? frame : null,
            );
          }
        } catch (error: any) {
          await observability.fail(requestTrace.requestId, error?.message ?? 'STT failed');
          safeSend(socket, {
            type: 'error',
            trace: requestTrace,
            message: error?.message ?? 'STT failed',
            code: 'STT_FAIL',
          });
        } finally {
          if (activeOperation === operationId && !deferredForFrame) inFlight = false;
        }
        return;
      }

      if (m.type === 'repeat') {
        if (lastReplyText)
          safeSend(socket, { type: 'meta', trace: activeTrace, reply: { speak: lastReplyText } });
        if (lastAudioBytesBase64)
          safeSend(socket, {
            type: 'audio',
            trace: activeTrace,
            mime: 'audio/mpeg',
            bytesBase64: lastAudioBytesBase64,
          });
        return;
      }

      if (m.type === 'stop') {
        if (pendingTurn) {
          clearTimeout(pendingTurn.timeout);
          pendingTurn = null;
        }
        abort.abort();
        abort = new AbortController();
        activeOperation += 1;
        inFlight = false;
        if (activeTrace) await observability.fail(activeTrace.requestId, 'Stopped by client');
        safeSend(socket, { type: 'stopped', trace: activeTrace });
      }
    });

    socket.on('close', async () => {
      if (pendingTurn) {
        clearTimeout(pendingTurn.timeout);
        pendingTurn = null;
      }
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
      if (!frame || Date.now() - frame.receivedAt > maxFrameAgeMs()) return null;
      if (frame.ageMs + Date.now() - frame.receivedAt > maxFrameAgeMs()) return null;
      if (frame.trace.requestId !== requestTrace.requestId) return null;
      return frame;
    }

    function streamInput(
      frame: PendingFrame | null,
      audioBytes?: number,
      audioMime?: string,
      clientSentAt?: string,
    ) {
      return {
        intent: lastIntent,
        query: lastQuery,
        audioBytes,
        audioMime,
        imageBytes: frame?.bytes.length ?? 0,
        frameSeq: frame?.seq,
        frameCapturedAt: frame?.capturedAt,
        frameId: frame?.frameId,
        frameAgeMs: frame ? frame.ageMs + Date.now() - frame.receivedAt : undefined,
        frameClientQuality: frame?.clientQuality,
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
          name,
          startedAt,
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - start,
          ok: true,
          data,
        });
        return result;
      } catch (error: any) {
        await observability.addStage(requestTrace.requestId, {
          name,
          startedAt,
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - start,
          ok: false,
          data,
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
        return safeSend(socket, {
          type: 'error',
          trace: requestTrace,
          message: 'Frank is still processing',
          code: 'BUSY',
        });
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
        const contextCandidate = selectContext(currentContext, lastIntent, utterance, frame?.frameId);
        const selectedContext = await stage(
          requestTrace,
          'context.select',
          async () => contextCandidate,
          {
            snapshotId: currentContext?.snapshotId,
            snapshotAgeMs: currentContext
              ? Date.now() - Date.parse(currentContext.capturedAt)
              : undefined,
            selectedKeys: contextCandidate?.facts.map((fact) => fact.key) ?? [],
            statuses: contextCandidate?.facts.map((fact) => fact.status) ?? [],
          },
        );
        const request = UserRequestSchema.parse({
          trace: requestTrace,
          intent: lastIntent,
          modality: 'button',
          utterance,
          hasImage: Boolean(frame),
          imageEvidence: frame
            ? {
                frameId: frame.frameId,
                capturedAt: frame.capturedAt,
                ageMs: frame.ageMs + Date.now() - frame.receivedAt,
                clientQuality: frame.clientQuality,
              }
            : undefined,
          query: lastIntent === 'recall' ? lastQuery : undefined,
          requestedAt: new Date().toISOString(),
          context: selectedContext,
        });

        const assistantReply = await frank.handleUserRequest(request, frame?.bytes, {
          source: 'device_stream',
          finishTrace: false,
          userId: req.userId,
        });
        if (localAbort.signal.aborted) return;

        lastReplyText = assistantReply.speak;
        if (frame) {
          safeSend(socket, { type: 'ack', seq: frame.seq, trace: requestTrace, processed: true });
        }
        safeSend(socket, {
          type: 'meta',
          trace: requestTrace,
          reply: assistantReply,
          timings: { totalMs: Date.now() - startedAt, frameSeq: frame?.seq },
          costUnits: 3,
          evidence: frame
            ? {
                frameId: frame.frameId,
                capturedAt: frame.capturedAt,
                ageMs: frame.ageMs + Date.now() - frame.receivedAt,
                quality: assistantReply.imageEvidence?.quality ?? 'ok',
              }
            : undefined,
        });

        const speakText = pickDeviceSpeak(assistantReply);
        const audio = await stage(
          requestTrace,
          'tts.synthesize',
          () =>
            withDeadline(
              () =>
                tts.speak({
                  trace: requestTrace,
                  text: speakText,
                  voiceName: 'en-GB-Chirp3-HD-Sadachbia',
                  languageCode: 'en-GB',
                  speakingRate: 1.0,
                  pitch: 0,
                }),
              15_000,
              'tts.synthesize',
            ),
          { textCharacters: speakText.length },
        );
        if (localAbort.signal.aborted) return;

        const b64 = audio.audioBytes.toString('base64');
        lastAudioBytesBase64 = b64;
        const sent = await stage(
          requestTrace,
          'stream.send_audio',
          async () =>
            safeSend(socket, {
              type: 'audio',
              trace: requestTrace,
              mime: audio.mimeType,
              bytesBase64: b64,
            }),
          { audioBytes: audio.audioBytes.length },
        );
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
          safeSend(socket, {
            type: 'error',
            trace: requestTrace,
            message: error?.message ?? 'Unknown error',
            code: 'PROCESS_FAIL',
          });
        }
      } finally {
        if (activeOperation === operationId) {
          inFlight = false;
          lastIntent = 'help';
          lastQuery = undefined;
        }
      }
    }
  });
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
