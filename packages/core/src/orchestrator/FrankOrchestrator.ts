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
import { decidePerceptionPlan } from './policy/decidePerceptionPlan.js';

export class FrankOrchestrator {
  constructor(private deps: FrankDeps) {}

  /**
   * The brain:
   * UserRequest + image -> AssistantReply
   */
  async handleUserRequest(request: UserRequest, imageBytes?: Buffer): Promise<AssistantReply> {
    const now = new Date().toISOString();

    //TODO: Is there a safe fallback if budget is exceeded?
    const budget = new CallBudget({ maxVisionCalls: 2, maxLlmCalls: 1 });

    // 1) Quality gating (cheap)
    let ocrRes;
    let labelsRes;
    let quality;
    if (imageBytes) {
      quality = await this.deps.quality.assess(imageBytes);

      // 2) Vision calls (parallel) - count calls before spending
      const plan = decidePerceptionPlan({ intent: request.intent, utterance: request.utterance });
      const callArgs = { trace: request.trace, imageBytes, capturedAt: now };
      const wantsRead = (request.utterance ?? '').toLowerCase().includes('read');
      const minOcrChars = 3;
      const runOcr = async () => {
        budget.useVisionCall();
        return this.deps.vision.analyzeOCR(callArgs);
      };
      const runLabels = async () => {
        budget.useVisionCall();
        return this.deps.vision.analyzeLabels(callArgs);
      };
      //..............................................................................
      // Primary pass (only what plan requested)
      ocrRes = plan.doOcr ? await runOcr() : null;
      labelsRes = plan.doLabels ? await runLabels() : null;
      // Fallbacks (at most one extra call each, only when useful)
      const ocrText = ocrRes?.ocr?.fullText?.trim() ?? '';
      const hasOcrText = ocrText.length >= minOcrChars;
      // If we didn't run OCR but user clearly asked to read, try OCR once.
      if (!ocrRes && wantsRead) {
        ocrRes = await runOcr();
      }
      // If we ran OCR-only but it found no text, rescue with labels once.
      if (plan.doOcr && !plan.doLabels && !hasOcrText && !labelsRes) {
        labelsRes = await runLabels();
      }
    }

    // 3) Merge into one PerceptionResult (contract)
    const perception: PerceptionResult = PerceptionResultSchema.parse({
      trace: request.trace,
      provider: 'gcv',
      capturedAt: now,
      imageQuality: quality?.imageQuality,
      imageQualityNotes: quality?.notes,
      ocr: ocrRes?.ocr,
      labels: labelsRes?.labels ?? [],
    });

    // 4) Memory hits (Jarvis mode: use memory for ANY meaningful utterance)
    const userText = request.query?.trim() || request.utterance?.trim() || '';
    let memoryHits = [] as any[];

    if (userText) {
      // If user asked anything, search memory using that text
      memoryHits = await this.deps.memory.search(userText, 5);
    } else if (request.intent === 'recall') {
      // recall with no query: just return recent-ish hits (optional)
      memoryHits = await this.deps.memory.search('', 0); // or implement recent() and use that
    }

    // 5) Policy decision
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

    // 6) Generate spoken reply (LLM; grounded)
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

    budget.useLlmCall();

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

    // 7) Store memory (guardrail: DO NOT store when confidence is low)
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
