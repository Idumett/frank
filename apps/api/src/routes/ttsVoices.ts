import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listVoicesGoogleTts } from '@frank/providers';

export async function ttsVoicesRoutes(app: FastifyInstance) {
  app.get('/v1/tts/voices', async (req, reply) => {
    const Query = z.object({ languageCode: z.string().optional() });
    const { languageCode } = Query.parse(req.query);

    const voices = await listVoicesGoogleTts({ languageCode });
    return reply.send({ voices });
  });
}
