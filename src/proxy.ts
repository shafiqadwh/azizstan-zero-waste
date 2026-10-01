import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './server/security-headers';
import { SESSION_COOKIE } from './server/auth/session-policy';

/** Signed-in areas: no session cookie → /login?next=… (the real checks run in the route-group layouts). */
const PROTECTED = ['/admin', '/monitor', '/tasks', '/evaluate', '/requests', '/inbox', '/account'];

const isProtected = (path: string) => PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Runs for every page request:
 * 1. cheap first gate for signed-in areas;
 * 2. a per-request nonce CSP (12-security §2 item 1). Next.js reads the policy from the request headers and puts
 *    the nonce on its own scripts, so no inline script runs without it.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isProtected(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // pages only: not the API, Next's static files, or the public assets served as files
      source: '/((?!api|internal|_next/static|_next/image|icons|sw\\.js|manifest\\.webmanifest|favicon\\.ico).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
