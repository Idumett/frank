import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';

import {
  loadExpectations,
  listFixtureImages,
  readFixtureImageBytes,
  containsAll,
} from './helpers/fixture';
import { makeFrankForTests, makeRequest } from './helpers/makeFrank';

describe('Frank fixtures (OCR/object + short replies + recapture behavior)', () => {
  const expectations = loadExpectations();
  const files = listFixtureImages();

  it('has fixture images', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  const frank = makeFrankForTests();

  for (const file of files) {
    const exp = expectations[file] ?? {
      intent: 'read_text',
      utterance: 'Read this.',
      expectedTextContains: [],
      maxLatencyMs: 20000,
    };

    it(`${file} -> intent=${exp.intent}`, async () => {
      const imageBytes = readFixtureImageBytes(file);

      const req = makeRequest({
        intent: exp.intent,
        utterance: exp.utterance ?? (exp.intent === 'read_text' ? 'Read this.' : 'Help me.'),
        query: exp.query,
      });

      const start = performance.now();
      const reply = await frank.handleUserRequest(req, imageBytes);
      const latencyMs = Math.round(performance.now() - start);

      // Basic sanity
      expect(reply.speak).toBeTruthy();
      expect(reply.speak.length).toBeLessThanOrEqual(260); // your enforced cap

      // Optional: short-ish (max 3 sentences is hard to perfectly test, but we can approximate)
      const sentences = reply.speak.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length).toBeLessThanOrEqual(3);

      // Latency threshold per fixture
      if (exp.maxLatencyMs) {
        expect(latencyMs).toBeLessThanOrEqual(exp.maxLatencyMs);
      }

      // Expected keyword checks (if provided)
      if (exp.expectedTextContains && exp.expectedTextContains.length > 0) {
        expect(containsAll(reply.speak, exp.expectedTextContains)).toBe(true);
      }

      // If the image is bad, it's OK to ask recapture.
      // But we do want to keep the behavior deterministic.
      if (file.includes('blurry') || file.includes('bad_lighting')) {
        // not a strict requirement; tweak per your preference
        expect(['recapture', 'none']).toContain(reply.suggestedAction);
      }
    }, 20_000); // increase if your cloud calls are slow
  }
});
