import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TraceSchema } from '@frank/contracts';
import { listVoicesGoogleTts } from '@frank/providers';
import type { ProductDataPort } from '../productData/ProductDataPort.js';

export async function prefsTtsRoutes(app: FastifyInstance, deps: { prefs: ProductDataPort; claim: (userId: string, sessionId?: string) => void }) {
  const BodySchema = z.object({
    trace: TraceSchema,
    tts: z.object({
      languageCode: z.string().min(2).optional(),
      voiceName: z.string().min(3).optional(),
      speakingRate: z.number().min(0.5).max(2.0).optional(),
      pitch: z.number().min(-20).max(20).optional(),
    }),
  });

  app.post('/v1/prefs/tts', async (req, reply) => {
    const body = BodySchema.parse(req.body);

    const sessionId = body.trace.sessionId;
    if (!sessionId) {
      return reply.code(400).send({ error: 'trace.sessionId is required' });
    }
    deps.claim(req.userId, sessionId);

    // Optional but recommended: validate the voiceName exists
    if (body.tts.voiceName) {
      const voices = await listVoicesGoogleTts({}); // cached in provider helper
      const ok = voices.some((v) => v.name === body.tts.voiceName);
      if (!ok) {
        return reply.code(400).send({
          error: 'voiceName_not_available',
          message: 'That voiceName is not available. Fetch /v1/tts/voices and pick one.',
        });
      }
    }

    const saved = deps.prefs.setPreferences(req.userId, sessionId, body.tts);
    return reply.send({ ok: true, prefs: saved });
  });
}
