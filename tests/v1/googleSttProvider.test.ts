import { describe, expect, it } from 'vitest';
import { GoogleSttProvider } from '../../packages/providers/src/stt/googleSttProvider.js';

describe('GoogleSttProvider', () => {
  it('uses the short model first without unsupported recognition fields', async () => {
    const requests: any[] = [];
    const client = {
      async recognize(request: any) {
        requests.push(request);
        return [{ results: [{ alternatives: [{ transcript: 'quiet request', confidence: 0.8 }] }] }];
      },
    };
    const provider = new GoogleSttProvider({
      client,
      fallbackClient: client,
      recognizer: 'test-recognizer',
    });

    const result = await provider.transcribe({
      trace: { requestId: 'request-12345678' },
      audioBytes: Buffer.from('wav'),
      mimeType: 'audio/wav',
    });

    expect(result).toEqual({ transcript: 'quiet request', confidence: 0.8 });
    expect(requests).toHaveLength(1);
    expect(requests[0].config.model).toBe('short');
    expect(requests[0].config.denoiserConfig).toBeUndefined();
    expect(requests[0].configMask).toEqual({ paths: ['*'] });
  });

  it('retries an empty short-model result with the fallback model', async () => {
    const models: string[] = [];
    const client = {
      async recognize(request: any) {
        models.push(request.config.model);
        return models.length === 1
          ? [{ results: [] }]
          : [{ results: [{ alternatives: [{ transcript: 'heard on retry' }] }] }];
      },
    };
    const provider = new GoogleSttProvider({
      client,
      fallbackClient: client,
      recognizer: 'test-recognizer',
    });

    const result = await provider.transcribe({
      trace: { requestId: 'request-12345678' },
      audioBytes: Buffer.from('wav'),
    });

    expect(models).toEqual(['short', 'long']);
    expect(result.transcript).toBe('heard on retry');
  });

  it('uses the independent V1 command recognizer after empty V2 results', async () => {
    const v2Client = {
      async recognize() {
        return [{ results: [] }];
      },
    };
    const fallbackRequests: any[] = [];
    const fallbackClient = {
      async recognize(request: any) {
        fallbackRequests.push(request);
        return [{ results: [{ alternatives: [{ transcript: 'quiet but clear' }] }] }];
      },
    };
    const provider = new GoogleSttProvider({
      client: v2Client,
      fallbackClient,
      recognizer: 'test-recognizer',
    });

    const result = await provider.transcribe({
      trace: { requestId: 'request-12345678' },
      audioBytes: Buffer.from('wav'),
      sampleRateHertz: 16_000,
    });

    expect(result.transcript).toBe('quiet but clear');
    expect(fallbackRequests).toHaveLength(1);
    expect(fallbackRequests[0].config.model).toBe('command_and_search');
  });
});
