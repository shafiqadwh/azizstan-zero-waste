/** 06-auth §1.1 session lifetimes. Pure so the rules are unit-testable without a clock or DB. */
export const SESSION_COOKIE = 'zw_session';
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionTimes {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date; // createdAt + absolute lifetime
}

export type SessionCheck = { valid: false } | { valid: true; touch: boolean };

export function checkSession(s: SessionTimes, now: Date): SessionCheck {
  if (now.getTime() >= s.expiresAt.getTime()) return { valid: false };
  const idle = now.getTime() - s.lastSeenAt.getTime();
  if (idle >= IDLE_TIMEOUT_MS) return { valid: false };
  return { valid: true, touch: idle >= TOUCH_INTERVAL_MS };
}
