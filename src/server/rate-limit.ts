/** Fixed-size sliding window per key, in memory (the app is one process — 02-architecture §1). */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Records a hit and returns false when the key already used up its window. */
  tryHit(key: string, now: Date): boolean {
    const since = now.getTime() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now.getTime());
    this.hits.set(key, list);
    return true;
  }
}
