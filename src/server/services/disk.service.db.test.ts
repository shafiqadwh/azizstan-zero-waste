/** Disk space watch (14-deployment §4) against PostgreSQL: one notice per day at 80 % used. */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { notifications } from '../../../db/schema.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { checkDisk, measureDisk, readLastDisk, type DiskUsage } from './disk.service.ts';
import { getRetentionOverview } from './retention.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_disk_${randomBytes(4).toString('hex')}`;
const withDb = (name: string) => Object.assign(new URL(baseUrl), { pathname: `/${name}` }).toString();
const pgAdmin = async (sql: string) => {
  const c = new pg.Client({ connectionString: withDb('postgres') });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
};

const GB = 1024 ** 3;
const usage = (usedRatio: number): DiskUsage => ({
  totalBytes: 100 * GB,
  freeBytes: (1 - usedRatio) * 100 * GB,
  usedRatio,
});
const fake = (u: DiskUsage) => ({ measure: async () => u });
const now = new Date('2026-10-02T03:15:00Z'); // 10:15 Bangkok
const meta = { ip: '10.0.0.23', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let adminIds: string[];
let su: SessionUser;

const diskNotices = () => db.select().from(notifications).where(eq(notifications.type, 'disk_space'));

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  su = (
    await login(db, { username: 'root', password: 'root-password' }, meta, now, {
      limiter: new LoginRateLimiter(),
    })
  ).user;
  const adm = await createUser(db, su, { username: 'adm', displayName: 'adm', role: 'admin' }, meta, now);
  await createUser(db, su, { username: 't.one', displayName: 't1', role: 'teacher' }, meta, now);
  adminIds = [su.id, adm.userId];
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

test('measures a real directory', async () => {
  const u = await measureDisk(tmpdir());
  expect(u.totalBytes).toBeGreaterThan(0);
  expect(u.freeBytes).toBeLessThanOrEqual(u.totalBytes);
  expect(u.usedRatio).toBeGreaterThanOrEqual(0);
  expect(u.usedRatio).toBeLessThanOrEqual(1);
});

test('below 80 %: the reading is stored, nobody is notified', async () => {
  expect(await checkDisk(db, now, fake(usage(0.79)))).toMatchObject({ alerted: false });
  expect(await diskNotices()).toEqual([]);
  expect(await readLastDisk(db)).toMatchObject({ usedRatio: 0.79, at: now.toISOString() });
});

test('at 80 %: every admin (not teachers) gets one notice a day; the next day again', async () => {
  expect(await checkDisk(db, now, fake(usage(0.85)))).toMatchObject({ alerted: true });
  const first = await diskNotices();
  expect(first.map((n) => n.userId).sort()).toEqual([...adminIds].sort());
  expect(first[0]).toMatchObject({
    title: 'พื้นที่ดิสก์ใกล้เต็ม (ใช้ไป 85%)',
    link: '/admin/settings/privacy',
  });
  expect(first[0]!.body).toContain('เหลือ 15.0 GB จาก 100.0 GB');

  // later the same Bangkok day: still full, no second notice
  const evening = new Date('2026-10-02T15:00:00Z'); // 22:00 Bangkok
  expect(await checkDisk(db, evening, fake(usage(0.9)))).toMatchObject({ alerted: false });
  expect(await diskNotices()).toHaveLength(2);

  // after midnight Bangkok (17:00 UTC) it is a new day
  const nextDay = new Date('2026-10-02T17:15:00Z');
  expect(await checkDisk(db, nextDay, fake(usage(0.9)))).toMatchObject({ alerted: true });
  expect(await diskNotices()).toHaveLength(4);
});

test('the privacy page overview carries the last reading', async () => {
  const o = await getRetentionOverview(db, su, now);
  expect(o.disk).toMatchObject({ usedRatio: 0.9 });
});
