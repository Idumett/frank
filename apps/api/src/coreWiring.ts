import {
  BasicPolicyEngine,
  BasicQualityGater,
  ConversationStore,
  FrankOrchestrator,
  MemoryStore,
  ObservabilityStore,
} from '@frank/core';
import { GcvVisionProvider, GeminiLlmProvider } from '@frank/providers';
import { MemoryItem } from '@frank/contracts';
import { SqliteMemoryStore } from './db/sqliteMemoryStore.js';

const sqlite = new SqliteMemoryStore();
const defaultMemoryStore = {
  add: async (userId: string, item: MemoryItem) => sqlite.add(userId, item),
  search: async (userId: string, query: string, limit: number) => sqlite.search(userId, query, { limit }),
  recent: (userId: string, limit: number) => sqlite.recent(userId, limit),
  delete: (userId: string, ids: string[]) => sqlite.delete(userId, ids),
};

export function makeFrank(
  memoryStore: MemoryStore = defaultMemoryStore,
  conversationStore: ConversationStore,
  observabilityStore: ObservabilityStore,
) {
  return new FrankOrchestrator({
    vision: new GcvVisionProvider(),
    llm: new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' }),
    memory: memoryStore,
    quality: new BasicQualityGater(),
    policy: new BasicPolicyEngine(),
    conversation: conversationStore,
    observability: observabilityStore,
  });
}
