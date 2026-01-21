import { FrankOrchestrator, MemoryStore } from '@frank/core';
import { BasicQualityGater } from '@frank/core/dist/orchestrator/quality/basicQualityGater.js';
import { BasicPolicyEngine } from '@frank/core/dist/orchestrator/policy/basicPolicyEngine.js';
import { GcvVisionProvider, GeminiLlmProvider } from '@frank/providers';
import { SqliteMemoryStore } from './db/sqliteMemoryStore.js';
import { MemoryItem } from '@frank/contracts';

const sqlite = new SqliteMemoryStore();
const defaultMemoryStore = {
  add: async (item: MemoryItem) => sqlite.add(item),
  search: async (query: string, limit: number) => sqlite.search(query, { limit }),
  recent: (limit: number) => sqlite.recent(limit),
  delete: (ids: string[]) => sqlite.delete(ids),
};

export function makeFrank(memoryStore: MemoryStore = defaultMemoryStore) {
  return new FrankOrchestrator({
    vision: new GcvVisionProvider(),
    llm: new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' }),
    memory: memoryStore,
    quality: new BasicQualityGater(),
    policy: new BasicPolicyEngine(),
  });
}
