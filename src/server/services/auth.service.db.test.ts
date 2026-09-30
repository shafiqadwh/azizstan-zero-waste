/** Auth service against PostgreSQL (T10 acceptance: 06-auth §1.1; 6th wrong password → RATE_LIMITED). */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { newId } from '../../lib/ids.ts';
import type { ExternalAuthProvider } from '../auth/external.ts';
import { hashPassword } from '../auth/password.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import { IDLE_TIMEOUT_MS } from '../auth/session-policy.ts';
import { changePassword, login, logout, upsertSuperAdmin, validateSession } from './auth.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_auth_${randomBytes(4).toString('hex')}`;
const withDb = (name: string) => Object.assign(new URL(baseUrl), { pathname: `/${name}` }).toString();
const url = withDb(dbName);
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
const meta = { ip: '10.0.0.5', userAgent: 'vitest' };
const now = new Date('2026-11-16T01:00:00Z');

async function makeUser(
  opts: Partial<{ role: 'admin' | 'teacher'; mustChange: boolean; active: boolean; school: boolean }> = {},
) {
  const username = `u_${randomBytes(3).toString('hex')}`;
  const id = newId();
  await db.execute(
    // raw insert keeps the test independent of service code
    (await import('drizzle-orm'))
      .sql`INSERT INTO users (id, username, display_name, role, auth_source, password_hash, must_change_password, is_active)
      VALUES (${id}, ${username}, ${'ครูทดสอบ'}, ${opts.role ?? 'admin'}, ${opts.school ? 'school' : 'local'},
              ${opts.school ? null : await hashPassword('correct-horse')}, ${opts.mustChange ?? false}, ${opts.active ?? true})`,
  );
  return { id, username };
}

const count = async (sql: string) =>
  Number(((await db.execute((await import('drizzle-orm')).sql.raw(sql))).rows[0] as { n: number }).n);

beforeAll(async () => {
  await admin(`CREATE DATABASE ${dbName}`);
  await runMigrations(url);
  ({ db, close } = createDb(url));
});

