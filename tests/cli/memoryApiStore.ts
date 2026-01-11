import type { MemoryItem, Trace } from '@frank/contracts';

const BASE_URL = process.env.FRANK_API_URL ?? 'http://localhost:3000';

async function postJson<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export function makeMemoryApiStore() {
  return {
    // Orchestrator only needs add + search (per your MemoryStore interface)
    add: async (item: MemoryItem) => {
      const trace: Trace = item.trace ?? { requestId: 'memory-add' };
      await postJson('/v1/memory/add', { trace, item });
    },

    search: async (query: string, limit: number) => {
      const trace: Trace = { requestId: 'memory-search', sessionId: 'console' };
      const res = await postJson<{ items: MemoryItem[] }>('/v1/memory/search', {
        trace,
        query,
        limit,
      });
      return res.items;
    },

    recent: async (limit = 10) => {
      const res = await getJson<{ items: MemoryItem[] }>(`/v1/memory/recent?limit=${limit}`);
      return res.items;
    },
  };
}
