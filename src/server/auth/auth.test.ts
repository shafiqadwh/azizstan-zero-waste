import { describe, expect, test } from 'vitest';
import { LoginRateLimiter } from './rate-limit.ts';
import { afterLogin, safeNext } from './redirects.ts';
import { ABSOLUTE_LIFETIME_MS, checkSession, IDLE_TIMEOUT_MS, TOUCH_INTERVAL_MS } from './session-policy.ts';
import { sessionIdFromToken, newSessionToken } from './tokens.ts';

const t0 = new Date('2026-11-16T01:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const session = (lastSeenMs: number) => ({
  createdAt: t0,
  lastSeenAt: at(lastSeenMs),
  expiresAt: at(ABSOLUTE_LIFETIME_MS),
});

describe('session lifetime (06-auth §1.1)', () => {
  test('valid while active; touched at most every 5 minutes', () => {
    expect(checkSession(session(0), at(TOUCH_INTERVAL_MS - 1))).toEqual({ valid: true, touch: false });
    expect(checkSession(session(0), at(TOUCH_INTERVAL_MS))).toEqual({ valid: true, touch: true });
  });
  test('expires after 12 hours idle', () => {
    expect(checkSession(session(0), at(IDLE_TIMEOUT_MS - 1)).valid).toBe(true);
    expect(checkSession(session(0), at(IDLE_TIMEOUT_MS)).valid).toBe(false);
  });
  test('expires after 30 days even when active', () => {
    const lastSeen = ABSOLUTE_LIFETIME_MS - 60_000;
    expect(checkSession(session(lastSeen), at(ABSOLUTE_LIFETIME_MS)).valid).toBe(false);
  });
});

describe('login rate limit', () => {
  test('5 failures per 15 minutes per (IP, username); others unaffected; window slides', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(rl.isBlocked('1.1.1.1', 'Admin1', at(i * 1000))).toBe(false);
      rl.recordFailure('1.1.1.1', 'Admin1', at(i * 1000));
    }
    expect(rl.isBlocked('1.1.1.1', 'admin1', at(5000))).toBe(true); // username is case-insensitive
    expect(rl.isBlocked('2.2.2.2', 'admin1', at(5000))).toBe(false);
    expect(rl.isBlocked('1.1.1.1', 'admin2', at(5000))).toBe(false);
    expect(rl.isBlocked('1.1.1.1', 'admin1', at(15 * 60_000 + 1))).toBe(false);
  });
  test('a successful login resets the counter', () => {
    const rl = new LoginRateLimiter();
    for (let i = 0; i < 4; i++) rl.recordFailure('ip', 'u', t0);
    rl.reset('ip', 'u');
    rl.recordFailure('ip', 'u', t0);
    expect(rl.isBlocked('ip', 'u', t0)).toBe(false);
  });
});

describe('redirects', () => {
  test('only same-site relative next paths are followed', () => {
    expect(safeNext('/admin/approvals?tab=results')).toBe('/admin/approvals?tab=results');
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('/login?next=/admin')).toBeNull();
    expect(safeNext('')).toBeNull();
  });
  test('home by role, forced password change first', () => {
    expect(afterLogin({ role: 'admin', mustChangePassword: false })).toBe('/admin');
    expect(afterLogin({ role: 'executive', mustChangePassword: false })).toBe('/admin');
    expect(afterLogin({ role: 'teacher', mustChangePassword: false })).toBe('/tasks');
    expect(afterLogin({ role: 'teacher', mustChangePassword: false }, '/evaluate/new?target=1')).toBe(
      '/evaluate/new?target=1',
    );
    expect(afterLogin({ role: 'admin', mustChangePassword: true })).toBe('/account/password?next=%2Fadmin');
  });
});

test('session id is the sha256 of the token; tokens are 32 random bytes', () => {
  const token = newSessionToken();
  expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  expect(sessionIdFromToken(token)).toMatch(/^[0-9a-f]{64}$/);
  expect(sessionIdFromToken(token)).not.toContain(token);
});
