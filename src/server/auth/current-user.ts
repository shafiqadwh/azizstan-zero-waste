import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '../db.ts';
import { unauthenticated } from '../errors.ts';
import type { SessionUser } from '../policies/index.ts';
import { validateSession, type ClientMeta } from '../services/auth.service.ts';
import { CHANGE_PASSWORD_PATH, LOGIN_PATH } from './redirects.ts';
import { SESSION_COOKIE } from './session-policy.ts';

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(getDb(), token, new Date());
});

/**
 * For server actions: the signed-in user or UNAUTHENTICATED. Users who must change their password can only
 * call the actions that allow it (`allowMustChange`).
 */
export async function requireUser(opts: { allowMustChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  if (user.mustChangePassword && !opts.allowMustChange) throw unauthenticated();
  return user;
}

/** For pages and layouts: redirect to login (or to the forced password change) instead of throwing. */
export async function requirePageUser(
  currentPath: string,
  opts: { allowMustChange?: boolean } = {},
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`${LOGIN_PATH}?next=${encodeURIComponent(currentPath)}`);
  if (user.mustChangePassword && !opts.allowMustChange) {
    redirect(`${CHANGE_PASSWORD_PATH}?next=${encodeURIComponent(currentPath)}`);
  }
  return user;
}

/** Client IP (Cloudflare Tunnel sets CF-Connecting-IP) and user agent, for rate limits, sessions and audit. */
export async function clientMeta(): Promise<ClientMeta> {
  const h = await headers();
  const ip =
    h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
  return { ip, userAgent: h.get('user-agent') };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true, // browsers accept Secure cookies on http://localhost too
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
