const sensitiveKeys = new Set([
  'address',
  'audiobase64',
  'authorization',
  'bytesbase64',
  'content',
  'coordinates',
  'imagebase64',
  'latitude',
  'longitude',
  'memoryquery',
  'password',
  'query',
  'secret',
  'speak',
  'text',
  'token',
  'transcript',
  'utterance',
]);

export function privacySafeTraceValue(value: unknown): unknown {
  return sanitize(value, undefined, 0, new WeakSet<object>());
}

export function privacySafeTraceError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? '');
  const normalized = message.trim().toLowerCase();
  const timeout = message.trim().match(/^([a-z0-9_.-]+) timed out after \d+ms$/i);
  if (timeout) return `${timeout[1].toLowerCase()}_timeout`;
  if (normalized === 'no speech recognized') return 'no_speech_recognized';
  if (normalized === 'stopped by client') return 'stopped_by_client';
  if (normalized === 'client disconnected') return 'client_disconnected';
  if (normalized === 'fresh camera evidence was not received') return 'camera_evidence_missing';
  if (normalized === 'failed to send audio') return 'audio_delivery_failed';
  if (normalized.includes('queue is full')) return 'provider_queue_full';
  if (normalized.includes('queue wait expired')) return 'provider_queue_timeout';
  return 'operation_failed';
}

function sanitize(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (key && sensitiveKeys.has(key.toLowerCase())) return '[redacted]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactSecrets(value).slice(0, 500);
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return { bytes: value.length };
  if (typeof value !== 'object') return undefined;
  if (depth >= 8 || seen.has(value)) return '[bounded]';
  seen.add(value);
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => sanitize(item, undefined, depth + 1, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([childKey, child]) => [
        childKey,
        childKey.toLowerCase() === 'error'
          ? privacySafeTraceError(child)
          : sanitize(child, childKey, depth + 1, seen),
      ]),
  );
}

function redactSecrets(value: string) {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
}
