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
import { CallBudget } from './guardrails/callBudget.js';
import { applyConfidenceTone, enforceShortReply } from './guardrails/shortReply.js';

export class FrankOrchestrator {
  constructor(private deps: FrankDeps) {}

  /**
   * The brain:
   * UserRequest + image -> AssistantReply
   */
  async handleUserRequest(request: UserRequest, imageBytes?: Buffer): Promise<AssistantReply> {
    const now = new Date().toISOString();

    const budget = new CallBudget({ maxVisionCalls: 2, maxLlmCalls: 1 });
    const spendVision = () => {
      if (!budget.canCallVision()) return false;
      budget.recordVisionCall();
      return true;
    };

    let ocrRes;
    let labelsRes;
    let quality;
    if (imageBytes) {
      quality = await this.deps.quality.assess(imageBytes);

      // 1) Vision calls (parallel) - count calls before spending
      const callArgs = { trace: request.trace, imageBytes, capturedAt: now };
      const run = (fn: any) => (spendVision() ? fn(callArgs) : Promise.resolve(null));
      [ocrRes, labelsRes] = await Promise.all([
        run(this.deps.vision.analyzeOCR),
        run(this.deps.vision.analyzeLabels),
      ]);
    }

    // 2) Merge into one PerceptionResult (contract)
    const perception: PerceptionResult = PerceptionResultSchema.parse({
      trace: request.trace,
      provider: 'gcv',
      capturedAt: now,
      imageQuality: quality?.imageQuality,
      imageQualityNotes: quality?.notes,
      ocr: ocrRes?.ocr,
      labels: labelsRes?.labels ?? [],
    });

    // 3) Memory hits (Jarvis mode: use memory for ANY meaningful utterance)
    const userText = request.query?.trim() || request.utterance?.trim() || '';
    let memoryHits = [] as any[];

    if (userText) {
      // If user asked anything, search memory using that text
      memoryHits = await this.deps.memory.search(userText, 5);
    } else if (request.intent === 'recall') {
      // recall with no query: just return recent-ish hits (optional)
      memoryHits = await this.deps.memory.search('', 0); // or implement recent() and use that
    }

    // 4) Policy decision
    const policy = this.deps.policy.decide({
      request,
      perception,
      quality: quality ?? {
        imageQuality: 'good',
        notes: [],
      },
      memoryHits,
    });

    // If policy says recapture, respond deterministically (no LLM)
    if (policy.nextAction === 'request_recapture') {
      const reply: AssistantReply = {
        trace: request.trace,
        speak: enforceShortReply(policy.recapturePrompt ?? 'Please try capturing again.'),
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

    // 5) Generate spoken reply (LLM; grounded)
    if (!policy.allowLlmCall) {
      // Deterministic fallback if LLM disabled by policy
      const fallback = 'Not sure. Try moving closer.';
      const reply: AssistantReply = {
        trace: request.trace,
        speak: enforceShortReply(fallback),
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

    if (!budget.canCallLlm())
      return AssistantReplySchema.parse({
        trace: request.trace,
        speak: 'Too many tries. Please try again in a moment.',
        suggestedAction: 'recapture',
      });
    budget.recordLlmCall();

    const compactMemoryHits = memoryHits.map((m) => `${m.title}: ${m.content}`).slice(0, 5);

    const llmReply = await this.deps.llm.generateReply({
      trace: request.trace,
      userUtterance: request.utterance,
      perception,
      memoryHits: compactMemoryHits,
      now,
    });

    // confidence language + hard shorten
    //TODO: Not just policy.confidence, but reasons,suggestedactions, shouldstore, recaptureprompt and ocrconfidence, are they actually used?(policyDecision)
    //They are used in the core, the suggested actions are sent back to the caller to decide what to do, in the analyze route this is handled right, but the devices routes dont use them.
    const toned = applyConfidenceTone({
      text: llmReply.speak,
      confidence: policy.confidence ?? 'medium',
      recaptureHint: policy.recapturePrompt
        ? // keep the hint short
          'Move closer.'
        : undefined,
    });

    const speak = enforceShortReply(toned);

    const reply: AssistantReply = AssistantReplySchema.parse({
      ...llmReply,
      speak,
      // Keep the reply deterministic in suggestedAction for low confidence
      suggestedAction:
        policy.confidence === 'low' ? 'recapture' : (llmReply.suggestedAction ?? 'none'),
    });

    // 6) Store memory (guardrail: DO NOT store when confidence is low)
    // Jarvis mode helps even if unclear, but we avoid dirty memory.
    const canStore = policy.shouldStore && policy.confidence !== 'low';

    if (canStore) {
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
      await this.deps.memory.add(item);
    }

    return reply;
  }
}
