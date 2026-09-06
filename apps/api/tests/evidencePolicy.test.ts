import { describe, expect, it } from 'vitest';
import { frameAge, inferIntent, intentNeedsImage } from '../src/evidence/policy.js';

describe('camera evidence policy', () => {
  it.each([
    ['What time is it?', 'help', false],
    ['Where did I leave my keys?', 'recall', false],
    ['Tell me more about that', 'help', false],
    ['Read this label', 'read_text', true],
    ['What is in front of me?', 'describe_scene', true],
    ['What am I looking at?', 'describe_scene', true],
    ['What am I seeing?', 'describe_scene', true],
    ['Can you tell me what I am looking at?', 'describe_scene', true],
    ['Remember this for later', 'remember_this', true],
  ] as const)('classifies %s', (utterance, expected, needsImage) => {
    const intent = inferIntent(utterance);
    expect(intent).toBe(expected);
    expect(intentNeedsImage(intent)).toBe(needsImage);
  });

  it('uses the older of measured and client-reported frame age', () => {
    const now = Date.now();
    expect(frameAge(new Date(now - 500).toISOString(), 2_000, now)).toEqual({
      valid: true,
      ageMs: 2_000,
    });
    expect(frameAge(new Date(now - 5_000).toISOString(), 100, now)).toEqual({
      valid: true,
      ageMs: 5_000,
    });
  });
});
