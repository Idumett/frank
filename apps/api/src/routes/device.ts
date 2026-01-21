import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { UserRequestSchema } from '@frank/contracts';
import { GoogleTtsProvider } from '@frank/providers';
import { FrankOrchestrator } from '@frank/core';

const tts = new GoogleTtsProvider();

export async function deviceRoutes(app: FastifyInstance, frank: FrankOrchestrator) {
  await app.register(multipart, {
    limits: {
      fileSize: 8 * 1024 * 1024, // 8MB per frame
      files: 1,
    },
  });

  app.post('/v1/device/frame', async (req, reply) => {
    // Parse multipart parts
    const parts = req.parts();

    let imageBytes: Buffer | null = null;
    let payloadRaw: string | null = null;

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'frame') {
        imageBytes = await part.toBuffer();
      } else if (part.type === 'field' && part.fieldname === 'payload') {
        payloadRaw = String(part.value);
      }
    }

    if (!imageBytes) {
      return reply.code(400).send({ error: 'Missing frame file field' });
    }
    if (!payloadRaw) {
      return reply.code(400).send({ error: 'Missing payload field' });
    }

    const PayloadSchema = UserRequestSchema.extend({
      wantAudio: z.boolean().default(true),
      // optional: include client timestamp if needed
      clientCapturedAt: z.string().optional(),
    });

    const payload = PayloadSchema.parse(JSON.parse(payloadRaw));
    const startedAt = Date.now();

    // Run Frank core
    const assistantReply = await frank.handleUserRequest(payload, imageBytes);

    const nowIso = new Date().toISOString();

    // Generate audio (optional)
    let audioBytes: Buffer | null = null;
    if (payload.wantAudio) {
      const audio = await tts.speak({
        trace: payload.trace,
        text: assistantReply.speak,
        languageCode: 'en-GB',
      });
      audioBytes = audio.audioBytes;
    }

    const totalMs = Date.now() - startedAt;

    const meta = {
      trace: payload.trace,
      reply: assistantReply,
      timings: { totalMs },
      // keep this simple for now
      costUnits: 3,
      createdAt: nowIso,
    };

    // Return multipart/mixed: JSON + audio
    const boundary = `frank_${Math.random().toString(16).slice(2)}`;
    reply.header('content-type', `multipart/mixed; boundary=${boundary}`);

    const jsonPart =
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n`;

    const audioPartHeader = audioBytes
      ? `--${boundary}\r\nContent-Type: audio/mpeg\r\nContent-Disposition: attachment; filename="reply.mp3"\r\n\r\n`
      : '';

    const end = `\r\n--${boundary}--\r\n`;

    // Send as a single buffer to keep it simple
    const chunks: Buffer[] = [Buffer.from(jsonPart, 'utf8')];

    if (audioBytes) {
      chunks.push(Buffer.from(audioPartHeader, 'utf8'));
      chunks.push(audioBytes);
    }

    chunks.push(Buffer.from(end, 'utf8'));

    return reply.send(Buffer.concat(chunks));
  });
}
