import type { MemoryItem } from '@frank/contracts';
import { FrankOrchestrator } from '@frank/core';
import { BasicQualityGater } from '@frank/core/dist/orchestrator/quality/basicQualityGater.js';
import { BasicPolicyEngine } from '@frank/core/dist/orchestrator/policy/basicPolicyEngine.js';
import { GcvVisionProvider, GeminiLlmProvider } from '@frank/providers';
import { addMemory, searchMemory } from './memoryStore.js';

export function makeFrank() {
  const memory = {
    add: async (item: MemoryItem) => addMemory(item),
    search: async (query: string, limit: number) => searchMemory(query).slice(0, limit),
  };

  return new FrankOrchestrator({
    vision: new GcvVisionProvider(),
    llm: new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' }),
    memory,
    quality: new BasicQualityGater(),
    policy: new BasicPolicyEngine(),
  });
}
