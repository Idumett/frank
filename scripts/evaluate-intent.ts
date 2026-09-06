import { GeminiLlmProvider } from '../packages/providers/src/llm/geminiLlmProvider.js';

const cases = [
  ['What am I looking at?', '', 'describe_scene'],
  ['Is this apple bruised?', '', 'describe_scene'],
  ['Which of these socks matches?', '', 'describe_scene'],
  ['Can you tell whether this door is open?', '', 'describe_scene'],
  ['What colour is the thing in my hand?', '', 'describe_scene'],
  [
    'And the one beside it?',
    'user: What is in front of me? | assistant: A chair beside a table.',
    'describe_scene',
  ],
  ['What does the packet say about allergens?', '', 'read_text'],
  ['Could you make out the expiry date for me?', '', 'read_text'],
  ['Keep a memory of the object I am holding.', '', 'remember_this'],
  ['Where did I leave my keys?', '', 'recall'],
  ['Why do apples turn brown?', '', 'help'],
  ['I see what you mean.', '', 'help'],
  ['I am looking forward to tomorrow.', '', 'help'],
  ['Tell me how a camera works.', '', 'help'],
  ['What time is it?', 'user: Describe the room. | assistant: A kitchen.', 'help'],
  ['Where am I right now?', '', 'help'],
  ['Remember that my appointment is on Tuesday.', '', 'help'],
  ['Do not use my camera. Explain what a red apple is.', '', 'help'],
  ['Tell me more about that.', '', 'help'],
] as const;
async function main() {
  const provider = new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash' });
  let failed = 0;
  let completed = 0;
  for (const [utterance, context, expected] of cases) {
    completed++;
    const start = Date.now();
    try {
      const actual = await provider.classifyIntent(utterance, context);
      if (actual !== expected) failed++;
      console.log(
        JSON.stringify({
          utterance,
          expected,
          actual,
          passed: actual === expected,
          ms: Date.now() - start,
        }),
      );
    } catch (error) {
      failed++;
      console.log(
        JSON.stringify({
          utterance,
          expected,
          passed: false,
          error:
            error instanceof Error
              ? error.message.split(process.env.GEMINI_API_KEY ?? 'NO_KEY').join('[hidden]')
              : 'Error',
        }),
      );
      break;
    }
  }
  console.log(`${completed - failed}/${completed} cases passed`);
  process.exitCode = failed || completed !== cases.length ? 1 : 0;
}
void main();
