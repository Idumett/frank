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
      `CURRENT_TIME: ${new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}`,

      `SOURCES: 1. Conversation Context | 2. Current Image (OCR/Labels) | 3. Memory Hits | 4. Search.`,

      `STRATEGY:`,
      `- Aim for a "One-Shot Answer." Provide the most likely answer immediately.`,
      `- If a user asks a vague question (e.g., "the game"), check Context or Memory for a sports team.`,
      `- If a logical match is found, answer for that team immediately. Do not ask for clarification first.`,
      `- Only ask clarifying questions if there are zero clues in Context or Memory.`,

      `IMAGE RULES:`,
      `- CURRENT_IMAGE is ${hasImage ? 'PRESENT' : 'NONE'}.`,
      `- If PRESENT: Prioritize OCR/Labels. If NONE: Use Search/Knowledge.`,
      `- Never mention "capturing an image" unless the user specifically asks you to "look" at something.`,

      `CONSTRAINTS:`,
      `- Be concise but informative. Do not "rant," but prioritize the answer over word counts.`,
      `- Maximum 3-4 sentences. Keep them punchy and easy to follow via text-to-speech.`,
      `- Use natural, helpful language. Avoid robotic phrases like "Image evidence suggests."`,

      `CURRENT_STATE:`,
      `- IMAGE_PRESENT: ${hasImage ? 'YES' : 'NO'}`,
      `- CONVERSATION_ACTIVE: ${hasConversation ? 'YES' : 'NO'}`,
      `- MEMORY_FOUND: ${hasMemory ? 'YES' : 'NO'}`,

      `USER DATA:`,
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
