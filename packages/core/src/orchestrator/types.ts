import type {
  AssistantReply,
  MemoryItem,
  PerceptionResult,
  PolicyDecision,
  Trace,
  UserRequest,
} from '@frank/contracts';
import type { ToolRegistryLike } from '../tools/types.js';
import type { ConversationStore } from '../conversation/types.js';

export interface MemoryStore {
  add(item: MemoryItem): Promise<void>;
  search(query: string, limit: number): Promise<MemoryItem[]>;
}

export interface PolicyEngine {
  decide(args: {
    request: UserRequest;
    perception: PerceptionResult;
    quality: QualityReport;
    memoryHits: MemoryItem[];
  }): PolicyDecision;
}

export interface QualityGater {
  assess(imageBytes: Buffer): Promise<QualityReport>;
}

export type QualityReport = {
  imageQuality: 'good' | 'ok' | 'poor';
  notes: string[];
};

export interface FrankDeps {
  vision: {
    analyzeOCR(args: {
      trace: Trace;
      imageBytes: Buffer;
      capturedAt: string;
    }): Promise<PerceptionResult>;
    analyzeLabels(args: {
      trace: Trace;
      imageBytes: Buffer;
      capturedAt: string;
    }): Promise<PerceptionResult>;
  };
  llm: {
    decideToolOrAnswer(args: {
      trace: Trace;
      userUtterance?: string;
      perception: PerceptionResult;
      memoryHits: string[];
      conversationContext?: string;
      availableTools: { name: string; description: string }[];
      now: string;
    }): Promise<any>;
  };
  memory: MemoryStore;
  policy: PolicyEngine;
  quality: QualityGater;
  conversation: ConversationStore;
  tools: ToolRegistryLike;
}
