import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRequestSchema } from '@frank/contracts';
import { SttProvider } from '@frank/providers';

export async function sttRoutes(app: FastifyInstance, stt: SttProvider) {
  app.post('/v1/stt', async (req) => {
    const BodySchema = z.object({
      trace: UserRequestSchema.shape.trace,
      audioBase64: z.string().min(20),
    });

    const body = BodySchema.parse(req.body);
    const audioBytes = Buffer.from(body.audioBase64, 'base64');

    const result = await stt.transcribe({
      trace: body.trace,
      audioBytes,
    });

    return {
      trace: body.trace,
      transcript: result.transcript,
      confidence: result.confidence,
    };
  });
}
