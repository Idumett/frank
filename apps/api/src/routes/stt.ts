import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRequestSchema } from '@frank/contracts';
import { GoogleSttProvider } from '@frank/providers';

const stt = new GoogleSttProvider();

//TODO: People talk differently, can we tune each instance to someone's accent(like siri)?
export async function sttRoutes(app: FastifyInstance) {
  app.post('/v1/stt', async (req) => {
    const BodySchema = z.object({
      trace: UserRequestSchema.shape.trace,
      audioBase64: z.string().min(20),
      mimeType: z.string().min(3).default('audio/wav'),
      languageCode: z.string().default('en-GB'),
      sampleRateHertz: z.number().int().optional(),
    });

    const body = BodySchema.parse(req.body);

    const audioBytes = Buffer.from(body.audioBase64, 'base64');

    // NOTE: Google STT config must match audio encoding.
    // In our GoogleSttProvider we defaulted to LINEAR16 WAV.
    const result = await stt.transcribe({
      trace: body.trace,
      audioBytes,
      mimeType: body.mimeType,
      languageCode: body.languageCode,
      sampleRateHertz: body.sampleRateHertz,
    });

    return {
      trace: body.trace,
      transcript: result.transcript,
      confidence: result.confidence,
    };
  });
}
