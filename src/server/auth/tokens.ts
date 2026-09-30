import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url — the value that lives only in the `zw_session` cookie. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `sessions.id` = sha256(token): a leaked DB row cannot be replayed as a cookie. */
export function sessionIdFromToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
