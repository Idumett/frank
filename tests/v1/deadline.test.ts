import { describe, expect, it } from 'vitest';
import { withDeadline } from '@frank/core';

describe('provider deadlines', () => {
  it('returns completed provider work', async () => {
    await expect(withDeadline(async () => 'done', 50, 'provider')).resolves.toBe('done');
  });

  it('rejects provider work that exceeds its deadline', async () => {
    await expect(withDeadline(() => new Promise(() => {}), 5, 'Vision')).rejects.toThrow('Vision timed out after 5ms');
  });
});
