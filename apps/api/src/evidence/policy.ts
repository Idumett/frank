import type { Intent } from '@frank/contracts';

const visualIntents = new Set<Intent>(['read_text', 'describe_scene', 'remember_this']);
export function intentNeedsImage(intent: Intent) {
  return visualIntents.has(intent);
}

export function inferIntent(utterance: string, selected: Intent = 'help'): Intent {
  if (selected !== 'help') return selected;
  const text = utterance.trim().toLowerCase();
  if (/\b(read|label|sign|letter|menu|document|written|text says)\b/.test(text)) return 'read_text';
  if (/\b(remember this|save this|remember what|store this)\b/.test(text)) return 'remember_this';
  if (/\b(remember|recall|where did i (put|leave)|what did i)\b/.test(text)) return 'recall';
  if (
    /\b(look(?:ing)?|see(?:ing)?|camera|in front|ahead of me|around me|describe|what is this|what's this|what is here)\b/.test(
      text,
    )
  )
    return 'describe_scene';
  return 'help';
}

export function frameAge(capturedAt: string, claimedAgeMs: number, now = Date.now()) {
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured)) return { valid: false, ageMs: Number.POSITIVE_INFINITY };
  const measured = now - captured;
  if (measured < -positiveInt(process.env.FRAME_CLOCK_SKEW_MS, 10_000))
    return { valid: false, ageMs: measured };
  return { valid: true, ageMs: Math.max(measured, claimedAgeMs) };
}

export function maxFrameAgeMs() {
  return positiveInt(process.env.FRAME_MAX_AGE_MS, 4_000);
}
function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
