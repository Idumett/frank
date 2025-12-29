import { GoogleGenAI } from '@google/genai';
import {
  AssistantReplySchema,
  type AssistantReply,
  type PerceptionResult,
  type Trace,
} from '@frank/contracts';
import type { LlmProvider } from './LlmProvider.js';

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
    now: string;
  }): Promise<AssistantReply> {
    const ocrText = args.perception.ocr?.fullText?.trim() ?? '';
    const labels = (args.perception.labels ?? []).map((l) => l.name).slice(0, 8);

    const prompt = [
      `You are Frank, a personal visual reasoning assistant for blind users.`,
      `You MUST only use the facts provided in OCR text, labels, and memory hits.`,
      `If you are unsure or the text seems incomplete, say you are not sure and ask to recapture.`,
      ``,
      `USER QUESTION: ${args.userUtterance ?? '(none)'}`,
      `OCR TEXT: ${ocrText || '(none)'}`,
      `LABELS: ${labels.length ? labels.join(', ') : '(none)'}`,
      `MEMORY HITS: ${args.memoryHits.length ? args.memoryHits.join(' | ') : '(none)'}`,
    ].join('\n');

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
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

    return AssistantReplySchema.parse(reply);
  }
}
