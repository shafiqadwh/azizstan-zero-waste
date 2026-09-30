/**
 * Login rate limit (06-auth §1.1): 5 failures per 15 minutes per (IP, username); the next attempt is refused with
 * RATE_LIMITED, even with the right password. In memory: the app runs as one process (02-architecture §1), and a
 * restart only resets the window.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export class LoginRateLimiter {
  private failures = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max = LOGIN_MAX_FAILURES, windowMs = LOGIN_WINDOW_MS) {
    this.max = max;
    this.windowMs = windowMs;
  }

  private key(ip: string, username: string) {
    return `${ip}\u0000${username.trim().toLowerCase()}`;
  }

  private recent(key: string, now: Date): number[] {
    const since = now.getTime() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > since);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  isBlocked(ip: string, username: string, now: Date): boolean {
    return this.recent(this.key(ip, username), now).length >= this.max;
  }

  recordFailure(ip: string, username: string, now: Date): void {
    const key = this.key(ip, username);
    this.failures.set(key, [...this.recent(key, now), now.getTime()]);
  }

  reset(ip: string, username: string): void {
    this.failures.delete(this.key(ip, username));
  }
}

const g = globalThis as typeof globalThis & { __zwLoginLimiter?: LoginRateLimiter };
/** Process-wide limiter (survives dev hot reloads). */
export function loginLimiter(): LoginRateLimiter {
  g.__zwLoginLimiter ??= new LoginRateLimiter();
  return g.__zwLoginLimiter;
}
