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

import type { FrankDeps, QualityReport } from './types.js';
import type { TraceSource } from '../observability/types.js';
import { CallBudget } from './guardrails/callBudget.js';
import { applyConfidenceTone, enforceShortReply } from './guardrails/shortReply.js';
import { withDeadline } from '../utils/deadline.js';

function summarizeInput(args: { request: UserRequest; hasImage: boolean }) {
  return {
    intent: args.request.intent,
    modality: args.request.modality,
    utterance: args.request.utterance,
    query: args.request.query,
    requestedAt: args.request.requestedAt,
    hasImage: args.hasImage,
  };
}

function summarizeOutput(reply: AssistantReply) {
  return {
    speak: reply.speak,
    // confidence: reply.confidence,
    suggestedAction: reply.suggestedAction,
    // reasons: reply.reasons,
    // recapturePrompt: reply.recapturePrompt,
    groundedIn: reply.groundedIn,
  };
}

function createStageTimer(observability: FrankDeps['observability'], requestId: string) {
  return async function stage<T>(name: string, fn: () => Promise<T>, data?: unknown): Promise<T> {
    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
      const result = await fn();

      await observability.addStage(requestId, {
        name,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        ok: true,
        data,
      });

      return result;
    } catch (err: any) {
      await observability.addStage(requestId, {
        name,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        ok: false,
        data,
        error: err?.message ?? 'Unknown error',
      });

      throw err;
    }
  };
}

// async function timedStage<T>(
//   observability: FrankDeps['observability'],
//   requestId: string,
//   name: string,
//   fn: () => Promise<T>,
//   data?: unknown,
// ): Promise<T> {
//   const startedAt = new Date().toISOString();
//   const start = Date.now();

//   try {
//     const result = await fn();

//     await observability.addStage(requestId, {
//       name,
//       startedAt,
//       endedAt: new Date().toISOString(),
//       durationMs: Date.now() - start,
//       ok: true,
//       data,
//     });

//     return result;
//   } catch (err: any) {
//     await observability.addStage(requestId, {
//       name,
//       startedAt,
//       endedAt: new Date().toISOString(),
//       durationMs: Date.now() - start,
//       ok: false,
//       data,
//       error: err?.message ?? 'Unknown error',
//     });

//     throw err;
//   }
// }

export class FrankOrchestrator {
  constructor(private deps: FrankDeps) {}

