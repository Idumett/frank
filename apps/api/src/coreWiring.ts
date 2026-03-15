import {
  BasicPolicyEngine,
  BasicQualityGater,
  ConversationStore,
  FrankOrchestrator,
  MemoryStore,
} from '@frank/core';
import { GcvVisionProvider, GeminiLlmProvider } from '@frank/providers';
import { MemoryItem } from '@frank/contracts';
import { SqliteMemoryStore } from './db/sqliteMemoryStore.js';

const sqlite = new SqliteMemoryStore();
const defaultMemoryStore = {
  add: async (item: MemoryItem) => sqlite.add(item),
  search: async (query: string, limit: number) => sqlite.search(query, { limit }),
  recent: (limit: number) => sqlite.recent(limit),
  delete: (ids: string[]) => sqlite.delete(ids),
};

export function makeFrank(
  memoryStore: MemoryStore = defaultMemoryStore,
  conversationStore: ConversationStore,
) {
  return new FrankOrchestrator({
    vision: new GcvVisionProvider(),
    llm: new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' }),
    memory: memoryStore,
    quality: new BasicQualityGater(),
    policy: new BasicPolicyEngine(),
    conversation: conversationStore,
  });
}
