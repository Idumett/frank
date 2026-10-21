import { expect, test } from 'vitest';
import { ServiceLifecycle } from '../src/lifecycle.js';

test('marks the service draining immediately and performs shutdown once', async () => {
  const lifecycle = new ServiceLifecycle();
  let closes = 0;
  let cleanups = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const close = async () => { closes += 1; await wait; };
  const cleanup = () => { cleanups += 1; };

  const first = lifecycle.shutdown(close, cleanup);
  const second = lifecycle.shutdown(close, cleanup);
  expect(lifecycle.isDraining).toBe(true);
  expect(first).toBe(second);
  release();
  await first;
  expect(closes).toBe(1);
  expect(cleanups).toBe(1);
});

test('still cleans resources when listener shutdown fails', async () => {
  const lifecycle = new ServiceLifecycle();
  let cleaned = false;
  await expect(
    lifecycle.shutdown(async () => { throw new Error('close failed'); }, () => { cleaned = true; }),
  ).rejects.toThrow('close failed');
  expect(cleaned).toBe(true);
});
