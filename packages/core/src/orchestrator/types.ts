import type {
  AssistantReply,
  MemoryItem,
  PerceptionResult,
  PolicyDecision,
  Trace,
  UserRequest,
} from '@frank/contracts';
import { ConversationStore } from '../conversation/types.js';
import type { ObservabilityStore } from '../observability/types.js';

export interface MemoryStore {
  add(userId: string, item: MemoryItem): Promise<void>;
  search(userId: string, query: string, limit: number): Promise<MemoryItem[]>;
  recent(userId: string, limit: number): Promise<MemoryItem[]>;
  delete(userId: string, ids: string[]): Promise<number>;
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
    generateReply(args: {
      trace: Trace;
      userUtterance?: string;
      perception: PerceptionResult;
      memoryHits: string[];
      conversationContext: string;
      now: string;
    }): Promise<AssistantReply & { providerMetadata?: { usage?: Record<string, unknown> } }>;
  };
  memory: MemoryStore;
  conversation: ConversationStore;
  observability: ObservabilityStore;
  policy: PolicyEngine;
  quality: QualityGater;
}
