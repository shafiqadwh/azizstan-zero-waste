/** T25: student sync (BR-Y) against PostgreSQL with synthetic CSV fixtures — never real student data. */
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { notifications, students, syncRuns } from '../../../db/schema.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { addClassAlias, upsertClass } from './place.service.ts';
import {
  addSkipRule,
  getStudentsOverview,
  removeSkipRule,
  runStudentSync,
  STUDENT_MSG,
  type StudentFetcher,
} from './student.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_stu_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-11-18T19:00:00Z'); // 02:00 Bangkok
const meta = { ip: '10.0.0.26', userAgent: 'vitest' };
const HEADER =
  'รหัสนักเรียน,ชื่อ-สกุลนักเรียน,ชั้นสามัญ,ชั้นศาสนา,เพศ,เลขประจำตัวประชาชน,วันเดือนปีเกิด,จังหวัด,ชื่อ-สกุลผู้ปกครอง,เบอร์ติดต่อผู้ปกครอง,ชื่อ-สกุลผู้ประสานงาน';
/** A well-formed synthetic row (fake 13-digit ID, fake phone) — the parser must drop all but 4 columns. */
const row = (code: string, name: string, general: string, religious = '') =>
  `${code},${name},${general},${religious},ชาย,1${code.padStart(12, '0')},01/01/2555,ปัตตานี,ผู้ปกครองสมมติ,0810000000,ผู้ประสานงานสมมติ`;
const csv = (...rows: string[]) => `﻿${[HEADER, ...rows].join('\r\n')}\r\n`;
const fetcher =
  (general: string, vocational = csv()): StudentFetcher =>
  async (source) =>
    source === 'general' ? general : vocational;

let db: Db;
let close: () => Promise<void>;
let dataDir: string;
let admin: SessionUser;
let executive: SessionUser;
let A: string;
let B: string;
const bulk = Array.from({ length: 16 }, (_, i) =>
  row(`66${String(i).padStart(3, '0')}`, `สมมติ ${i}`, 'ม.1/2 Berdikari'),
);

const byCode = async (code: string) => (await db.select().from(students).where(eq(students.studentCode, code)))[0];

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'zw-stu-'));
  process.env.DATA_DIR = dataDir;
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  const su = await signIn('root', 'root-password');
  const mk = async (username: string, role: 'admin' | 'executive') => {
    const u = await createUser(db, su, { username, displayName: username, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'admin');
  executive = await mk('exe', 'executive');
  const cls = (track: 'general' | 'vocational', gradeCode: string, gradeLabel: string, roomNo: number, name: string) =>
    upsertClass(db, admin, { track, gradeCode, gradeLabel, rankGroup: gradeLabel, roomNo, name }, meta, now);
  A = await cls('general', 'M1', 'ม.1', 1, 'Amanah');
  B = await cls('general', 'M1', 'ม.1', 2, 'Berdikari');
  const V = await cls('vocational', 'VOC2', 'ปวช.2', 1, 'ปวช.2/1');
  await addClassAlias(db, admin, { classId: V, alias: 'ปวช.2/1' }, meta, now);
  const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await rm(dataDir, { recursive: true, force: true });
});

