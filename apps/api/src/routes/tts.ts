import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRequestSchema } from '@frank/contracts';
import { GoogleTtsProvider } from '@frank/providers';
import { ensureTtsCacheDir, readCachedTts, ttsCacheKey, writeCachedTts } from '../ttsCache.js';

const tts = new GoogleTtsProvider();

//TODO: Can we set the accent we want?
export async function ttsRoutes(app: FastifyInstance) {
  ensureTtsCacheDir();

  app.post('/v1/tts', async (req, reply) => {
    const BodySchema = z.object({
      trace: UserRequestSchema.shape.trace,
      text: z.string().min(1).max(4000),
      languageCode: z.string().default('en-GB'),
      voiceName: z.string().optional(),
      // If true, return raw audio instead of base64 JSON (useful for clients)
      raw: z.boolean().default(false),
    });

    const body = BodySchema.parse(req.body);

    const key = ttsCacheKey({
      text: body.text,
      voice: body.voiceName,
      languageCode: body.languageCode,
    });

    let audioBytes = readCachedTts(key);
    if (!audioBytes) {
      const audio = await tts.speak({
        trace: body.trace,
        text: body.text,
        languageCode: body.languageCode,
        voiceName: body.voiceName,
      });
      audioBytes = audio.audioBytes;
      writeCachedTts(key, audioBytes);
    }

    // Return raw audio (fast + smaller) OR base64 JSON (simple)
    if (body.raw) {
      reply.header('content-type', 'audio/mpeg');
      reply.header('x-tts-cache', audioBytes ? 'hit-or-miss' : 'miss');
      return reply.send(audioBytes);
    }

    return {
      trace: body.trace,
      mimeType: 'audio/mpeg',
      audioBase64: audioBytes.toString('base64'),
      cacheKey: key,
    };
  });
}
