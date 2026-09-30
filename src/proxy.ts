import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './server/auth/session-policy';

/**
 * Cheap first gate for signed-in areas: no session cookie → /login?next=…
 * The real checks (valid session, role, duty, forced password change) run in the route-group layouts.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/monitor/:path*',
    '/tasks/:path*',
    '/evaluate/:path*',
    '/requests/:path*',
    '/inbox/:path*',
    '/account/:path*',
  ],
};
