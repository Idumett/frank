import type { ObservabilityStore } from '@frank/core';

export async function observedStage<T>(
  observability: ObservabilityStore,
  requestId: string,
  name: string,
  run: () => Promise<T>,
  data?: unknown,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const start = Date.now();

  try {
    const result = await run();
    await observability.addStage(requestId, {
      name,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      ok: true,
      data,
    });
    return result;
  } catch (error: any) {
    await observability.addStage(requestId, {
      name,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      ok: false,
      data,
      error: error?.message ?? 'Unknown error',
    });
    throw error;
  }
}
