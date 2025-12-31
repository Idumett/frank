type Entry = { nextAllowedAt: number };

const map = new Map<string, Entry>();

// Optional: basic cleanup to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of map.entries()) {
    if (v.nextAllowedAt < now - 60_000) map.delete(k);
  }
}, 60_000).unref();

export function checkCooldown(key: string, cooldownMs: number) {
  const now = Date.now();
  const entry = map.get(key);

  if (entry && now < entry.nextAllowedAt) {
    return { allowed: false, waitMs: entry.nextAllowedAt - now };
  }

  map.set(key, { nextAllowedAt: now + cooldownMs });
  return { allowed: true, waitMs: 0 };
}
