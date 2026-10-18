import { describe, expect, it } from 'vitest';
import { GoogleTtsProvider } from '../../packages/providers/src/tts/googleTtsProvider.js';
import { GcvVisionProvider } from '../../packages/providers/src/vision/gcvVisionProvider.js';

describe('provider-native timeouts', () => {
  it('bounds text-to-speech inside the route deadline', async () => {
    const options: unknown[] = [];
    const provider = new GoogleTtsProvider({
      async synthesizeSpeech(_request, callOptions) {
        options.push(callOptions);
        return [{ audioContent: Buffer.from('audio') }];
      },
    });

    await provider.speak({ trace: { requestId: 'request-timeout-tts' }, text: 'Hello' });
    expect(options).toEqual([{ timeout: 12_000 }]);
  });

  it('bounds both vision operations inside the orchestrator deadline', async () => {
    const options: unknown[] = [];
    const client = {
      async documentTextDetection(_request: unknown, callOptions?: unknown) {
        options.push(callOptions);
        return [{}] as [object];
      },
      async labelDetection(_request: unknown, callOptions?: unknown) {
        options.push(callOptions);
        return [{}] as [object];
      },
    };
    const provider = new GcvVisionProvider(client);
    const args = {
      trace: { requestId: 'request-timeout-vision' },
      imageBytes: Buffer.from('image'),
      capturedAt: '2026-10-18T10:00:00.000Z',
    };

    await provider.analyzeOCR(args);
    await provider.analyzeLabels(args);
    expect(options).toEqual([{ timeout: 9_000 }, { timeout: 9_000 }]);
  });
});
