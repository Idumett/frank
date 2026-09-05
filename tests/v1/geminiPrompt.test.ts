import { describe, expect, it } from 'vitest';
import { buildFrankPrompt, FRANK_SYSTEM_INSTRUCTION } from '@frank/providers';

describe('Gemini prompt', () => {
  const trace = { requestId: 'prompt-test' };
  const perception = { trace, provider: 'gcv' as const, capturedAt: '2026-08-18T10:00:00.000Z', labels: [{ name: 'door', confidence: 0.9 }] };

  it('keeps reusable instructions separate from changing request data', () => {
    const prompt = buildFrankPrompt({ userUtterance: 'What is here?', perception, memoryHits: [], now: '2026-08-18T10:00:00.000Z' });
    expect(FRANK_SYSTEM_INSTRUCTION).not.toContain('What is here?');
    expect(prompt.indexOf('Time:')).toBeLessThan(prompt.indexOf('Question:'));
    expect(prompt).toContain('Position, distance, colour, material, and state are unknown');
  });

  it('does not repeat state flags or unbounded memory', () => {
    const prompt = buildFrankPrompt({ userUtterance: 'Where are my keys?', perception, memoryHits: ['Keys: hall table'], now: '2026-08-18T10:00:00.000Z' });
    expect(prompt).not.toContain('IMAGE_PRESENT');
    expect(prompt.match(/Keys: hall table/g)).toHaveLength(1);
  });
});
