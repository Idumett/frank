import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  AssistantReplySchema,
  type AssistantReply,
  type PerceptionResult,
  type Trace,
} from '@frank/contracts';
import type { LlmProvider } from './LlmProvider.js';
import { buildFrankPrompt, FRANK_SYSTEM_INSTRUCTION } from './frankPrompt.js';

export type GeminiUsage = {
  promptTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  cacheHit: boolean;
  latencyMs: number;
};

export class GeminiLlmProvider implements LlmProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(opts?: { model?: string }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    // Force API-key auth, avoid ADC scope issues
    this.ai = new GoogleGenAI({ apiKey });
    this.model = opts?.model ?? 'gemini-2.5-flash';
  }

  async generateReply(args: {
    trace: Trace;
    userUtterance?: string;
    perception: PerceptionResult;
    memoryHits: string[];
    conversationContext?: string;
    context?: string;
    now: string;
  }): Promise<AssistantReply> {
    const ocrText = args.perception.ocr?.fullText?.trim() ?? '';
    const labels = (args.perception.labels ?? []).map((l) => l.name).slice(0, 8);
    const prompt = buildFrankPrompt(args);
    const startedAt = Date.now();
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        systemInstruction: FRANK_SYSTEM_INSTRUCTION,
        maxOutputTokens: positiveInt(process.env.GEMINI_MAX_OUTPUT_TOKENS, 180),
        temperature: boundedNumber(process.env.GEMINI_TEMPERATURE, 0.2, 0, 2),
        thinkingConfig: { thinkingLevel: thinkingLevel(process.env.GEMINI_THINKING_LEVEL) },
      },
    });

    const text = (response.text ?? '').trim() || 'I am not sure. Please try capturing again.';

    const reply: AssistantReply = {
      trace: args.trace,
      speak: text,
      createdAt: args.now,
      suggestedAction: 'none',
      groundedIn: {
        usedOcr: Boolean(ocrText),
        usedLabels: labels.length > 0,
        usedMemoryHits: args.memoryHits.length,
      },
    };

    const parsed = AssistantReplySchema.parse(reply) as AssistantReply & {
      providerMetadata?: { usage: GeminiUsage };
    };
    const usage = response.usageMetadata;
    parsed.providerMetadata = {
      usage: {
        promptTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        thoughtTokens: usage?.thoughtsTokenCount,
        totalTokens: usage?.totalTokenCount,
        cachedTokens: usage?.cachedContentTokenCount,
        cacheHit: (usage?.cachedContentTokenCount ?? 0) > 0,
        latencyMs: Date.now() - startedAt,
      },
    };
    return parsed;
  }
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function thinkingLevel(value: string | undefined) {
  const levels: Record<string, ThinkingLevel> = {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  };
  return levels[value?.toLowerCase() ?? 'minimal'] ?? ThinkingLevel.MINIMAL;
}
