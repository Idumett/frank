import crypto from 'node:crypto';
import type { MemoryItem, UserRequest } from '@frank/contracts';
import { FrankOrchestrator, BasicPolicyEngine, BasicQualityGater } from '@frank/core';
import { GcvVisionProvider, GeminiLlmProvider } from '@frank/providers';

export function makeFrankForTests() {
  const memory = {
    add: async (_item: MemoryItem) => {},
    search: async (_query: string, _limit: number) => [],
  };

  return new FrankOrchestrator({
    vision: new GcvVisionProvider(),
    llm: new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' }),
    memory,
    policy: new BasicPolicyEngine(),
    quality: new BasicQualityGater(),
  } as any);
}

export function makeRequest(args: {
  intent: UserRequest['intent'];
  utterance?: string;
  query?: string;
}): UserRequest {
  return {
    trace: { requestId: crypto.randomUUID(), sessionId: 'test' },
    intent: args.intent,
    modality: 'app',
    utterance: args.utterance,
    hasImage: true,
    query: args.query,
    requestedAt: new Date().toISOString(),
  } as any;
}