  /**
   * The brain:
   * UserRequest + image -> AssistantReply
   */
  async handleUserRequest(
    request: UserRequest,
    imageBytes?: Buffer,
    options: { source?: TraceSource; finishTrace?: boolean; userId?: string } = {},
  ): Promise<AssistantReply> {
    // console.log('we get to 1');
    const now = new Date().toISOString();
    const requestId = request.trace.requestId;
    const userId = options.userId ?? 'legacy';
    const stage = createStageTimer(this.deps.observability, requestId);

    await this.deps.observability.start({
      requestId,
      userId,
      sessionId: request.trace.sessionId,
      source: options.source ?? 'analyze',
      startedAt: now,
      input: summarizeInput({
        request,
        hasImage: Boolean(imageBytes),
      }),
      stages: [],
    });

    try {
      const budget = new CallBudget({ maxVisionCalls: 2, maxLlmCalls: 1 });
      const spendVision = () => {
        if (!budget.canCallVision()) return false;
        budget.recordVisionCall();
        return true;
      };

      let ocrRes;
      let labelsRes;

      type QualityResult = Awaited<ReturnType<FrankDeps['quality']['assess']>>;
      let quality: QualityResult | undefined;

      if (imageBytes) {
        quality = await stage('quality.assess', () => this.deps.quality.assess(imageBytes), {
          imageBytes: imageBytes.length,
        });

        // 1) Vision calls (parallel) - count calls before spending
        const callArgs = { trace: request.trace, imageBytes, capturedAt: now };
        const runVision = async (
          name: 'vision.ocr' | 'vision.labels',
          fn: (args: typeof callArgs) => Promise<PerceptionResult>,
        ) => {
          if (!spendVision()) return null;

          return stage(name, () => withDeadline(
            () => fn.call(this.deps.vision, callArgs),
            10_000,
            name,
          ), {
            imageBytes: imageBytes.length,
          });
        };
        [ocrRes, labelsRes] = await Promise.all([
          runVision('vision.ocr', this.deps.vision.analyzeOCR),
          runVision('vision.labels', this.deps.vision.analyzeLabels),
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
        const memoryLimit = positiveInt(process.env.LLM_MEMORY_HIT_LIMIT, 4);
        memoryHits = await stage('memory.search', () => this.deps.memory.search(userId, userText, memoryLimit), {
          query: userText,
          limit: memoryLimit,
        });
      } else if (request.intent === 'recall') {
        // recall with no query: just return recent-ish hits (optional)
        memoryHits = await stage('memory.search', () => this.deps.memory.search(userId, '', 0), {
          query: '',
          limit: 0,
        }); // or implement recent() and use that
      }

      // 4) Policy decision
      const policy = await stage(
        'policy.decide',
        async () =>
          this.deps.policy.decide({
            request,
            perception,
            quality: quality ?? { imageQuality: 'good', notes: [] },
            memoryHits,
          }),
        {
          imageQuality: quality?.imageQuality ?? 'good',
          memoryHits: memoryHits.length,
        },
      );

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
        const parsed = AssistantReplySchema.parse(reply);
        if (options.finishTrace !== false) {
          await this.deps.observability.finish(requestId, summarizeOutput(parsed));
        }
        return parsed;
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
        const parsed = AssistantReplySchema.parse(reply);
        if (options.finishTrace !== false) {
          await this.deps.observability.finish(requestId, summarizeOutput(parsed));
        }
        return parsed;
      }

      if (!budget.canCallLlm()) {
        const parsed = AssistantReplySchema.parse({
          trace: request.trace,
          speak: 'Too many tries. Please try again in a moment.',
          suggestedAction: 'recapture',
        });
        if (options.finishTrace !== false) {
          await this.deps.observability.finish(requestId, summarizeOutput(parsed));
        }
        return parsed;
      }
      budget.recordLlmCall();

      const memoryChars = positiveInt(process.env.LLM_MEMORY_ITEM_CHAR_LIMIT, 400);
      const compactMemoryHits = memoryHits.map((m) => `${m.title}: ${m.content}`.slice(0, memoryChars));
      const conversationLimit = positiveInt(process.env.LLM_CONVERSATION_TURN_LIMIT, 6);
      const conversationTurns = request.trace.sessionId
        ? await stage(
            'conversation.get_recent',
            () => this.deps.conversation.getRecent(userId, request.trace.sessionId!, conversationLimit),
            { sessionId: request.trace.sessionId, limit: conversationLimit },
          )
        : [];
      const conversationChars = positiveInt(process.env.LLM_CONVERSATION_CHAR_LIMIT, 2400);
      const conversationContext = conversationTurns
        .map((turn) => `${turn.role}: ${turn.text}`)
        .join(' | ')
        .slice(-conversationChars);

      const llmReply = await stage(
        'llm.generate_reply',
        () =>
          withDeadline(() => this.deps.llm.generateReply({
            trace: request.trace,
            userUtterance: request.utterance,
            perception,
            memoryHits: compactMemoryHits,
            conversationContext,
            now,
          }), 25_000, 'llm.generate_reply'),
        {
          memoryHits: compactMemoryHits.length,
          hasConversationContext: Boolean(conversationContext),
          hasOcr: Boolean(perception.ocr?.fullText?.trim()),
          labelCount: perception.labels?.length ?? 0,
        },
      );
      if (llmReply.providerMetadata?.usage) {
        const timestamp = new Date().toISOString();
        await this.deps.observability.addStage(requestId, {
          name: 'llm.usage', startedAt: timestamp, endedAt: timestamp, durationMs: 0, ok: true,
          data: llmReply.providerMetadata.usage,
        });
      }
      // confidence language + hard shorten
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

      // Save conversation context after the final reply has been created.
      if (request.trace.sessionId) {
        if (request.utterance?.trim()) {
          await stage(
            'conversation.add_user_turn',
            () =>
              this.deps.conversation.addTurn({
                userId,
                sessionId: request.trace.sessionId!,
                role: 'user',
                text: request.utterance!.trim(),
                createdAt: now,
              }),
            { sessionId: request.trace.sessionId },
          );
        }

        await stage(
          'conversation.add_assistant_turn',
          () =>
            this.deps.conversation.addTurn({
              userId,
              sessionId: request.trace.sessionId!,
              role: 'assistant',
              text: reply.speak,
              createdAt: now,
            }),
          { sessionId: request.trace.sessionId },
        );
      }

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
        await stage('memory.store', () => this.deps.memory.add(userId, item), {
          title: item.title,
          type: item.type,
          tags: item.tags,
        });
      }

      if (options.finishTrace !== false) {
        await this.deps.observability.finish(requestId, summarizeOutput(reply));
      }
      return reply;
    } catch (err: any) {
      await this.deps.observability.fail(requestId, err?.message ?? 'Unknown orchestrator error');
      throw err;
    }
  }
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
