/**
 * Deterministic, speech-friendly shortening.
 *
 * Rules:
 * - Prefer sentence limits (keeps meaning)
 * - Char cap is a safety net
 * - Never cut mid-word into nonsense; cut at punctuation if possible,
 *   otherwise fall back to a short coherent message.
 */
export function enforceShortReply(
  text: string,
  opts?: {
    maxSentences?: number;
    maxChars?: number;
    fallback?: string; // used if we can't cut cleanly
  },
) {
  const maxSentences = opts?.maxSentences ?? 3;
  const maxChars = opts?.maxChars ?? 260;
  const fallback = opts?.fallback ?? 'Not sure. Try again.';

  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;

  // Split into sentences (., !, ?) – decent for TTS UX
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);

  // 1) Sentence clamp first
  let out = sentences.slice(0, maxSentences).join(' ');

  // 2) If still too long, try fewer sentences (keep meaning)
  if (out.length > maxChars && sentences.length > 1) {
    for (let s = Math.min(maxSentences, sentences.length); s >= 1; s--) {
      const candidate = sentences.slice(0, s).join(' ');
      if (candidate.length <= maxChars) {
        out = candidate;
        break;
      }
    }
  }

  // 3) If still too long, cut at a "safe boundary" (punctuation), else fallback
  if (out.length > maxChars) {
    const clipped = out.slice(0, maxChars).trimEnd();

    // Prefer ending at sentence punctuation or a natural pause punctuation
    const lastBoundary = Math.max(
      clipped.lastIndexOf('.'),
      clipped.lastIndexOf('!'),
      clipped.lastIndexOf('?'),
      clipped.lastIndexOf(';'),
      clipped.lastIndexOf(','),
      clipped.lastIndexOf(')'),
      clipped.lastIndexOf(']'),
    );

    // If there's a decent boundary, cut there; otherwise fallback (avoid nonsense)
    if (lastBoundary >= 40) {
      out = clipped.slice(0, lastBoundary + 1).trim();
    } else {
      out = fallback;
    }
  }

  return out;
}

/**
 * Adds consistent confidence phrasing without getting verbose.
 * Avoids duplicating "Not sure." if already present.
 */
export function applyConfidenceTone(args: {
  text: string;
  confidence: 'low' | 'medium' | 'high';
  recaptureHint?: string;
}) {
  const base = (args.text ?? '').replace(/\s+/g, ' ').trim();
  if (!base) return 'Not sure. Try again.';

  if (args.confidence === 'high') return base;
  if (args.confidence === 'medium') return base;

  // low confidence
  const alreadyNotSure = /^not sure[\.\!]/i.test(base);
  const prefix = alreadyNotSure ? '' : 'Not sure. ';

  // Keep hint short and avoid double spaces
  const hint = args.recaptureHint ? ` ${args.recaptureHint}` : '';
  const combined = (prefix + base + hint).replace(/\s+/g, ' ').trim();

  // Finally enforce shortness on the combined low-confidence output
  return enforceShortReply(combined, {
    maxSentences: 2,
    maxChars: 220,
    fallback: 'Not sure. Try again.',
  });
}
