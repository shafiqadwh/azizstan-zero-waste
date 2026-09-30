import type { Role } from '../policies/index.ts';

export const LOGIN_PATH = '/login';
export const CHANGE_PASSWORD_PATH = '/account/password';

/** Only same-site relative paths are followed after login (no open redirect, no protocol-relative `//host`). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith(LOGIN_PATH)) return null;
  return next;
}

export function homeFor(role: Role): string {
  return role === 'teacher' ? '/tasks' : '/admin';
}

export function afterLogin(user: { role: Role; mustChangePassword: boolean }, next?: string | null): string {
  const target = safeNext(next) ?? homeFor(user.role);
  if (user.mustChangePassword) return `${CHANGE_PASSWORD_PATH}?next=${encodeURIComponent(target)}`;
  return target;
}