describe('student sync (BR-Y)', () => {
  test('T-Y1 / T-Y3 / T-Y5: messy rows parse; unknown class → review; มุตะวัซซิต religious-only rows are skipped silently', async () => {
    const general = [
      HEADER,
      // (a) line break inside the province
      '65001,ด.ช.สมมติ หนึ่ง,ม.1/1 Amanah,PR 1/1 Amanah,ชาย,1111111111111,01/01/2555,ปัตตา',
      'นี,ผู้ปกครอง,0811111111,ผู้ประสานงาน',
      // (b) unquoted comma between two phone numbers
      '65002,ด.ญ.สมมติ สอง,ม .1/2  Berdikari,,หญิง,2222222222222,,ยะลา,ผู้ปกครอง,0812222222,0813333333,ผู้ประสานงาน',
      // (c) empty cells; religious-only class nobody mapped yet → review (T-Y3)
      '65003,ด.ช.สมมติ สาม,,อก.1/3 Cergas,,,,,,,',
      // T-Y5: religious-only มุตะวัซซิต rows → skipped silently
      row('65010', 'ด.ช.สมมติ ข้าม', '', '1M Al-Taqwa'),
      row('65011', 'ด.ญ.สมมติ ข้าม', '', 'มุตะวัซซิต ปี 1 Al-Hikmah'),
      // …but the same religious string next to a general class is ignored and the student is imported
      row('65012', 'ด.ช.สมมติ สิบสอง', 'ม.1/1 Amanah', 'มุตะวัซซิต ปี 1 Al-Hikmah'),
      // malformed beyond repair
      '65099,ด.ช.สมมติ เสีย',
      ...bulk,
    ].join('\n');
    const out = await runStudentSync(db, {
      fetcher: fetcher(general, csv(row('67001', 'นาย สมมติ ปวช', 'ปวช.2/1'))),
      now,
    });
    expect(out.status).toBe('success');
    expect(out.counts.general).toMatchObject({ added: 19, review: 1, skipped: 2, malformed: 1, inactive: 0 });
    expect(out.counts.vocational).toMatchObject({ rows: 1, added: 1 });
    expect(out.malformed).toEqual(['65099']);
    expect(await byCode('65001')).toMatchObject({
      status: 'active',
      generalClassId: A,
      homeClassId: A,
      religiousClassId: null,
    });
    expect(await byCode('65002')).toMatchObject({ status: 'active', homeClassId: B });
    expect(await byCode('65003')).toMatchObject({
      status: 'review',
      reviewReason: 'unknown_class:อก.1/3 Cergas',
      homeClassId: null,
    });
    expect(await byCode('65010')).toBeUndefined();
    expect(await byCode('65011')).toBeUndefined();
    expect(await byCode('65012')).toMatchObject({ status: 'active', homeClassId: A });
    expect((await byCode('67001'))?.status).toBe('active');
    // skipped is a plain count: nobody is notified, nothing goes to review
    expect(await db.select().from(notifications).where(eq(notifications.type, 'sync_problem'))).toEqual([]);
    expect(JSON.stringify(out.changes)).not.toContain('สมมติ'); // codes and class names only
  });

  test('T-Y4: no 13-digit national ID anywhere in the database after a sync', async () => {
    const c = new pg.Client({ connectionString: withDb(dbName) });
    await c.connect();
    try {
      const { rows: cols } = await c.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json')`,
      );
      for (const col of cols) {
        const { rows } = await c.query(
          // a national ID is a standalone 13-digit number; hex digests (session ids, sha256) contain digit runs
          `SELECT 1 FROM "${col.table_name}" WHERE "${col.column_name}"::text ~ '(^|[^0-9A-Za-z])[0-9]{13}($|[^0-9A-Za-z])' LIMIT 1`,
        );
        expect(rows, `${col.table_name}.${col.column_name}`).toEqual([]);
      }
    } finally {
      await c.end();
    }
  });

  test('moves and renames are applied and listed by code; absent students become inactive', async () => {
    const general = csv(
      row('65001', 'ด.ช.สมมติ หนึ่ง', 'ม.1/2 Berdikari'), // moved
      row('65002', 'ด.ญ.สมมติ สอง (เปลี่ยนชื่อ)', 'ม.1/2 Berdikari'), // renamed
      row('65003', 'ด.ช.สมมติ สาม', '', 'อก.1/3 Cergas'),
      row('65012', 'ด.ช.สมมติ สิบสอง', 'ม.1/1 Amanah'),
      ...bulk.slice(0, 15), // one of the 16 is gone (1 of 19 active ≈ 5 % < 10 %)
    );
    const out = await runStudentSync(db, {
      fetcher: fetcher(general, csv(row('67001', 'นาย สมมติ ปวช', 'ปวช.2/1'))),
      now,
    });
    expect(out.status).toBe('success');
    expect(out.counts.general).toMatchObject({ moved: 1, renamed: 1, inactive: 1 });
    expect(out.changes).toEqual(
      expect.arrayContaining([
        { code: '65001', change: 'moved', from: 'ม.1 Amanah', to: 'ม.1 Berdikari' },
        { code: '65002', change: 'renamed' },
        { code: '66015', change: 'inactive' },
      ]),
    );
    expect((await byCode('66015'))?.status).toBe('inactive');
    expect(JSON.stringify(await db.select().from(syncRuns))).not.toMatch(/สมมติ|\d{13}/);
  });

  test('T-Y2: 15 % missing → aborted, DB unchanged, admins notified', async () => {
    const before = await db.select().from(students);
    const general = csv(
      row('65001', 'ด.ช.สมมติ หนึ่ง', 'ม.1/2 Berdikari'),
      row('65002', 'ด.ญ.สมมติ สอง (เปลี่ยนชื่อ)', 'ม.1/2 Berdikari'),
      row('65012', 'ด.ช.สมมติ สิบสอง', 'ม.1/1 Amanah'),
      ...bulk.slice(0, 12), // 3 of the 15 bulk students missing → 3 / 19 active ≈ 16 %
      row('65001', 'ซ้ำ', 'ม.1/1 Amanah'), // a duplicate would go to review — but nothing is applied
    );
    const out = await runStudentSync(db, {
      fetcher: fetcher(general, csv(row('67001', 'นาย สมมติ ปวช', 'ปวช.2/1'))),
      now,
    });
    expect(out.status).toBe('aborted');
    expect(await db.select().from(students)).toEqual(before);
    const notes = await db.select().from(notifications).where(eq(notifications.type, 'sync_problem'));
    expect(notes.map((n) => n.title)).toContain('Sync รายชื่อหยุดอัตโนมัติ');
  });

  test('a failed fetch changes nothing and is recorded without the URL or token', async () => {
    const before = await db.select().from(students);
    const out = await runStudentSync(db, {
      fetcher: async () => {
        throw new Error('ExportVoc: HTTP 502');
      },
      now,
    });
    expect(out).toMatchObject({ status: 'failed', error: 'ExportVoc: HTTP 502' });
    expect(await db.select().from(students)).toEqual(before);
  });

  test('the raw CSV never touches the disk (DATA_DIR stays empty)', async () => {
    expect(await readdir(dataDir)).toEqual([]);
  });
});

