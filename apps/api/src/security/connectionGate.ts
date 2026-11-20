export type ConnectionLease = { release: () => void };

export class ConnectionGate {
  private total = 0;
  private readonly perOwner = new Map<string, number>();

  constructor(
    private readonly maxPerOwner: number,
    private readonly maxTotal: number,
  ) {
    if (!Number.isInteger(maxPerOwner) || maxPerOwner < 1)
      throw new Error('Connection limit per owner must be a positive integer');
    if (!Number.isInteger(maxTotal) || maxTotal < maxPerOwner)
      throw new Error('Total connection limit must cover the per-owner limit');
  }

  acquire(ownerId: string): ConnectionLease | null {
    const ownerCount = this.perOwner.get(ownerId) ?? 0;
    if (ownerCount >= this.maxPerOwner || this.total >= this.maxTotal) return null;
    this.perOwner.set(ownerId, ownerCount + 1);
    this.total += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const remaining = (this.perOwner.get(ownerId) ?? 1) - 1;
        if (remaining > 0) this.perOwner.set(ownerId, remaining);
        else this.perOwner.delete(ownerId);
        this.total = Math.max(0, this.total - 1);
      },
    };
  }
}
