type Bucket = { startedAt: number; count: number };
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private limit: number, private windowMs: number) {}
  take(key: string, now = Date.now()) {
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    current.count += 1;
    return { allowed: current.count <= this.limit, retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + this.windowMs - now) / 1000)) };
  }
}
