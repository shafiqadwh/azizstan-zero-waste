/** T15: duties and coverage against PostgreSQL. */
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { auditLogs, notifications } from '../../../db/schema.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { findUserById } from '../repositories/users.repository.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { importDuties, parseDutiesWorkbook, type DutyImportRow } from './duties-import.service.ts';
import { assignDuty, coverageStatus, getCommitteeOverview, removeDuty } from './duty.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { createTerm } from './term.service.ts';
import { createUser, setUserActive } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_duties_${randomBytes(4).toString('hex')}`;
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

let db: Db;
let close: () => Promise<void>;
const meta = { ip: '10.0.0.8', userAgent: 'vitest' };
const now = new Date('2026-11-02T03:00:00Z');
const hour = 3600_000;
let root: SessionUser;
let admin: SessionUser;
let executive: SessionUser;
let teacherId: string;
let teacher2Id: string;
let execId: string;
let term: string;
let amanah: string;
let berdikari: string;
let usaha: string; // not selected for the term
let b1: string;
let b2: string;
let zoneX: string;

const signIn = async (username: string, password: string) =>
  (await login(db, { username, password }, meta, now, { limiter: new LoginRateLimiter() })).user;

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  root = await signIn('root', 'root-password');
  const a = await createUser(db, root, { username: 'adm', displayName: 'แอดมิน', role: 'admin' }, meta, now);
  const e = await createUser(db, root, { username: 'exe', displayName: 'ผู้บริหาร', role: 'executive' }, meta, now);
  const t = await createUser(db, root, { username: 't.kamal', displayName: 'ครูกามัล', role: 'teacher' }, meta, now);
  const t2 = await createUser(db, root, { username: 't.sara', displayName: 'ครูซารา', role: 'teacher' }, meta, now);
  admin = await signIn('adm', a.tempPassword!);
  executive = await signIn('exe', e.tempPassword!);
  execId = executive.id;
  teacherId = t.userId;
  teacher2Id = t2.userId;

  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  b2 = await upsertArea(db, admin, { type: 'building', code: '2', name: 'อาคาร 2' }, meta, now);
  zoneX = await upsertArea(db, admin, { type: 'zone', code: 'X', name: 'โซน X' }, meta, now);
  const r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121' }, meta, now);
  const cls = (roomNo: number, name: string) =>
    upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo, name },
      meta,
      now,
    );
  amanah = await cls(1, 'Amanah');
  berdikari = await cls(2, 'Berdikari');
  usaha = await cls(3, 'Usaha');
  await linkClassRoom(db, admin, { classId: amanah, physicalRoomId: r121, effectiveFrom: '2026-11-01' }, meta, now);
  term = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now); // building mode
  await setTermClasses(db, admin, { termId: term, classIds: [amanah, berdikari] }, meta, now);
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

const committee = (userId: string, targetType: 'class' | 'area', targetId: string, extra = {}) => ({
  termId: term,
  userId,
  duty: 'committee' as const,
  targetType,
  targetId,
  ...extra,
});

describe('assign / remove', () => {
  test('only admins manage duties; executives get 403', async () => {
    await expect(assignDuty(db, executive, committee(teacherId, 'class', amanah), meta, now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('committee duty on a selected class; notifies the user; duplicate refused', async () => {
    const out = await assignDuty(db, admin, committee(teacherId, 'class', amanah), meta, now);
    expect(out.created).toBe(true);
    const inbox = await db.select().from(notifications).where(eq(notifications.userId, teacherId));
    expect(inbox).toMatchObject([
      { type: 'duty_assigned', title: 'ได้รับมอบหมายเป็นกรรมการประเมิน', body: '1 รายการ ภาคเรียนที่ 2/2569' },
    ]);
    await expect(assignDuty(db, admin, committee(teacherId, 'class', amanah), meta, now)).rejects.toMatchObject({
      message: 'มอบหมายหน้าที่นี้ให้ผู้ใช้คนนี้แล้ว',
    });
  });

  test('an unselected class, the wrong area type and a missing target are refused (FR-P7)', async () => {
    await expect(assignDuty(db, admin, committee(teacherId, 'class', usaha), meta, now)).rejects.toMatchObject({
      message: 'ห้องเรียนนี้ไม่ได้ใช้ในภาคเรียนนี้',
    });
    await expect(assignDuty(db, admin, committee(teacherId, 'area', zoneX), meta, now)).rejects.toMatchObject({
      message: 'ภาคเรียนนี้ประเมินแบบอาคาร เลือกอาคารแทน',
    });
    await expect(
      assignDuty(db, admin, { termId: term, userId: teacherId, duty: 'committee' }, meta, now),
    ).rejects.toMatchObject({ field: 'targetId' });
  });

  test('any role can be committee (FR-U6); approvers must be admins', async () => {
    await assignDuty(db, admin, committee(execId, 'area', b1), meta, now);
    await expect(
      assignDuty(db, admin, { termId: term, userId: teacherId, duty: 'approver' }, meta, now),
    ).rejects.toMatchObject({ message: 'ผู้อนุมัติต้องเป็นผู้ดูแลระบบ' });
    await assignDuty(db, admin, { termId: term, userId: admin.id, duty: 'approver' }, meta, now);
  });

  test('a disabled teacher is enabled by a duty; a disabled executive is not', async () => {
    await setUserActive(db, root, { userId: teacher2Id, active: false }, meta, now);
    const out = await assignDuty(db, admin, committee(teacher2Id, 'class', berdikari), meta, now);
    expect(out.enabledUser).toBe(true);
    expect((await findUserById(db, teacher2Id))?.isActive).toBe(true);
    await setUserActive(db, root, { userId: execId, active: false }, meta, now);
    await expect(assignDuty(db, admin, committee(execId, 'area', b2), meta, now)).rejects.toMatchObject({
      message: 'บัญชีนี้ถูกปิดใช้งาน ให้ผู้ดูแลระบบสูงสุดเปิดก่อน',
    });
    await setUserActive(db, root, { userId: execId, active: true }, meta, now);
  });

  test('freelance needs a future expiry and stops counting after it (BR-P1)', async () => {
    await expect(
      assignDuty(db, admin, committee(teacherId, 'area', b2, { isFreelance: true }), meta, now),
    ).rejects.toMatchObject({ message: 'มอบหมายชั่วคราวต้องกำหนดวันหมดอายุในอนาคต' });
    await assignDuty(
      db,
      admin,
      committee(teacherId, 'area', b2, { isFreelance: true, validUntil: new Date(now.getTime() + 2 * hour) }),
      meta,
      now,
    );
    const during = await getCommitteeOverview(db, admin, term, now);
    const b2Now = during.groups.flatMap((g) => g.targets).find((t) => t.id === b2)!;
    expect(b2Now.committee).toMatchObject([{ displayName: 'ครูกามัล', isFreelance: true }]);
    const later = await getCommitteeOverview(db, admin, term, new Date(now.getTime() + 3 * hour));
    expect(later.groups.flatMap((g) => g.targets).find((t) => t.id === b2)!.status).toBe('none');
    expect(later.expired).toMatchObject([{ displayName: 'ครูกามัล', target: 'อาคาร 2' }]);
  });

  test('remove deletes the duty and writes an audit row', async () => {
    const out = await assignDuty(db, admin, committee(execId, 'class', amanah), meta, now);
    await removeDuty(db, admin, { dutyId: out.id }, meta, now);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, out.id));
    expect(audit.map((a) => a.action).sort()).toEqual(['duty.assign', 'duty.remove']);
    await expect(removeDuty(db, admin, { dutyId: out.id }, meta, now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('coverage', () => {
  test('selected classes and term areas with 0 / 1 / 2+ committee members', async () => {
    await assignDuty(db, admin, committee(teacher2Id, 'class', amanah), meta, now); // amanah: 2 members
    const o = await getCommitteeOverview(db, executive, term, now);
    const byId = new Map(o.groups.flatMap((g) => g.targets).map((t) => [t.id, t]));
    expect(o.groups.map((g) => g.title)).toEqual(['ม.1', 'อาคาร']);
    expect(byId.has(usaha)).toBe(false); // unselected → not a target (FR-P7)
    expect(byId.has(zoneX)).toBe(false); // building mode → zones are not targets
    expect(byId.get(amanah)).toMatchObject({ status: 'multiple', roomNumber: '121' });
    expect(byId.get(berdikari)!.status).toBe('ok');
    expect(byId.get(b1)!.status).toBe('ok');
    expect(byId.get(b2)).toMatchObject({ status: 'ok', committee: [{ isFreelance: true }] }); // freelance in force
    expect(o.counts).toEqual({ targets: 4, none: 0, multiple: 1 });
    expect(o.generalApprovers.map((a) => a.userId)).toEqual([admin.id]);
    expect(o.users.find((u) => u.id === teacherId)).toMatchObject({ committeeCount: 2 });
  });

  test('coverageStatus', () => {
    expect([0, 1, 2, 3].map(coverageStatus)).toEqual(['none', 'ok', 'multiple', 'multiple']);
  });
});

async function workbook(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('duties');
  ws.addRow(['username', 'ชื่อ', 'หน้าที่', 'ประเภทเป้าหมาย', 'เป้าหมาย']);
  rows.forEach((r) => ws.addRow(r));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('duties.xlsx', () => {
  test('dry-run lists unknown usernames and targets and saves nothing', async () => {
    const rows = await parseDutiesWorkbook(
      await workbook([
        ['t.nobody', '', 'committee', 'ห้อง', '121'],
        ['t.sara', '', 'committee', 'อาคาร', '9'],
        ['t.sara', '', 'committee', 'ห้อง', 'ม.1 Usaha'],
        ['t.sara', '', 'กรรมการ', 'อาคาร', '2'],
        ['t.sara', '', 'committee', 'อาคาร', '2'],
      ]),
    );
    const report = await importDuties(db, admin, term, rows, { commit: false }, meta, now);
    expect(report.committed).toBe(false);
    expect(report.rows.map((r) => r.error)).toEqual([
      'ไม่พบผู้ใช้ "t.nobody"',
      'ไม่พบเป้าหมาย "9"',
      'ห้องเรียนนี้ไม่ได้ใช้ในภาคเรียนนี้',
      null,
      'ซ้ำกับแถว 5',
    ]);
    expect(report.summary.errors).toBe(4);
    const o = await getCommitteeOverview(db, admin, term, now);
    const b2Now = o.groups.flatMap((g) => g.targets).find((t) => t.id === b2)!;
    expect(b2Now.committee.map((h) => h.userId)).toEqual([teacherId]); // t.sara not added
  });

  test('commit: room number or class name, existing rows are no-ops, uncovered targets reported', async () => {
    const rows: DutyImportRow[] = await parseDutiesWorkbook(
      await workbook([
        ['t.kamal', 'ครูกามัล', 'committee', 'ห้อง', '121'], // already assigned via the form
        ['T.Sara', '', 'committee', 'ห้อง', 'ม.1 Berdikari'], // already assigned
        ['exe', '', 'committee', 'อาคาร', '2'],
        ['adm', '', 'approver', '', ''],
      ]),
    );
    const dry = await importDuties(db, admin, term, rows, { commit: false }, meta, now);
    expect(dry.summary).toEqual({ created: 1, existing: 3, enabledUsers: 0, errors: 0 });
    expect(dry.uncovered).toEqual([]);
    const done = await importDuties(db, admin, term, rows, { commit: true }, meta, now);
    expect(done.committed).toBe(true);
    const o = await getCommitteeOverview(db, admin, term, now);
    expect(o.counts.none).toBe(0);
    const inbox = await db.select().from(notifications).where(eq(notifications.userId, execId));
    expect(inbox.at(-1)?.body).toBe('2 รายการ ภาคเรียนที่ 2/2569');
  });

  test('uncovered targets appear in the report', async () => {
    const o = await getCommitteeOverview(db, admin, term, now);
    for (const h of o.groups.flatMap((g) => g.targets).find((t) => t.id === b2)!.committee)
      await removeDuty(db, admin, { dutyId: h.dutyId }, meta, now);
    const rows = await parseDutiesWorkbook(await workbook([['adm', '', 'approver', '', '']]));
    const report = await importDuties(db, admin, term, rows, { commit: false }, meta, now);
    expect(report.uncovered).toEqual(['อาคาร 2']);
  });

  test('missing header is a Thai validation error', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['username', 'หน้าที่']);
    await expect(parseDutiesWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer)).rejects.toMatchObject({
      message: 'ไม่พบคอลัมน์ "ประเภทเป้าหมาย" ในแถวแรก',
    });
  });
});
