import crypto from 'node:crypto';
import {
  AssistantReplySchema,
  MemoryItemSchema,
  PerceptionResultSchema,
  type AssistantReply,
  type MemoryItem,
  type PerceptionResult,
  type UserRequest,
} from '@frank/contracts';

import type { FrankDeps } from './types.js';

export class FrankOrchestrator {
  constructor(private deps: FrankDeps) {}

  /**
   * The brain:
   * UserRequest + image -> AssistantReply
   */
  async handleUserRequest(request: UserRequest, imageBytes: Buffer): Promise<AssistantReply> {
    const now = new Date().toISOString();

    // 1) Quality gating
    const quality = await this.deps.quality.assess(imageBytes);

    // 2) Vision calls (parallel)
    const [ocrRes, labelsRes] = await Promise.all([
      this.deps.vision.analyzeOCR({ trace: request.trace, imageBytes, capturedAt: now }),
      this.deps.vision.analyzeLabels({ trace: request.trace, imageBytes, capturedAt: now }),
    ]);

    // 3) Merge into one PerceptionResult (contract)
    const perception: PerceptionResult = PerceptionResultSchema.parse({
      trace: request.trace,
      provider: 'gcv', // still OK; provider-agnostic later if we pass through
      capturedAt: now,
      imageQuality: quality.imageQuality,
      imageQualityNotes: quality.notes,
      ocr: ocrRes.ocr,
      labels: labelsRes.labels ?? [],
    });

    // 4) Get memory hits (only if recall-like)
    const memoryHits =
      request.intent === 'recall' && request.query
        ? await this.deps.memory.search(request.query, 5)
        : [];

    // 5) Policy decision
    const policy = this.deps.policy.decide({
      request,
      perception,
      quality,
      memoryHits,
    });

    // If policy says recapture, respond deterministically (no LLM)
    if (policy.nextAction === 'request_recapture') {
      const reply: AssistantReply = {
        trace: request.trace,
        speak: policy.recapturePrompt ?? 'Please try capturing again.',
        createdAt: now,
        suggestedAction: 'recapture',
        groundedIn: {
          usedOcr: Boolean(perception.ocr?.fullText?.trim()),
          usedLabels: (perception.labels?.length ?? 0) > 0,
          usedMemoryHits: memoryHits.length,
        },
      };
      return AssistantReplySchema.parse(reply);
    }

    // 6) Generate spoken reply (LLM; grounded)
    const compactMemoryHits = memoryHits.map((m) => `${m.title}: ${m.content}`).slice(0, 5);

    const llmReply = await this.deps.llm.generateReply({
      trace: request.trace,
      userUtterance: request.utterance,
      perception,
      memoryHits: compactMemoryHits,
      now,
    });

    const reply = AssistantReplySchema.parse(llmReply);

    // 7) Store memory (policy-controlled)
    if (policy.shouldStore) {
      const title = perception.labels?.[0]?.name ?? 'Captured item';
      const content = perception.ocr?.fullText?.trim() || reply.speak;

      const item: MemoryItem = {
        id: crypto.randomUUID(),
        type: 'mixed',
        title,
        content,
        tags: ['frank'],
        createdAt: now,
        trace: request.trace,
      };

      MemoryItemSchema.parse(item);

      // For V1 you can store immediately; later you can require confirmation.
      await this.deps.memory.add(item);
    }

    return reply;
  }
}
