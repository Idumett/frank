import 'dotenv/config';
import Fastify from 'fastify';
import { AssistantReplySchema, type AssistantReply } from '@frank/contracts';

const app = Fastify({
  logger: true,
});

app.post('/v1/analyze', async () => {
  const reply: AssistantReply = {
    trace: { requestId: crypto.randomUUID() },
    speak: 'Hello, I am Frank.',
    createdAt: new Date().toISOString(),
    groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 },
    suggestedAction: 'none',
  };

  return AssistantReplySchema.parse(reply);
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
