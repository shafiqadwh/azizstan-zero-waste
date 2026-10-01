/**
 * Guards for the REST routes (12-security §2 items 2 and 5). Server Actions have Next.js's own origin check;
 * these cover `/api/v1/*`.
 */
import { AppError } from './errors';
import { SlidingWindowLimiter } from './rate-limit';

/**
 * The caller's address. Behind Cloudflare Tunnel, `CF-Connecting-IP` is the internet client; on the school network
 * the app's own server reports the socket address in `X-Forwarded-For`.
 */
export function callerIp(request: Request): string {
  const h = request.headers;
  return (
    h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown'
  );
}

/**
 * CSRF for cookie-authenticated mutations: the browser's `Origin` must be the app itself — `APP_URL`, or the host
 * the request was addressed to (LAN access by IP, local dev). A missing Origin is refused: every browser sends it
 * on POST/PUT/PATCH/DELETE.
 */
export function assertSameOrigin(request: Request, appUrl: string | undefined = process.env.APP_URL): void {
  const origin = request.headers.get('origin');
  if (!origin) throw new AppError('FORBIDDEN');
  const allowed = new Set<string>();
  if (appUrl) allowed.add(new URL(appUrl).origin);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
    allowed.add(`${proto}://${host}`);
  }
  if (!allowed.has(origin)) throw new AppError('FORBIDDEN');
}

/** Public API: 60 requests per minute per IP (12-security §2 item 5). */
export const PUBLIC_REQUESTS_PER_MINUTE = 60;

const g = globalThis as typeof globalThis & { __zwPublicLimiter?: SlidingWindowLimiter };
export function publicLimiter(): SlidingWindowLimiter {
  g.__zwPublicLimiter ??= new SlidingWindowLimiter(PUBLIC_REQUESTS_PER_MINUTE, 60_000);
  return g.__zwPublicLimiter;
}

export function assertPublicRate(request: Request, now: Date, limiter = publicLimiter()): void {
  if (!limiter.tryHit(callerIp(request), now)) throw new AppError('RATE_LIMITED');
}
