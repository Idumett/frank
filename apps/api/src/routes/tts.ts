import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRequestSchema } from '@frank/contracts';
import type { ObservabilityStore } from '@frank/core';
import { TtsProvider } from '@frank/providers';
import { observedStage } from '../observability/stage.js';
import { ensureTtsCacheDir, readCachedTts, ttsCacheKey, writeCachedTts } from '../ttsCache.js';

export async function ttsRoutes(
  app: FastifyInstance,
  tts: TtsProvider,
  observability: ObservabilityStore,
) {
  ensureTtsCacheDir();

  app.post('/v1/tts', async (req, reply) => {
    const BodySchema = z.object({
      trace: UserRequestSchema.shape.trace,
      text: z.string().min(1).max(4000),
      languageCode: z.string().default('en-GB'),
      voiceName: z.string().optional(),
      raw: z.boolean().default(false),
    });
    const body = BodySchema.parse(req.body);
    const key = ttsCacheKey({ text: body.text, voice: body.voiceName, languageCode: body.languageCode });

    await observability.start({
      requestId: body.trace.requestId,
      sessionId: body.trace.sessionId,
      source: 'tts',
      startedAt: new Date().toISOString(),
      input: { textCharacters: body.text.length, languageCode: body.languageCode, voiceName: body.voiceName },
      stages: [],
    });

    try {
      let cacheHit = true;
      let audioBytes = await observedStage(
        observability,
        body.trace.requestId,
        'tts.cache_read',
        async () => readCachedTts(key),
      );

      if (!audioBytes) {
        cacheHit = false;
        const audio = await observedStage(
          observability,
          body.trace.requestId,
          'tts.synthesize',
          () => tts.speak({ trace: body.trace, text: body.text, languageCode: body.languageCode, voiceName: body.voiceName }),
          { textCharacters: body.text.length },
        );
        audioBytes = audio.audioBytes;
        await observedStage(observability, body.trace.requestId, 'tts.cache_write', async () => writeCachedTts(key, audioBytes!));
      }

      await observability.finish(body.trace.requestId, { audioBytes: audioBytes.length, cacheHit });
      reply.header('x-tts-cache', cacheHit ? 'hit' : 'miss');

      if (body.raw) {
        reply.header('content-type', 'audio/mpeg');
        return reply.send(audioBytes);
      }

      return { trace: body.trace, mimeType: 'audio/mpeg', audioBase64: audioBytes.toString('base64'), cacheKey: key };
    } catch (error: any) {
      await observability.fail(body.trace.requestId, error?.message ?? 'TTS failed');
      throw error;
    }
  });
}
