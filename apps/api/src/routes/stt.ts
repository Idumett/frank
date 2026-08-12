import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRequestSchema } from '@frank/contracts';
import type { ObservabilityStore } from '@frank/core';
import { SttProvider } from '@frank/providers';
import { observedStage } from '../observability/stage.js';

export async function sttRoutes(
  app: FastifyInstance,
  stt: SttProvider,
  observability: ObservabilityStore,
) {
  app.post('/v1/stt', async (req) => {
    const BodySchema = z.object({
      trace: UserRequestSchema.shape.trace,
      audioBase64: z.string().min(20),
    });
    const body = BodySchema.parse(req.body);
    const audioBytes = Buffer.from(body.audioBase64, 'base64');

    await observability.start({
      requestId: body.trace.requestId,
      sessionId: body.trace.sessionId,
      source: 'stt',
      startedAt: new Date().toISOString(),
      input: { audioBytes: audioBytes.length },
      stages: [],
    });

    try {
      const result = await observedStage(
        observability,
        body.trace.requestId,
        'stt.transcribe',
        () => stt.transcribe({ trace: body.trace, audioBytes }),
        { audioBytes: audioBytes.length },
      );
      const output = { transcript: result.transcript, confidence: result.confidence };
      await observability.finish(body.trace.requestId, output);
      return { trace: body.trace, ...output };
    } catch (error: any) {
      await observability.fail(body.trace.requestId, error?.message ?? 'STT failed');
      throw error;
    }
  });
}
