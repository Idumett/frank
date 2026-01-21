/**
 * - Max 3 sentences
 * - Hard cap length
 * Maybe remove this?????
 */
//TODO: enforceShortReply; dont we already do this in the llm, why cut it short further with basic code?
export function enforceShortReply(
  text: string,
  opts?: { maxSentences?: number; maxChars?: number },
) {
  const maxSentences = opts?.maxSentences ?? 3;
  const maxChars = opts?.maxChars ?? 260;

  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Not sure. Try again.';

  // Split into sentences. Handles ., !, ?
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);

  const limited = sentences.slice(0, maxSentences).join(' ');
  if (limited.length <= maxChars) return limited;

  return limited.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

/**
 * Adds consistent low-confidence phrasing, but keeps it short.
 */
export function applyConfidenceTone(args: {
  text: string;
  confidence: 'low' | 'medium' | 'high';
  recaptureHint?: string;
}) {
  const base = (args.text ?? '').trim();

  if (args.confidence === 'high') return base;

  if (args.confidence === 'medium') {
    // Avoid verbosity
    return base;
  }

  // low confidence
  const prefix = 'Not sure. ';
  const hint = args.recaptureHint ? ` ${args.recaptureHint}` : '';

  // Keep the hint short
  const combined = (prefix + base + hint).replace(/\s+/g, ' ').trim();
  return combined;
}
