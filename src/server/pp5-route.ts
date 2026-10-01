import { getDb } from './db';
import { toResponse } from './result';
import { authorizePp5 } from './services/pp5.service';

/**
 * The caller's address for the ปพ.5 allow-list. Behind Cloudflare Tunnel, `CF-Connecting-IP` is the internet client;
 * on the school network the app's own server reports the socket address in `X-Forwarded-For`.
 */
export function callerIp(request: Request): string {
  const h = request.headers;
  return (
    h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown'
  );
}

/** Network + API key check, then the handler; errors map to their HTTP status (401/403/404). */
export function pp5Route<T>(request: Request, fn: () => Promise<T>) {
  return toResponse(
    async () => {
      await authorizePp5(
        getDb(),
        { ip: callerIp(request), authorization: request.headers.get('authorization') },
        new Date(),
      );
      return fn();
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
