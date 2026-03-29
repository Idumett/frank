import type { MemoryItem } from '@frank/contracts';
import {
  FrankOrchestrator,
  BasicQualityGater,
  BasicPolicyEngine,
  ToolRegistry,
  GetWeatherTool,
} from '@frank/core';
import { GcvVisionProvider, GeminiLlmProvider } from '@frank/providers';

export function makeFrank(memoryStore: any, conversationStore: any) {
  const tools = new ToolRegistry();
  tools.register(new GetWeatherTool());

  return new FrankOrchestrator({
    vision: new GcvVisionProvider(),
    llm: new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' }),
    memory: memoryStore,
    quality: new BasicQualityGater(),
    policy: new BasicPolicyEngine(),
    conversation: conversationStore,
    tools,
  });
}
