import { describe, expect, it } from 'vitest';
import { ConcurrencyGate, ConcurrencyGateError } from '@frank/core';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('ConcurrencyGate', () => {
  it('caps active provider work and starts queued work in order', async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 1_000 });
    const first = deferred();
    const started: number[] = [];
    const one = gate.run(async () => { started.push(1); await first.promise; return 1; });
    const two = gate.run(async () => { started.push(2); return 2; });

    await Promise.resolve();
    expect(gate.snapshot()).toEqual({ active: 1, queued: 1 });
    expect(started).toEqual([1]);
    first.resolve();
    await expect(Promise.all([one, two])).resolves.toEqual([1, 2]);
    expect(started).toEqual([1, 2]);
  });

  it('rejects excess and expired queue entries without running them', async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 10 });
    const first = deferred();
    const running = gate.run(async () => { await first.promise; });
    const expired = gate.run(async () => {});
    await expect(gate.run(async () => {})).rejects.toMatchObject({ code: 'queue_full' });
    await expect(expired).rejects.toEqual(expect.any(ConcurrencyGateError));
    expect(gate.snapshot()).toEqual({ active: 1, queued: 0 });
    first.resolve();
    await running;
  });
});
