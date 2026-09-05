import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { buildFrankPrompt, FRANK_SYSTEM_INSTRUCTION, type FrankPromptInput } from '../packages/providers/src/llm/frankPrompt.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is required');
const model = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';
const ai = new GoogleGenAI({ apiKey });

const emptyVision = (requestId: string) => ({ trace: { requestId }, provider: 'gcv' as const, capturedAt: new Date().toISOString(), labels: [] });
const scenarios: Array<{ name: string; input: FrankPromptInput }> = [
  { name: 'time_without_camera', input: { userUtterance: 'What time is it?', perception: emptyVision('bench-time'), memoryHits: [], now: new Date().toISOString() } },
  { name: 'scene_description', input: { userUtterance: 'What is in front of me?', perception: { ...emptyVision('bench-scene'), labels: [{ name: 'chair', confidence: 0.96 }, { name: 'door', confidence: 0.91 }] }, memoryHits: [], now: new Date().toISOString() } },
  { name: 'read_text', input: { userUtterance: 'Read this label.', perception: { ...emptyVision('bench-read'), ocr: { fullText: 'TAKE ONE TABLET DAILY', blocks: [] } }, memoryHits: [], now: new Date().toISOString() } },
  { name: 'follow_up', input: { userUtterance: 'How far away is it?', perception: emptyVision('bench-follow'), conversationContext: 'user: Where is the door? | assistant: The door is directly ahead.', memoryHits: [], now: new Date().toISOString() } },
  { name: 'memory_recall', input: { userUtterance: 'Where did I leave my keys?', perception: emptyVision('bench-memory'), memoryHits: ['Keys: On the hall table beside the blue bowl'], now: new Date().toISOString() } },
];

async function main() {
const stableCount = await ai.models.countTokens({ model, contents: FRANK_SYSTEM_INSTRUCTION });
const results: unknown[] = [];
for (const version of ['existing', 'optimized', 'optimized_repeat'] as const) {
  for (const scenario of scenarios) {
    const optimized = version !== 'existing';
    const contents = optimized ? buildFrankPrompt(scenario.input) : oldPrompt(scenario.input);
    const started = Date.now();
    const response = await ai.models.generateContent({
      model,
      contents,
      config: optimized ? {
        systemInstruction: FRANK_SYSTEM_INSTRUCTION,
        maxOutputTokens: 180,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      } : undefined,
    });
    results.push({
      version, scenario: scenario.name, latencyMs: Date.now() - started,
      text: response.text?.trim(), usage: response.usageMetadata,
    });
  }
}
console.log(JSON.stringify({ model, stablePromptTokens: stableCount.totalTokens, results }, null, 2));
}

void main();

function oldPrompt(args: FrankPromptInput) {
  const ocr = args.perception.ocr?.fullText?.trim() ?? '';
  const labels = (args.perception.labels ?? []).map((label) => label.name).slice(0, 8);
  const hasImage = Boolean(ocr || labels.length);
  const hasMemory = args.memoryHits.length > 0;
  const hasConversation = Boolean(args.conversationContext?.trim());
  return [
    'You are Frank, a personal visual reasoning assistant for blind users.',
    `CURRENT_TIME: ${new Date(args.now).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}`,
    'SOURCES: 1. Conversation Context | 2. Current Image (OCR/Labels) | 3. Memory Hits | 4. Search.',
    'STRATEGY:', '- Aim for a "One-Shot Answer." Provide the most likely answer immediately.',
    '- If a user asks a vague question (e.g., "the game"), check Context or Memory for a sports team.',
    '- If a logical match is found, answer for that team immediately. Do not ask for clarification first.',
    '- Only ask clarifying questions if there are zero clues in Context or Memory.',
    'IMAGE RULES:', `- CURRENT_IMAGE is ${hasImage ? 'PRESENT' : 'NONE'}.`,
    '- If PRESENT: Prioritize OCR/Labels. If NONE: Use Search/Knowledge.',
    '- Never mention "capturing an image" unless the user specifically asks you to "look" at something.',
    'CONSTRAINTS:', '- Be concise but informative. Do not "rant," but prioritize the answer over word counts.',
    '- Maximum 3-4 sentences. Keep them punchy and easy to follow via text-to-speech.',
    '- Use natural, helpful language. Avoid robotic phrases like "Image evidence suggests."',
    'CURRENT_STATE:', `- IMAGE_PRESENT: ${hasImage ? 'YES' : 'NO'}`,
    `- CONVERSATION_ACTIVE: ${hasConversation ? 'YES' : 'NO'}`, `- MEMORY_FOUND: ${hasMemory ? 'YES' : 'NO'}`,
    'USER DATA:', `USER QUESTION: ${args.userUtterance ?? '(none)'}`,
    `CONVERSATION CONTEXT: ${args.conversationContext ?? '(none)'}`, `OCR TEXT: ${ocr || '(none)'}`,
    `LABELS: ${labels.length ? labels.join(', ') : '(none)'}`, `MEMORY HITS: ${hasMemory ? args.memoryHits.join(' | ') : '(none)'}`,
  ].join('\n');
}
