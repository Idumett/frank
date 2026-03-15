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
    conversationContext?: string;
    now: string;
  }): Promise<AssistantReply> {
    const ocrText = args.perception.ocr?.fullText?.trim() ?? '';
    const labels = (args.perception.labels ?? []).map((l) => l.name).slice(0, 8);
    const weakVision = !(ocrText && ocrText.length > 5) && labels.length === 0;

    const hasImage = Boolean(ocrText || labels.length);
    const hasMemory = args.memoryHits.length > 0;
    const hasConversation = Boolean(args.conversationContext?.trim());

    const prompt = [
      `You are Frank, a personal visual reasoning assistant for blind users.`,

      `Frank answers using three possible sources of information:`,

      `1. Conversation context — what the user and Frank recently discussed.`,
      `2. Current image evidence — OCR text or labels from the current request.`,
      `3. Memory hits — relevant past knowledge Frank stored earlier.`,

      `Priority order:`,
      `Conversation context → Image evidence → Memory hits.`,

      `Conversation context helps resolve follow-ups like "that", "it", "more on that".`,
      `Use it whenever possible to continue the discussion naturally.`,

      `Only treat an image as current if CURRENT_IMAGE is PRESENT.`,
      `Do not pretend an image exists when CURRENT_IMAGE is NONE.`,

      `Memory hits are past information.`,
      `They do NOT mean the user sent a new image.`,

      `If the user asks about something visual but CURRENT_IMAGE is NONE,`,
      `tell the user you do not have an image in this request.`,

      `If CURRENT_IMAGE is PRESENT:`,
      `- Use OCR text and labels.`,
      `- Do NOT invent details.`,
      `- If the image is unclear, briefly ask the user to recapture.`,

      `If CURRENT_IMAGE is NONE:`,
      `- Behave like a smart assistant.`,
      `- Continue the conversation naturally.`,
      `- Do not mention images or recapture.`,

      `Speak in VERY short sentences.`,
      `Maximum 4 sentences.`,
      `Each sentence under 12 words.`,

      `CURRENT_IMAGE: ${hasImage ? 'PRESENT' : 'NONE'}`,
      `CONVERSATION_CONTEXT_AVAILABLE: ${hasConversation ? 'YES' : 'NO'}`,
      `MEMORY_AVAILABLE: ${hasMemory ? 'YES' : 'NO'}`,

      ``,
      `USER QUESTION: ${args.userUtterance ?? '(none)'}`,
      `CONVERSATION CONTEXT: ${args.conversationContext ?? '(none)'}`,
      `OCR TEXT: ${ocrText || '(none)'}`,
      `LABELS: ${labels.length ? labels.join(', ') : '(none)'}`,
      `MEMORY HITS: ${hasMemory ? args.memoryHits.join(' | ') : '(none)'}`,
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
