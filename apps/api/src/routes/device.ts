import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { UserRequestSchema } from '@frank/contracts';
import { withDeadline, type ObservabilityStore } from '@frank/core';
import { TtsProvider, SttProvider } from '@frank/providers';
import { FrankOrchestrator, pickDeviceSpeak, resolveTtsPrefs } from '@frank/core';
import { observedStage } from '../observability/stage.js';
import { UserPrefsStoreAdapter } from '../prefs/UserPrefsStoreAdapter.js';
import type { ProductDataPort } from '../productData/ProductDataPort.js';

export async function deviceRoutes(
  app: FastifyInstance,
  frank: FrankOrchestrator,
  _stt: SttProvider,
  tts: TtsProvider,
  deps: { prefs: ProductDataPort; observability: ObservabilityStore; claim: (userId: string, sessionId?: string) => void },
) {
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  app.post('/v1/device/frame', async (req, reply) => {
    const parts = req.parts();
    let imageBytes: Buffer | null = null;
    let payloadRaw: string | null = null;

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'frame') imageBytes = await part.toBuffer();
      else if (part.type === 'field' && part.fieldname === 'payload') payloadRaw = String(part.value);
    }

    if (!imageBytes) return reply.code(400).send({ error: 'Missing frame file field' });
    if (!payloadRaw) return reply.code(400).send({ error: 'Missing payload field' });

    const PayloadSchema = UserRequestSchema.extend({
      wantAudio: z.boolean().default(true),
      clientCapturedAt: z.string().optional(),
    });
    const payload = PayloadSchema.parse(JSON.parse(payloadRaw));
    deps.claim(req.userId, payload.trace.sessionId);

    await deps.observability.start({
      requestId: payload.trace.requestId,
      userId: req.userId,
      sessionId: payload.trace.sessionId,
      source: 'device_frame',
      startedAt: new Date().toISOString(),
      input: {
        intent: payload.intent,
        imageBytes: imageBytes.length,
        wantAudio: payload.wantAudio,
        clientCapturedAt: payload.clientCapturedAt,
      },
      stages: [],
    });

    try {
      const startedAt = Date.now();
      const assistantReply = await frank.handleUserRequest(payload, imageBytes, {
        source: 'device_frame',
        finishTrace: false,
        userId: req.userId,
      });
      let audioBytes: Buffer | null = null;

      if (payload.wantAudio) {
        const prefsAdapter = new UserPrefsStoreAdapter(deps.prefs, req.userId);
        const resolved = await resolveTtsPrefs({
          trace: payload.trace,
          prefs: prefsAdapter,
          defaults: {
            languageCode: process.env.DEFAULT_TTS_LANGUAGE_CODE ?? 'en-GB',
            voiceName: process.env.DEFAULT_TTS_VOICE_NAME,
          },
        });
        const speakText = pickDeviceSpeak(assistantReply);
        const audio = await observedStage(
          deps.observability,
          payload.trace.requestId,
          'tts.synthesize',
          () => withDeadline(() => tts.speak({
            trace: payload.trace,
            text: speakText,
            languageCode: resolved.languageCode,
            voiceName: resolved.voiceName,
            speakingRate: resolved.speakingRate,
            pitch: resolved.pitch,
          }), 15_000, 'tts.synthesize'),
          { textCharacters: speakText.length },
        );
        audioBytes = audio.audioBytes;
      }

      const meta = {
        trace: payload.trace,
        reply: assistantReply,
        timings: { totalMs: Date.now() - startedAt },
        costUnits: 3,
        createdAt: new Date().toISOString(),
      };
      await deps.observability.finish(payload.trace.requestId, {
        speak: assistantReply.speak,
        suggestedAction: assistantReply.suggestedAction,
        audioBytes: audioBytes?.length ?? 0,
      });

      const boundary = `frank_${Math.random().toString(16).slice(2)}`;
      reply.header('content-type', `multipart/mixed; boundary=${boundary}`);
      const chunks: Buffer[] = [Buffer.from(
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n`,
        'utf8',
      )];
      if (audioBytes) {
        chunks.push(Buffer.from(
          `--${boundary}\r\nContent-Type: audio/mpeg\r\nContent-Disposition: attachment; filename="reply.mp3"\r\n\r\n`,
          'utf8',
        ));
        chunks.push(audioBytes);
      }
      chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
      return reply.send(Buffer.concat(chunks));
    } catch (error: any) {
      await deps.observability.fail(payload.trace.requestId, error?.message ?? 'Device frame failed');
      throw error;
    }
  });
}
