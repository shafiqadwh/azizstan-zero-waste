/** First-day setup checklist (14-deployment §2 step 7) against PostgreSQL: each step ticks from the data. */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { appointmentOrders, rounds, syncRuns } from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { getSetupChecklist } from './setup.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_setup_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-10-02T03:00:00Z');
const meta = { ip: '10.0.0.23', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let su: SessionUser;
let admin: SessionUser;
let executive: SessionUser;
let teacher: SessionUser;

const state = async () =>
  Object.fromEntries((await getSetupChecklist(db, admin)).map((s) => [s.key, s.done ? 'done' : s.detail]));

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  su = await signIn('root', 'root-password');
  const mk = async (username: string, role: 'admin' | 'teacher' | 'executive') => {
    const u = await createUser(db, su, { username, displayName: username, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'admin');
  executive = await mk('exe', 'executive');
  teacher = await mk('t.one', 'teacher');
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

test('a new install starts with nothing done; per-term steps wait for an active term', async () => {
  expect(await state()).toEqual({
    areas: 'ยังไม่มีอาคาร',
    rooms: 'ยังไม่มีห้อง',
    classes: 'ยังไม่มีห้องเรียน · sync รายชื่อสร้างห้องสามัญและ ปวช. ให้ได้',
    students: 'ยังไม่เคยซิงก์สำเร็จ',
    term: 'ยังไม่มีภาคเรียนที่ใช้งาน',
    rounds: 'เปิดใช้ภาคเรียนก่อน',
    'term-classes': 'เปิดใช้ภาคเรียนก่อน',
    duties: 'เปิดใช้ภาคเรียนก่อน',
    orders: 'เปิดใช้ภาคเรียนก่อน',
  });
});

test('steps tick as the admin fills the system in, in the documented order', async () => {
  const b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121', floor: 2 }, meta, now);
  const A = await upsertClass(
    db,
    admin,
    { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 1, name: 'Amanah' },
    meta,
    now,
  );
  await db.insert(syncRuns).values([
    { id: newId(), source: 'general', status: 'failed', startedAt: now },
    { id: newId(), source: 'general', status: 'success', startedAt: now, finishedAt: now },
  ]);
  const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  let s = await state();
  expect(s).toMatchObject({ areas: 'done', rooms: 'done', classes: 'done', students: 'done', term: 'done' });
  expect(s.rounds).toBe('ยังไม่มีรอบ');
  expect(s['term-classes']).toBe('ยังไม่ได้เลือก');
  expect(s.duties).toBe('ยังไม่ได้มอบหมาย');
  expect(s.orders).toBe('ยังไม่ได้อัปโหลด');

  await db.insert(rounds).values({
    id: newId(),
    termId,
    roundNo: 1,
    opensAt: new Date('2026-11-16T01:00:00Z'),
    closesAt: new Date('2026-11-20T09:30:00Z'),
  });
  await setTermClasses(db, admin, { termId, classIds: [A] }, meta, now);
  await assignDuty(
    db,
    admin,
    { termId, userId: teacher.id, duty: 'committee', targetType: 'class', targetId: A },
    meta,
    now,
  );
  await db
    .insert(appointmentOrders)
    .values({ id: newId(), termId, title: 'คำสั่งที่ 1/2569', filePath: 'orders/2569/x.pdf', uploadedBy: admin.id });
  s = await state();
  expect(s).toMatchObject({ rounds: 'done', 'term-classes': 'done', duties: 'done', orders: 'done' });
  const steps = await getSetupChecklist(db, admin);
  expect(steps.find((x) => x.key === 'term')?.detail).toBe('ใช้งาน ภาคเรียนที่ 2/2569');
});

test('only admins see it (executives read the dashboard without the setup card)', async () => {
  await expect(getSetupChecklist(db, executive)).rejects.toThrow();
  await expect(getSetupChecklist(db, teacher)).rejects.toThrow();
});