describe('/admin/settings/students', () => {
  test('review list shows codes and class strings only; skip rules can be added and removed by admins', async () => {
    const o = await getStudentsOverview(db, executive);
    expect(o.review).toEqual([
      expect.objectContaining({ code: '65003', classString: 'อก.1/3 Cergas', reason: 'unknown_class:อก.1/3 Cergas' }),
    ]);
    expect(JSON.stringify(o)).not.toContain('สมมติ');
    expect(o.skipRules.map((r) => r.prefix)).toEqual(expect.arrayContaining(['มุตะวัซซิต', '1M ']));
    expect(o.runs.map((r) => r.status)).toEqual(expect.arrayContaining(['success', 'aborted', 'failed']));

    await expect(addSkipRule(db, executive, { prefix: 'X' }, meta, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const id = await addSkipRule(db, admin, { prefix: 'อก.1' }, meta, now);
    await expect(addSkipRule(db, admin, { prefix: 'อก.1' }, meta, now)).rejects.toMatchObject({
      message: STUDENT_MSG.prefixTaken,
    });
    await removeSkipRule(db, admin, id, meta, now);
    expect((await getStudentsOverview(db, admin)).skipRules.map((r) => r.prefix)).not.toContain('อก.1');
  });

  test('mapping the unknown class (an alias) and re-running resolves the review', async () => {
    const C = await upsertClass(
      db,
      admin,
      { track: 'religious', gradeCode: 'REL1', gradeLabel: 'อก.1', rankGroup: 'อก.1', roomNo: 3, name: 'Cergas' },
      meta,
      now,
    );
    await addClassAlias(db, admin, { classId: C, alias: 'อก.1/3 Cergas' }, meta, now);
    const general = csv(
      row('65001', 'ด.ช.สมมติ หนึ่ง', 'ม.1/2 Berdikari'),
      row('65002', 'ด.ญ.สมมติ สอง (เปลี่ยนชื่อ)', 'ม.1/2 Berdikari'),
      row('65003', 'ด.ช.สมมติ สาม', '', 'อก.1/3 Cergas'),
      row('65012', 'ด.ช.สมมติ สิบสอง', 'ม.1/1 Amanah'),
      ...bulk.slice(0, 15),
    );
    const out = await runStudentSync(db, {
      fetcher: fetcher(general, csv(row('67001', 'นาย สมมติ ปวช', 'ปวช.2/1'))),
      now,
    });
    expect(out.status).toBe('success');
    expect(await byCode('65003')).toMatchObject({ status: 'active', religiousClassId: C, homeClassId: C });
  });
});
