import type {
  AssistantReply,
  MemoryItem,
  PerceptionResult,
  PolicyDecision,
  Trace,
  UserRequest,
} from '@frank/contracts';

export interface MemoryStore {
  add(item: MemoryItem): Promise<void>;
  search(query: string, limit: number): Promise<MemoryItem[]>;
  recent(limit: number): Promise<MemoryItem[]>;
  delete(ids: string[]): Promise<number>;
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
      now: string;
    }): Promise<AssistantReply>;
  };
  memory: MemoryStore;
  policy: PolicyEngine;
  quality: QualityGater;
}
