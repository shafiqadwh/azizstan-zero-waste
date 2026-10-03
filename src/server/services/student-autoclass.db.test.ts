/** BR-Y step 4b: the student sync creates the general and vocational classes the register lacks. Synthetic data. */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { classes, notifications, students } from '../../../db/schema.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { runStudentSync, STUDENT_MSG, type StudentFetcher } from './student.service.ts';
import { activateTerm, createTerm } from './term.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_auto_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-11-18T19:00:00Z');
const meta = { ip: '10.0.0.26', userAgent: 'vitest' };
const HEADER =
  'รหัสนักเรียน,ชื่อ-สกุลนักเรียน,ชั้นสามัญ,ชั้นศาสนา,เพศ,เลขประจำตัวประชาชน,วันเดือนปีเกิด,จังหวัด,ชื่อ-สกุลผู้ปกครอง,เบอร์ติดต่อผู้ปกครอง,ชื่อ-สกุลผู้ประสานงาน';
const row = (code: string, general: string, religious = '') =>
  `${code},สมมติ ${code},${general},${religious},ชาย,1${code.padStart(12, '0')},01/01/2555,ปัตตานี,ผู้ปกครองสมมติ,0810000000,ผู้ประสานงานสมมติ`;
const csv = (...rows: string[]) => `﻿${[HEADER, ...rows].join('\r\n')}\r\n`;
const fetcher =
  (general: string, vocational: string): StudentFetcher =>
  async (source) =>
    source === 'general' ? general : vocational;

let db: Db;
let close: () => Promise<void>;
let admin: SessionUser;
const allClasses = () => db.select().from(classes);
const student = async (code: string) => (await db.select().from(students).where(eq(students.studentCode, code)))[0];

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  admin = (
    await login(db, { username: 'root', password: 'root-password' }, meta, now, {
      limiter: new LoginRateLimiter(),
    })
  ).user;
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

test('without an active term the sync fails and says how to fix it; nothing is created', async () => {
  const out = await runStudentSync(db, { fetcher: fetcher(csv(row('70001', 'ม.1/1 Amanah')), csv()), now });
  expect(out).toMatchObject({ status: 'failed', error: STUDENT_MSG.noTerm });
  expect(STUDENT_MSG.noTerm).toContain('ภาคเรียน');
  expect(await allClasses()).toEqual([]);
});

test('an empty register: general and vocational classes are created, misspellings fold, religious-only goes to review', async () => {
  const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  const out = await runStudentSync(db, {
    fetcher: fetcher(
      csv(
        row('70001', 'ม.1/1 Amanah'),
        row('70002', 'ม .1/1  Amanah'),
        row('70003', 'ม.1/6 Ikhlas'),
        row('70004', 'ม.1/6 Iklas'), // known misspelling → the same class
        row('70005', 'ม.4/1 Intan', 'PR 4/1 Intan'),
        row('70006', '', 'อก.1/3 Cergas'), // religious-only: never auto-created
        row('70007', 'ม.9/1 Nowhere'), // no such grade
      ),
      csv(row('80001', 'ปวช.2/1'), row('80002', 'ปวช. 2 / 1')),
    ),
    now,
  });
  expect(out.status).toBe('success');
  expect(out.counts.general.created).toBe(3);
  expect(out.counts.vocational.created).toBe(1);

  const created = (await allClasses()).map((c) => ({
    track: c.track,
    gradeCode: c.gradeCode,
    gradeLabel: c.gradeLabel,
    rankGroup: c.rankGroup,
    roomNo: c.roomNo,
    name: c.name,
    displayName: c.displayName,
  }));
  expect(created).toEqual(
    expect.arrayContaining([
      {
        track: 'general',
        gradeCode: 'M1',
        gradeLabel: 'ม.1',
        rankGroup: 'ม.1',
        roomNo: 1,
        name: 'Amanah',
        displayName: 'ม.1 Amanah',
      },
      {
        track: 'general',
        gradeCode: 'M1',
        gradeLabel: 'ม.1',
        rankGroup: 'ม.1',
        roomNo: 6,
        name: 'Ikhlas',
        displayName: 'ม.1 Ikhlas',
      },
      {
        track: 'general',
        gradeCode: 'M4',
        gradeLabel: 'ม.4',
        rankGroup: 'ม.4',
        roomNo: 1,
        name: 'Intan',
        displayName: 'ม.4 Intan',
      },
      {
        track: 'vocational',
        gradeCode: 'VOC2',
        gradeLabel: 'ปวช.2',
        rankGroup: 'ปวช.',
        roomNo: 1,
        name: 'ปวช.2/1',
        displayName: 'ปวช.2/1',
      },
    ]),
  );
  expect(created).toHaveLength(4);

  const [s1, s2, s3, s4, s6, s7, v1, v2] = await Promise.all(
    ['70001', '70002', '70003', '70004', '70006', '70007', '80001', '80002'].map(student),
  );
  expect(s1!.homeClassId).toBe(s2!.homeClassId);
  expect(s3!.homeClassId).toBe(s4!.homeClassId);
  expect(v1!.homeClassId).toBe(v2!.homeClassId);
  expect(s1!.status).toBe('active');
  expect(s6).toMatchObject({ status: 'review', reviewReason: 'unknown_class:อก.1/3 Cergas' });
  expect(s7).toMatchObject({ status: 'review' });

  const notes = await db.select().from(notifications).where(eq(notifications.type, 'classes_created'));
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ title: 'sync สร้างห้องเรียนใหม่ 4 ห้อง', link: '/admin/settings/classes' });
  expect(notes[0]!.body).toContain('ม.1 Amanah');
});

test('the next sync reuses the created classes (misspelt rows too) and creates nothing new', async () => {
  const out = await runStudentSync(db, {
    fetcher: fetcher(
      csv(
        row('70001', 'ม.1/1 Amanah'),
        row('70002', 'ม.1/1 Amanah'),
        row('70003', 'ม.1/6 Ikhlas'),
        row('70004', 'ม.1/6 Iklas'),
        row('70005', 'ม.4/1 Intan'),
        row('70006', '', 'อก.1/3 Cergas'),
        row('70007', 'ม.9/1 Nowhere'),
      ),
      csv(row('80001', 'ปวช.2/1'), row('80002', 'ปวช.2/1')),
    ),
    now: new Date(now.getTime() + 86_400_000),
  });
  expect(out.status).toBe('success');
  expect(out.counts.general.created + out.counts.vocational.created).toBe(0);
  expect(await allClasses()).toHaveLength(4);
});
