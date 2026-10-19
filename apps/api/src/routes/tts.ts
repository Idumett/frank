import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRequestSchema } from '@frank/contracts';
import { withDeadline, type ObservabilityStore } from '@frank/core';
import { TtsProvider } from '@frank/providers';
import { observedStage } from '../observability/stage.js';
import { ttsCacheKey } from '../ttsCache.js';

export async function ttsRoutes(
  app: FastifyInstance,
  tts: TtsProvider,
  observability: ObservabilityStore, claim: (userId: string, sessionId?: string) => void,
) {
  app.post('/v1/tts', async (req, reply) => {
    const BodySchema = z.object({
      trace: UserRequestSchema.shape.trace,
      text: z.string().min(1).max(4000),
      languageCode: z.string().default('en-GB'),
      voiceName: z.string().optional(),
      raw: z.boolean().default(false),
    });
    const body = BodySchema.parse(req.body);
    claim(req.userId, body.trace.sessionId);
    const key = ttsCacheKey({ text: body.text, voice: body.voiceName, languageCode: body.languageCode });

    await observability.start({
      requestId: body.trace.requestId,
      userId: req.userId,
      sessionId: body.trace.sessionId,
      source: 'tts',
      startedAt: new Date().toISOString(),
      input: { textCharacters: body.text.length, languageCode: body.languageCode, voiceName: body.voiceName },
      stages: [],
    });

    try {
      const audio = await observedStage(
        observability,
        body.trace.requestId,
        'tts.synthesize',
        () => withDeadline(
          () => tts.speak({ trace: body.trace, text: body.text, languageCode: body.languageCode, voiceName: body.voiceName }),
          15_000,
          'tts.synthesize',
        ),
        { textCharacters: body.text.length },
      );
      const audioBytes = audio.audioBytes;
      const cacheStatus = audio.cacheStatus ?? 'miss';

      await observability.finish(body.trace.requestId, { audioBytes: audioBytes.length, cacheStatus });
      reply.header('x-tts-cache', cacheStatus);

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
