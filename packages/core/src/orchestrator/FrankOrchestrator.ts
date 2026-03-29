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
import { executeToolCall } from '../tools/executeToolCall.js';

export class FrankOrchestrator {
  constructor(private deps: FrankDeps) {}

  async handleUserRequest(request: UserRequest, imageBytes?: Buffer): Promise<AssistantReply> {
    const now = new Date().toISOString();

    const budget = new CallBudget({ maxVisionCalls: 2, maxLlmCalls: 1 });

    const spendVision = () => {
      if (!budget.canCallVision()) return false;
      budget.recordVisionCall();
      return true;
    };

    let ocrRes: PerceptionResult | null = null;
    let labelsRes: PerceptionResult | null = null;
    let quality:
      | {
          imageQuality: 'good' | 'ok' | 'poor';
          notes: string[];
        }
      | undefined;

    // 1) Vision
    if (imageBytes) {
      quality = await this.deps.quality.assess(imageBytes);

      const callArgs = { trace: request.trace, imageBytes, capturedAt: now };

      const run = async (fn: (args: typeof callArgs) => Promise<PerceptionResult>) => {
        if (!spendVision()) return null;
        return fn.call(this.deps.vision, callArgs);
      };

      [ocrRes, labelsRes] = await Promise.all([
        run(this.deps.vision.analyzeOCR),
        run(this.deps.vision.analyzeLabels),
      ]);
    }

    // 2) Merge perception
    const perception: PerceptionResult = PerceptionResultSchema.parse({
      trace: request.trace,
      provider: 'gcv',
      capturedAt: now,
      imageQuality: quality?.imageQuality ?? 'good',
      imageQualityNotes: quality?.notes ?? [],
      ocr: ocrRes?.ocr,
      labels: labelsRes?.labels ?? [],
    });

    // 3) Memory hits
    const userText = request.query?.trim() || request.utterance?.trim() || '';
    let memoryHits: any[] = [];

    if (userText) {
      memoryHits = await this.deps.memory.search(userText, 5);
    }

    // 4) Policy
    const policy = this.deps.policy.decide({
      request,
      perception,
      quality: quality ?? { imageQuality: 'good', notes: [] },
      memoryHits,
    });

    if (policy.nextAction === 'request_recapture') {
      return AssistantReplySchema.parse({
        trace: request.trace,
        speak: enforceShortReply(policy.recapturePrompt ?? 'Please try again.'),
        createdAt: now,
        suggestedAction: 'recapture',
        confidence: policy.confidence,
        reasons: policy.reasons,
        recapturePrompt: policy.recapturePrompt,
        groundedIn: {
          usedOcr: Boolean(perception.ocr?.fullText?.trim()),
          usedLabels: (perception.labels?.length ?? 0) > 0,
          usedMemoryHits: memoryHits.length,
        },
      });
    }

    if (!policy.allowLlmCall) {
      return AssistantReplySchema.parse({
        trace: request.trace,
        speak: 'Not sure. Try moving closer.',
        createdAt: now,
        suggestedAction: 'recapture',
        confidence: 'low',
        reasons: ['llm_disabled_by_policy'],
        groundedIn: {
          usedOcr: Boolean(perception.ocr?.fullText?.trim()),
          usedLabels: (perception.labels?.length ?? 0) > 0,
          usedMemoryHits: memoryHits.length,
        },
      });
    }

    if (!budget.canCallLlm()) {
      return AssistantReplySchema.parse({
        trace: request.trace,
        speak: 'I need a moment. Try again shortly.',
        createdAt: now,
        suggestedAction: 'none',
        confidence: 'low',
        reasons: ['call_budget_exceeded_llm'],
        groundedIn: {
          usedOcr: Boolean(perception.ocr?.fullText?.trim()),
          usedLabels: (perception.labels?.length ?? 0) > 0,
          usedMemoryHits: memoryHits.length,
        },
      });
    }
    budget.recordLlmCall();

    // 5) Conversation context
    const conversationTurns = request.trace.sessionId
      ? await this.deps.conversation.getRecent(request.trace.sessionId, 6)
      : [];

    const conversationContext = conversationTurns
      .map((t) => `${t.role === 'user' ? 'User' : 'Frank'}: ${t.text}`)
      .join('\n');

    const compactMemoryHits = memoryHits.map((m) => `${m.title}: ${m.content}`).slice(0, 5);

    const availableTools = this.deps.tools.list().map((t) => ({
      name: t.name,
      description: t.description,
    }));

    // 6) Single LLM call: answer OR tool_call
    const decision = await this.deps.llm.decideToolOrAnswer({
      trace: request.trace,
      userUtterance: request.utterance,
      perception,
      memoryHits: compactMemoryHits,
      conversationContext,
      availableTools,
      now,
    });

    // 7) Turn decision into spoken text
    let rawSpeak: string;

    if (decision.type === 'answer') {
      rawSpeak = decision.speak;
    } else {
      const toolResult = await executeToolCall({
        call: decision,
        registry: this.deps.tools,
      });

      rawSpeak = toolResult.speak;
    }

    // 8) Tone + shortness
    const toned = applyConfidenceTone({
      text: rawSpeak,
      confidence: policy.confidence ?? 'medium',
      recaptureHint: policy.recapturePrompt ? 'Move closer.' : undefined,
    });

    const speak = enforceShortReply(toned);

    const reply: AssistantReply = AssistantReplySchema.parse({
      trace: request.trace,
      speak,
      createdAt: now,
      confidence: policy.confidence ?? 'medium',
      reasons: policy.reasons,
      recapturePrompt: policy.recapturePrompt,
      suggestedAction: policy.confidence === 'low' ? 'recapture' : 'none',
      groundedIn: {
        usedOcr: Boolean(perception.ocr?.fullText?.trim()),
        usedLabels: (perception.labels?.length ?? 0) > 0,
        usedMemoryHits: compactMemoryHits.length,
      },
    });

    // 9) Save conversation turns
    if (request.trace.sessionId) {
      if (request.utterance?.trim()) {
        await this.deps.conversation.addTurn({
          sessionId: request.trace.sessionId,
          role: 'user',
          text: request.utterance.trim(),
          createdAt: now,
        });
      }

      await this.deps.conversation.addTurn({
        sessionId: request.trace.sessionId,
        role: 'assistant',
        text: reply.speak,
        createdAt: now,
      });
    }

    // 10) Store memory
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
