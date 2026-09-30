/**
 * Login, logout, password change and session validation (06-auth §1).
 * Every mutation runs in a transaction and writes one audit row (AGENTS §5 rule 2).
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { newId } from '../../lib/ids.ts';
import { externalAuth, type ExternalAuthProvider } from '../auth/external.ts';
import { hashPassword, PASSWORD_MIN_LENGTH, verifyAgainstDummy, verifyPassword } from '../auth/password.ts';
import { loginLimiter, type LoginRateLimiter } from '../auth/rate-limit.ts';
import { afterLogin } from '../auth/redirects.ts';
import { ABSOLUTE_LIFETIME_MS, checkSession } from '../auth/session-policy.ts';
import { newSessionToken, sessionIdFromToken } from '../auth/tokens.ts';
import { AppError, parseInput, validation } from '../errors.ts';
import type { SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/users.repository.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';

export const MSG = {
  invalidCredentials: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  schoolUnavailable: 'ระบบยืนยันตัวตนของโรงเรียนไม่ตอบสนอง',
  wrongCurrentPassword: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
  passwordTooShort: `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`,
  passwordSame: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม',
  passwordMismatch: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน',
  schoolAccount: 'บัญชีนี้ใช้รหัสผ่านของระบบโรงเรียน เปลี่ยนรหัสผ่านที่นี่ไม่ได้',
} as const;

export const loginInput = z.object({
  username: z.string().trim().min(1, 'กรุณากรอกชื่อผู้ใช้').max(100),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน').max(200),
  next: z.string().max(500).optional(),
});

export const changePasswordInput = z
  .object({
    current: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน').max(200),
    next: z.string().min(PASSWORD_MIN_LENGTH, MSG.passwordTooShort).max(200),
    confirm: z.string().max(200),
  })
  .refine((v) => v.next === v.confirm, { message: MSG.passwordMismatch, path: ['confirm'] })
  .refine((v) => v.next !== v.current, { message: MSG.passwordSame, path: ['next'] });

export interface ClientMeta {
  ip: string;
  userAgent: string | null;
}

export interface AuthDeps {
  limiter?: LoginRateLimiter;
  external?: ExternalAuthProvider;
}

function toSessionUser(u: repo.UserRow, sessionId: string): SessionUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    authSource: u.authSource,
    mustChangePassword: u.mustChangePassword,
    sessionId,
  };
}

export async function login(
  db: Db,
  raw: z.input<typeof loginInput>,
  meta: ClientMeta,
  now: Date,
  deps: AuthDeps = {},
): Promise<{ token: string; expiresAt: Date; user: SessionUser; redirectTo: string }> {
  const input = parseInput(loginInput, raw);
  const limiter = deps.limiter ?? loginLimiter();
  if (limiter.isBlocked(meta.ip, input.username, now)) throw new AppError('RATE_LIMITED');

  const fail = (message: string = MSG.invalidCredentials): never => {
    limiter.recordFailure(meta.ip, input.username, now);
    throw new AppError('UNAUTHENTICATED', { message, field: 'password' });
  };

  const user = await repo.findUserByUsername(db, input.username);
  if (!user) {
    // OPEN-QUESTION: Q1 — first login of an unknown school user would create a disabled teacher row here.
    await verifyAgainstDummy(input.password);
    return fail();
  }

  if (user.authSource === 'school') {
    const res = await (deps.external ?? externalAuth).verify(input.username, input.password);
    if (!res.ok) return fail(res.reason === 'unavailable' ? MSG.schoolUnavailable : MSG.invalidCredentials);
  } else {
    const okPassword = user.passwordHash ? await verifyPassword(user.passwordHash, input.password) : false;
    if (!okPassword) return fail();
  }
  if (!user.isActive) return fail();

  limiter.reset(meta.ip, input.username);
  const token = newSessionToken();
  const sessionId = sessionIdFromToken(token);
  const expiresAt = new Date(now.getTime() + ABSOLUTE_LIFETIME_MS);

  await withTransaction(db, async (tx) => {
    await repo.insertSession(tx, {
      id: sessionId,
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await repo.setLastLogin(tx, user.id, now);
    await writeAudit(
      tx,
      { actorId: user.id, action: 'user.login', entity: 'user', entityId: user.id, ip: meta.ip },
      now,
    );
  });

  return { token, expiresAt, user: toSessionUser(user, sessionId), redirectTo: afterLogin(user, input.next) };
}

/** Resolve a cookie token to its user; deletes expired sessions and slides `last_seen_at` at most every 5 min. */
export async function validateSession(db: Db, token: string, now: Date): Promise<SessionUser | null> {
  const sessionId = sessionIdFromToken(token);
  const row = await repo.findSessionWithUser(db, sessionId);
  if (!row) return null;
  const check = checkSession(row.session, now);
  if (!check.valid || !row.user.isActive) {
    await repo.deleteSession(db, sessionId);
    return null;
  }
  if (check.touch) await repo.touchSession(db, sessionId, now);
  return toSessionUser(row.user, sessionId);
}

export async function logout(db: Db, user: SessionUser, meta: ClientMeta, now: Date): Promise<void> {
  await withTransaction(db, async (tx) => {
    await repo.deleteSession(tx, user.sessionId);
    await writeAudit(
      tx,
      { actorId: user.id, action: 'user.logout', entity: 'user', entityId: user.id, ip: meta.ip },
      now,
    );
  });
}

export async function changePassword(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof changePasswordInput>,
  meta: ClientMeta,
  now: Date,
): Promise<void> {
  const input = parseInput(changePasswordInput, raw);
  const user = await repo.findUserById(db, actor.id);
  if (!user) throw new AppError('UNAUTHENTICATED');
  if (user.authSource !== 'local') throw validation('current', MSG.schoolAccount);
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.current))) {
    throw validation('current', MSG.wrongCurrentPassword);
  }
  const passwordHash = await hashPassword(input.next);
  await withTransaction(db, async (tx) => {
    await repo.setPassword(tx, user.id, passwordHash, false, now);
    await repo.deleteOtherSessions(tx, user.id, actor.sessionId);
    // Never log the hash or the password: the audit row only records that it changed.
    await writeAudit(
      tx,
      { actorId: user.id, action: 'user.change_password', entity: 'user', entityId: user.id, ip: meta.ip },
      now,
    );
  });
}

/** Create or reset a super admin (scripts/create-super-admin). The password is set by the operator. */
export async function upsertSuperAdmin(
  db: Db,
  input: { username: string; displayName: string; password: string },
  now: Date,
): Promise<'created' | 'updated'> {
  if (input.password.length < PASSWORD_MIN_LENGTH) throw validation('password', MSG.passwordTooShort);
  const passwordHash = await hashPassword(input.password);
  const existing = await repo.findUserByUsername(db, input.username);
  return withTransaction(db, async (tx) => {
    if (existing) {
      await repo.updateUser(tx, existing.id, {
        role: 'super_admin',
        authSource: 'local',
        passwordHash,
        mustChangePassword: false,
        isActive: true,
        updatedAt: now,
      });
      await writeAudit(
        tx,
        { actorId: null, action: 'user.reset_super_admin', entity: 'user', entityId: existing.id },
        now,
      );
      return 'updated';
    }
    const id = newId();
    await repo.insertUser(tx, {
      id,
      username: input.username.trim(),
      displayName: input.displayName,
      role: 'super_admin',
      authSource: 'local',
      passwordHash,
      mustChangePassword: false,
    });
    await writeAudit(tx, { actorId: null, action: 'user.create_super_admin', entity: 'user', entityId: id }, now);
    return 'created';
  });
}