afterAll(async () => {
  await close?.();
  await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('login', () => {
  test('correct password → session (sha256 of token stored), audit row, redirect by role', async () => {
    const u = await makeUser();
    const res = await login(db, { username: u.username.toUpperCase(), password: 'correct-horse' }, meta, now, {
      limiter: new LoginRateLimiter(),
    });
    expect(res.redirectTo).toBe('/admin');
    expect(res.token).not.toMatch(/^[0-9a-f]{64}$/);
    expect(
      await count(`SELECT count(*) AS n FROM sessions WHERE user_id = '${u.id}' AND id = '${res.user.sessionId}'`),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'user.login' AND entity_id = '${u.id}'`),
    ).toBe(1);
    expect((await validateSession(db, res.token, new Date(now.getTime() + 60_000)))?.id).toBe(u.id);
  });

  test('wrong password, unknown user and inactive user all fail the same way', async () => {
    const limiter = new LoginRateLimiter();
    const u = await makeUser();
    const off = await makeUser({ active: false });
    for (const attempt of [
      { username: u.username, password: 'wrong-password' },
      { username: 'nobody-here', password: 'correct-horse' },
      { username: off.username, password: 'correct-horse' },
    ]) {
      await expect(login(db, attempt, meta, now, { limiter })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      });
    }
  });

  test('6th attempt after 5 wrong passwords → RATE_LIMITED, even with the right password', async () => {
    const limiter = new LoginRateLimiter();
    const u = await makeUser();
    for (let i = 0; i < 5; i++) {
      await expect(
        login(db, { username: u.username, password: `wrong-${i}` }, meta, now, { limiter }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    await expect(
      login(db, { username: u.username, password: 'correct-horse' }, meta, now, { limiter }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: 'ลองใหม่อีกครั้งในอีกสักครู่',
    });
    // another IP is not blocked
    await expect(
      login(db, { username: u.username, password: 'correct-horse' }, { ...meta, ip: '10.0.0.6' }, now, { limiter }),
    ).resolves.toBeTruthy();
  });

  test('must_change_password sends the user to the password page first', async () => {
    const u = await makeUser({ mustChange: true, role: 'teacher' });
    const res = await login(db, { username: u.username, password: 'correct-horse', next: '/tasks' }, meta, now, {
      limiter: new LoginRateLimiter(),
    });
    expect(res.redirectTo).toBe('/account/password?next=%2Ftasks');
  });

  test('school accounts use the external provider; the stub reports it unavailable', async () => {
    const u = await makeUser({ school: true, role: 'teacher' });
    await expect(
      login(db, { username: u.username, password: 'x' }, meta, now, { limiter: new LoginRateLimiter() }),
    ).rejects.toMatchObject({
      message: 'ระบบยืนยันตัวตนของโรงเรียนไม่ตอบสนอง',
    });
    const ok: ExternalAuthProvider = { verify: async () => ({ ok: true, externalId: 'T1', displayName: 'ครู' }) };
    await expect(
      login(db, { username: u.username, password: 'x' }, meta, now, { limiter: new LoginRateLimiter(), external: ok }),
    ).resolves.toMatchObject({ redirectTo: '/tasks' });
  });
});

describe('sessions', () => {
  test('idle for 12 hours → invalid and deleted', async () => {
    const u = await makeUser();
    const res = await login(db, { username: u.username, password: 'correct-horse' }, meta, now, {
      limiter: new LoginRateLimiter(),
    });
    expect(await validateSession(db, res.token, new Date(now.getTime() + IDLE_TIMEOUT_MS))).toBeNull();
    expect(await count(`SELECT count(*) AS n FROM sessions WHERE id = '${res.user.sessionId}'`)).toBe(0);
  });

  test('logout deletes the session', async () => {
    const u = await makeUser();
    const res = await login(db, { username: u.username, password: 'correct-horse' }, meta, now, {
      limiter: new LoginRateLimiter(),
    });
    await logout(db, res.user, meta, now);
    expect(await validateSession(db, res.token, now)).toBeNull();
  });
});

describe('change password', () => {
  test('checks the current password, clears the flag, signs out other sessions, never logs the hash', async () => {
    const u = await makeUser({ mustChange: true });
    const limiter = new LoginRateLimiter();
    const a = await login(db, { username: u.username, password: 'correct-horse' }, meta, now, { limiter });
    const b = await login(db, { username: u.username, password: 'correct-horse' }, meta, now, { limiter });

    await expect(
      changePassword(
        db,
        a.user,
        { current: 'nope-nope', next: 'new-password-1', confirm: 'new-password-1' },
        meta,
        now,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      field: 'current',
    });
    await expect(
      changePassword(db, a.user, { current: 'correct-horse', next: 'short', confirm: 'short' }, meta, now),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      field: 'next',
    });
    await expect(
      changePassword(
        db,
        a.user,
        { current: 'correct-horse', next: 'new-password-1', confirm: 'different-1' },
        meta,
        now,
      ),
    ).rejects.toMatchObject({
      field: 'confirm',
    });

    await changePassword(
      db,
      a.user,
      { current: 'correct-horse', next: 'new-password-1', confirm: 'new-password-1' },
      meta,
      now,
    );
    expect((await validateSession(db, a.token, now))?.mustChangePassword).toBe(false);
    expect(await validateSession(db, b.token, now)).toBeNull();
    await expect(
      login(db, { username: u.username, password: 'new-password-1' }, meta, now, { limiter }),
    ).resolves.toBeTruthy();
    expect(
      await count(
        `SELECT count(*) AS n FROM audit_logs WHERE action = 'user.change_password' AND before IS NULL AND after IS NULL`,
      ),
    ).toBe(1);
  });
});

test('upsertSuperAdmin creates, then resets the password of, a super admin', async () => {
  expect(await upsertSuperAdmin(db, { username: 'root', displayName: 'ผู้ดูแล', password: 'first-pass-1' }, now)).toBe(
    'created',
  );
  expect(await upsertSuperAdmin(db, { username: 'ROOT', displayName: 'ผู้ดูแล', password: 'second-pass-2' }, now)).toBe(
    'updated',
  );
  const res = await login(db, { username: 'root', password: 'second-pass-2' }, meta, now, {
    limiter: new LoginRateLimiter(),
  });
  expect(res.user.role).toBe('super_admin');
  await expect(
    upsertSuperAdmin(db, { username: 'root', displayName: 'x', password: 'short' }, now),
  ).rejects.toMatchObject({ code: 'VALIDATION' });
});
