import { GoogleGenAI } from '@google/genai';
import {
  ToolDecisionSchema,
  type PerceptionResult,
  type ToolDecision,
  type Trace,
} from '@frank/contracts';
import { LlmProvider } from './LlmProvider.js';

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

  async decideToolOrAnswer(args: {
    trace: Trace;
    userUtterance?: string;
    perception: PerceptionResult;
    memoryHits: string[];
    conversationContext?: string;
    availableTools: { name: string; description: string }[];
    now: string;
  }): Promise<ToolDecision> {
    const ocrText = args.perception.ocr?.fullText?.trim() ?? '';
    const labels = (args.perception.labels ?? []).map((l) => l.name).slice(0, 8);
    const hasImage = Boolean(ocrText || labels.length);
    const hasMemory = args.memoryHits.length > 0;
    const hasConversation = Boolean(args.conversationContext?.trim());

    const toolsText = args.availableTools?.length
      ? args.availableTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
      : '(none)';

    const prompt = [
      `You are Frank, a personal visual reasoning assistant for blind users.`,
      `CURRENT_TIME: ${new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}`,

      `SOURCES: 1. Conversation Context | 2. Current Image (OCR/Labels) | 3. Memory Hits | 4. Search | 5. Tools.`,

      `STRATEGY:`,
      `- Aim for a "One-Shot Answer." Provide the most likely answer immediately.`,
      `- If a user asks a vague question (e.g., "the game"), check Context or Memory for a logical match.`,
      `- If a logical match is found, answer for it immediately. Do not ask for clarification first.`,
      `- Only ask clarifying questions if there are zero useful clues in Context, Image, or Memory.`,
      `- If the user is asking for a real-world action or fresh external information, use search or a tool if one fits.`,
      `- If no tool is needed, answer directly.`,

      `IMAGE RULES:`,
      `- CURRENT_IMAGE is ${hasImage ? 'PRESENT' : 'NONE'}.`,
      `- If PRESENT: Prioritize OCR/Labels. If NONE: Use Search/Knowledge.`,
      `- Never mention "capturing an image" unless the user specifically asks you to "look" at something.`,

      `TOOL RULES:`,
      `- You do not execute tools yourself.`,
      `- If a tool is needed, return a tool call only.`,
      `- If no tool is needed, return a direct answer only.`,
      `- Only use one tool at a time.`,
      `- Use tools for actions or fresh external information.`,
      `- Do not use a tool for simple reasoning, follow-up conversation, or things already answerable from context.`,

      `AVAILABLE TOOLS:`,
      toolsText,

      `OUTPUT RULES:`,
      `- Return valid JSON only. No markdown. No explanation outside JSON.`,
      `- If answering directly, return: {"type":"answer","speak":"short reply"}`,
      `- If a tool is needed, return: {"type":"tool_call","tool":"tool_name","input":{"key":"value"}}`,

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

    const text = (response.text ?? '').trim();

    try {
      return ToolDecisionSchema.parse(JSON.parse(text));
    } catch {
      return ToolDecisionSchema.parse({
        type: 'answer',
        speak: 'I am not sure. Please try again.',
      });
    }
  }
}
