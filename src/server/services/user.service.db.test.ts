/** T12 acceptance: only the super admin creates users and sets roles; an admin calling them directly gets 403. */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { ERRORS } from '../errors.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { confirmPassword, login, validateSession, upsertSuperAdmin } from './auth.service.ts';
import {
  createUser,
  generateTempPassword,
  listUsers,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_users_${randomBytes(4).toString('hex')}`;
const withDb = (name: string) => Object.assign(new URL(baseUrl), { pathname: `/${name}` }).toString();
const admin = async (sql: string) => {
  const c = new pg.Client({ connectionString: withDb('postgres') });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
};

let db: Db;
let close: () => Promise<void>;
const meta = { ip: '10.0.0.9', userAgent: 'vitest' };
const now = new Date('2026-11-16T01:00:00Z');
const limiter = () => ({ limiter: new LoginRateLimiter() });

let root: SessionUser;
let anAdmin: SessionUser;

async function signIn(username: string, password: string) {
  return (await login(db, { username, password }, meta, now, limiter())).user;
}

beforeAll(async () => {
  await admin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  await upsertSuperAdmin(db, { username: 'root', displayName: 'ผู้ดูแล', password: 'root-password' }, now);
  root = await signIn('root', 'root-password');
  const created = await createUser(
    db,
    root,
    { username: 'admin.one', displayName: 'แอดมินหนึ่ง', role: 'admin' },
    meta,
    now,
  );
  anAdmin = await signIn('admin.one', created.tempPassword!);
});

afterAll(async () => {
  await close?.();
  await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('only the super admin manages users (Q3, Q8)', () => {
  const forbidden = { code: 'FORBIDDEN', message: ERRORS.FORBIDDEN.message };

  test('an admin calling the actions directly gets FORBIDDEN (HTTP 403)', async () => {
    expect(ERRORS.FORBIDDEN.http).toBe(403);
    const target = (await listUsers(db, root)).find((u) => u.username === 'root')!;
    await expect(
      createUser(db, anAdmin, { username: 'sneaky', displayName: 'x', role: 'admin' }, meta, now),
    ).rejects.toMatchObject(forbidden);
    await expect(setUserRole(db, anAdmin, { userId: target.id, role: 'teacher' }, meta, now)).rejects.toMatchObject(
      forbidden,
    );
    await expect(setUserActive(db, anAdmin, { userId: target.id, active: false }, meta, now)).rejects.toMatchObject(
      forbidden,
    );
    await expect(resetUserPassword(db, anAdmin, { userId: target.id }, meta, now)).rejects.toMatchObject(forbidden);
  });

  test('admins and executives can read the list; it never exposes password hashes', async () => {
    const list = await listUsers(db, anAdmin);
    expect(list.map((u) => u.username)).toEqual(expect.arrayContaining(['root', 'admin.one']));
    for (const u of list) expect(Object.keys(u)).not.toContain('passwordHash');
  });
});

describe('create user', () => {
  test('local account: temporary password shown once, must be changed at first login; audited without it', async () => {
    const res = await createUser(db, root, { username: 'Teacher.A', displayName: 'ครูเอ', role: 'teacher' }, meta, now);
    expect(res.tempPassword).toMatch(/^[a-zA-Z2-9]{10}$/);
    const out = await login(db, { username: 'teacher.a', password: res.tempPassword! }, meta, now, limiter());
    expect(out.redirectTo).toBe('/account/password?next=%2Ftasks');
    const audit = await db.execute(
      `SELECT after::text AS a FROM audit_logs WHERE action = 'user.create' AND entity_id = '${res.userId}'`,
    );
    expect((audit.rows[0] as { a: string }).a).not.toContain(res.tempPassword!);
  });

  test('school account has no password', async () => {
    const res = await createUser(
      db,
      root,
      { username: 'school.t', displayName: 'ครูบี', role: 'teacher', authSource: 'school' },
      meta,
      now,
    );
    expect(res.tempPassword).toBeNull();
  });

  test('duplicate username (any case) and bad format are field errors', async () => {
    await expect(
      createUser(db, root, { username: 'ADMIN.ONE', displayName: 'x', role: 'teacher' }, meta, now),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      field: 'username',
      message: 'ชื่อผู้ใช้นี้มีอยู่แล้ว',
    });
    await expect(
      createUser(db, root, { username: 'มีช่อง ว่าง', displayName: 'x', role: 'teacher' }, meta, now),
    ).rejects.toMatchObject({
      field: 'username',
    });
  });
});

describe('roles, activation, password reset', () => {
  test('set role is audited with before/after', async () => {
    const { userId } = await createUser(
      db,
      root,
      { username: 'exec.x', displayName: 'ผู้บริหาร', role: 'teacher' },
      meta,
      now,
    );
    await setUserRole(db, root, { userId, role: 'executive' }, meta, now);
    expect((await listUsers(db, root)).find((u) => u.id === userId)?.role).toBe('executive');
    const audit = await db.execute(
      `SELECT before, after FROM audit_logs WHERE action = 'user.set_role' AND entity_id = '${userId}'`,
    );
    expect(audit.rows[0]).toEqual({ before: { role: 'teacher' }, after: { role: 'executive' } });
  });

  test('deactivating signs the user out and blocks login; reactivating restores it', async () => {
    const { userId, tempPassword } = await createUser(
      db,
      root,
      { username: 'temp.user', displayName: 'ชั่วคราว', role: 'teacher' },
      meta,
      now,
    );
    const session = await login(db, { username: 'temp.user', password: tempPassword! }, meta, now, limiter());
    await setUserActive(db, root, { userId, active: false }, meta, now);
    expect(await validateSession(db, session.token, now)).toBeNull();
    await expect(
      login(db, { username: 'temp.user', password: tempPassword! }, meta, now, limiter()),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await setUserActive(db, root, { userId, active: true }, meta, now);
    await expect(
      login(db, { username: 'temp.user', password: tempPassword! }, meta, now, limiter()),
    ).resolves.toBeTruthy();
  });

  test('reset password issues a new temporary password and ends sessions; school accounts cannot be reset', async () => {
    const { userId, tempPassword } = await createUser(
      db,
      root,
      { username: 'forgetful', displayName: 'ลืมรหัส', role: 'admin' },
      meta,
      now,
    );
    const session = await login(db, { username: 'forgetful', password: tempPassword! }, meta, now, limiter());
    const { tempPassword: next } = await resetUserPassword(db, root, { userId }, meta, now);
    expect(next).not.toBe(tempPassword);
    expect(await validateSession(db, session.token, now)).toBeNull();
    await expect(login(db, { username: 'forgetful', password: next }, meta, now, limiter())).resolves.toMatchObject({
      user: { mustChangePassword: true },
    });
    const school = (await listUsers(db, root)).find((u) => u.username === 'school.t')!;
    await expect(resetUserPassword(db, root, { userId: school.id }, meta, now)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  test('the super admin cannot demote or deactivate themself, and the last super admin stays', async () => {
    await expect(setUserRole(db, root, { userId: root.id, role: 'admin' }, meta, now)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(setUserActive(db, root, { userId: root.id, active: false }, meta, now)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const { userId } = await createUser(
      db,
      root,
      { username: 'second.root', displayName: 'สำรอง', role: 'super_admin' },
      meta,
      now,
    );
    await setUserRole(db, root, { userId, role: 'admin' }, meta, now); // root still remains
    expect((await listUsers(db, root)).filter((u) => u.role === 'super_admin' && u.isActive)).toHaveLength(1);
  });

  test('unknown user id → NOT_FOUND', async () => {
    await expect(
      setUserRole(db, root, { userId: '01900000-0000-7000-8000-000000000000', role: 'admin' }, meta, now),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

test('temporary passwords avoid look-alike characters', () => {
  for (let i = 0; i < 200; i++) expect(generateTempPassword()).not.toMatch(/[0O1lIi]/);
});

describe('step-up: permission changes need the password within 10 minutes (12-security §2 item 7)', () => {
  test('a session older than 10 minutes must re-enter the password; wrong passwords count toward the limit', async () => {
    const later = new Date(now.getTime() + 11 * 60_000);
    const stale = { ...root, stepUpAt: now };
    const create = (actor: SessionUser, at: Date, username: string) =>
      createUser(db, actor, { username, displayName: 'x', role: 'teacher' }, meta, at);
    await expect(create(stale, later, 'late.one')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    // the admin still gets FORBIDDEN first: step-up never reveals more than the permission check
    await expect(create({ ...anAdmin, stepUpAt: null }, later, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const lim = new LoginRateLimiter(2, 15 * 60_000);
    await expect(confirmPassword(db, stale, { password: 'nope' }, meta, later, { limiter: lim })).rejects.toMatchObject(
      {
        code: 'VALIDATION',
      },
    );
    const out = await confirmPassword(db, stale, { password: 'root-password' }, meta, later, { limiter: lim });
    expect(out.validUntil).toEqual(new Date(later.getTime() + 10 * 60_000));
    // the session row now carries the step-up, so the next request's user is allowed
    const fresh = { ...root, stepUpAt: later };
    await expect(create(fresh, later, 'late.two')).resolves.toMatchObject({ tempPassword: expect.any(String) });
    await expect(create(fresh, new Date(later.getTime() + 10 * 60_000), 'late.three')).rejects.toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    for (let i = 0; i < 2; i++)
      await confirmPassword(db, stale, { password: 'bad' }, meta, later, { limiter: lim }).catch(() => undefined);
    await expect(
      confirmPassword(db, stale, { password: 'root-password' }, meta, later, { limiter: lim }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
