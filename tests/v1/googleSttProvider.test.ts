import { describe, expect, it } from 'vitest';
import { GoogleSttProvider } from '../../packages/providers/src/stt/googleSttProvider.js';

describe('GoogleSttProvider', () => {
  it('disables low-SNR rejection and uses the short model first', async () => {
    const requests: any[] = [];
    const client = {
      async recognize(request: any) {
        requests.push(request);
        return [{ results: [{ alternatives: [{ transcript: 'quiet request', confidence: 0.8 }] }] }];
      },
    };
    const provider = new GoogleSttProvider({ client, recognizer: 'test-recognizer' });

    const result = await provider.transcribe({
      trace: { requestId: 'request-12345678' },
      audioBytes: Buffer.from('wav'),
      mimeType: 'audio/wav',
    });

    expect(result).toEqual({ transcript: 'quiet request', confidence: 0.8 });
    expect(requests).toHaveLength(1);
    expect(requests[0].config.model).toBe('short');
    expect(requests[0].config.denoiserConfig).toEqual({ denoiseAudio: false, snrThreshold: 0 });
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
    const provider = new GoogleSttProvider({ client, recognizer: 'test-recognizer' });

    const result = await provider.transcribe({
      trace: { requestId: 'request-12345678' },
      audioBytes: Buffer.from('wav'),
    });

    expect(models).toEqual(['short', 'long']);
    expect(result.transcript).toBe('heard on retry');
  });
});
