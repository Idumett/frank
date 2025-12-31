import { FrankOrchestrator, MemoryStore } from '@frank/core';
import { BasicQualityGater } from '@frank/core/dist/orchestrator/quality/basicQualityGater.js';
import { BasicPolicyEngine } from '@frank/core/dist/orchestrator/policy/basicPolicyEngine.js';
import { GcvVisionProvider, GeminiLlmProvider } from '@frank/providers';

export function makeFrank(memoryStore: MemoryStore) {
  return new FrankOrchestrator({
    vision: new GcvVisionProvider(),
    llm: new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' }),
    memory: memoryStore,
    quality: new BasicQualityGater(),
    policy: new BasicPolicyEngine(),
  });
}
