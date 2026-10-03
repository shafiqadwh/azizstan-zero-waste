/** T16: round jobs (BR-R1, BR-R2, BR-R4, T-R1) against PostgreSQL. */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { auditLogs, notifications, rosterSnapshots, rounds, students, termClassZones } from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import * as roundsRepo from '../repositories/rounds.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import {
  closeRound,
  editRoundClassArea,
  getRoundAreas,
  openRound,
  ROUND_CLOSE_QUEUE,
  ROUND_OPEN_QUEUE,
  sweepRounds,
} from './round.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_rounds_${randomBytes(4).toString('hex')}`;
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
const meta = { ip: '10.0.0.9', userAgent: 'vitest' };
const setupAt = new Date('2026-11-01T03:00:00Z');
const opensAt = new Date('2026-11-05T01:00:00Z'); // 08:00 Bangkok
const closesAt = new Date('2026-11-09T09:30:00Z'); // 16:30 Bangkok
const hour = 3600_000;
let admin: SessionUser;
let executive: SessionUser;
let teacherId: string;
let term: string;
let draftTerm: string;
let round1: string;
let round2: string;
let draftRound: string;
let b1: string;
let b2: string;
let zoneA: string;
let r1: string;
let r2: string;
let r3: string;
let amanah: string; // room in b1, then moves to b2 after the round opened
let berdikari: string; // room in b2
let usaha: string; // not selected for the term
let dedikasi: string; // selected, no room → "ไม่มีพื้นที่"

const signIn = async (username: string, password: string) =>
  (await login(db, { username, password }, meta, setupAt, { limiter: new LoginRateLimiter() })).user;

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, setupAt);
  const root = await signIn('root', 'root-password');
  const a = await createUser(db, root, { username: 'adm', displayName: 'แอดมิน', role: 'admin' }, meta, setupAt);
  const e = await createUser(db, root, { username: 'exe', displayName: 'ผู้บริหาร', role: 'executive' }, meta, setupAt);
  teacherId = (await createUser(db, root, { username: 't.one', displayName: 'ครู', role: 'teacher' }, meta, setupAt))
    .userId;
  admin = await signIn('adm', a.tempPassword!);
  executive = await signIn('exe', e.tempPassword!);

  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, setupAt);
  b2 = await upsertArea(db, admin, { type: 'building', code: '2', name: 'อาคาร 2' }, meta, setupAt);
  zoneA = await upsertArea(db, admin, { type: 'zone', code: 'A', name: 'โซน A' }, meta, setupAt);
  r1 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121' }, meta, setupAt);
  r2 = await upsertPhysicalRoom(db, admin, { buildingId: b2, roomNumber: '221' }, meta, setupAt);
  r3 = await upsertPhysicalRoom(db, admin, { buildingId: b2, roomNumber: '222' }, meta, setupAt);
  const cls = (roomNo: number, name: string) =>
    upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo, name },
      meta,
      setupAt,
    );
  amanah = await cls(1, 'Amanah');
  berdikari = await cls(2, 'Berdikari');
  usaha = await cls(3, 'Usaha');
  dedikasi = await cls(4, 'Dedikasi');
  await linkClassRoom(db, admin, { classId: amanah, physicalRoomId: r1, effectiveFrom: '2026-11-01' }, meta, setupAt);
  await linkClassRoom(
    db,
    admin,
    { classId: berdikari, physicalRoomId: r2, effectiveFrom: '2026-11-01' },
    meta,
    setupAt,
  );

  term = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, setupAt); // building mode
  // building mode: each class's building comes from the term selection; dedikasi has none
  await setTermClasses(
    db,
    admin,
    {
      termId: term,
      classIds: [amanah, berdikari, dedikasi],
      areas: [
        { classId: amanah, areaId: b1 },
        { classId: berdikari, areaId: b2 },
      ],
    },
    meta,
    setupAt,
  );
  await activateTerm(db, admin, { termId: term }, meta, setupAt);
  draftTerm = await createTerm(db, admin, { academicYear: 2570, termNo: 1 }, meta, setupAt);
  [round1, round2, draftRound] = [newId(), newId(), newId()];
  await termsRepo.insertRounds(db, [
    { id: round1, termId: term, roundNo: 1, opensAt, closesAt },
    {
      id: round2,
      termId: term,
      roundNo: 2,
      opensAt: new Date(opensAt.getTime() + 30 * 24 * hour),
      closesAt: new Date(closesAt.getTime() + 30 * 24 * hour),
    },
    { id: draftRound, termId: draftTerm, roundNo: 1, opensAt, closesAt },
  ]);
  await assignDuty(
    db,
    admin,
    { termId: term, userId: teacherId, duty: 'committee', targetType: 'class', targetId: amanah },
    meta,
    setupAt,
  );
  const student = (code: string, homeClassId: string, status: 'active' | 'inactive' = 'active') => ({
    id: newId(),
    studentCode: code,
    fullName: `นักเรียนทดสอบ ${code}`,
    homeClassId,
    status,
    deleteAfter: '2027-11-01',
  });
  await db
    .insert(students)
    .values([
      student('S1', amanah),
      student('S2', amanah),
      student('S3', berdikari),
      student('S4', usaha),
      student('S5', berdikari, 'inactive'),
    ]);
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

const frozen = async (roundId: string) =>
  (await roundsRepo.listRoundClassAreas(db, roundId))
    .map((r) => ({ classId: r.classId, areaId: r.areaId, physicalRoomId: r.physicalRoomId }))
    .sort((x, y) => x.classId.localeCompare(y.classId));

describe('round.open (BR-R1)', () => {
  test('nothing happens before opens_at, and never for a draft term', async () => {
    expect(await openRound(db, round1, new Date(opensAt.getTime() - 1000))).toEqual({ changed: false });
    expect(await openRound(db, draftRound, new Date(opensAt.getTime() + hour))).toEqual({ changed: false });
  });

  test('freezes each class’s building from the term selection (and its room, if linked); snapshots active students', async () => {
    const out = await openRound(db, round1, new Date(opensAt.getTime() + 60_000));
    expect(out).toEqual({ changed: true, classes: 2, missingArea: [dedikasi], students: 3 });
    expect(await frozen(round1)).toEqual(
      [
        { classId: amanah, areaId: b1, physicalRoomId: r1 },
        { classId: berdikari, areaId: b2, physicalRoomId: r2 },
      ].sort((x, y) => x.classId.localeCompare(y.classId)),
    );
    const roster = await db.select().from(rosterSnapshots).where(eq(rosterSnapshots.roundId, round1));
    expect(roster.map((r) => r.classId).sort()).toEqual([amanah, amanah, berdikari].sort()); // no usaha, no inactive
    const [r] = await db.select().from(rounds).where(eq(rounds.id, round1));
    expect(r?.status).toBe('open');
  });

  test('committee members are notified', async () => {
    const inbox = await db.select().from(notifications).where(eq(notifications.type, 'round_opened'));
    expect(inbox).toMatchObject([
      {
        userId: teacherId,
        title: 'เปิดลงคะแนนรอบที่ 1 แล้ว',
        body: 'ลงคะแนนได้ถึง 9 พ.ย. 2569 16:30 น.',
        link: '/tasks',
      },
    ]);
  });

  test('T-R1: a later change of building or room does not change the frozen row', async () => {
    await db
      .update(termClassZones)
      .set({ areaId: b2 })
      .where(and(eq(termClassZones.termId, term), eq(termClassZones.classId, amanah)));
    await linkClassRoom(
      db,
      admin,
      { classId: amanah, physicalRoomId: r3, effectiveFrom: '2026-11-06' },
      meta,
      new Date('2026-11-06T02:00:00Z'),
    );
    expect((await frozen(round1)).find((r) => r.classId === amanah)).toMatchObject({ areaId: b1, physicalRoomId: r1 });
    // back to building 1: the term selection is not dated, so a re-run of the open below would pick up the change
    await db
      .update(termClassZones)
      .set({ areaId: b1 })
      .where(and(eq(termClassZones.termId, term), eq(termClassZones.classId, amanah)));
  });

  test('idempotent: running again changes nothing; re-running from scheduled gives the same rows', async () => {
    const before = await frozen(round1);
    const audits = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, round1))).length;
    expect(await openRound(db, round1, new Date(opensAt.getTime() + 2 * hour))).toEqual({ changed: false });
    expect(await frozen(round1)).toEqual(before);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, round1))).length).toBe(audits);

    // a retry after a crash between steps: rows depend on opens_at, not on when the job runs
    await db.update(rounds).set({ status: 'scheduled' }).where(eq(rounds.id, round1));
    await openRound(db, round1, new Date(opensAt.getTime() + 48 * hour));
    expect(await frozen(round1)).toEqual(before);
    expect(await roundsRepo.countRosterSnapshots(db, round1)).toBe(3);
  });
});

describe('round.close (BR-R2) and the sweep', () => {
  test('closes only after closes_at; twice is a no-op', async () => {
    expect(await closeRound(db, round1, new Date(closesAt.getTime() - 1000))).toEqual({ changed: false });
    expect(await closeRound(db, round1, closesAt)).toEqual({ changed: true });
    expect(await closeRound(db, round1, new Date(closesAt.getTime() + hour))).toEqual({ changed: false });
  });

  test('sweep enqueues due rounds of the active term only and follows date changes', async () => {
    const sent: [string, string][] = [];
    const enqueue = async (q: string, id: string) => void sent.push([q, id]);
    const r2Open = new Date(opensAt.getTime() + 30 * 24 * hour);
    expect(await sweepRounds(db, new Date(r2Open.getTime() - 1000), enqueue)).toEqual({ open: 0, close: 0 });
    // admin moves round 2 earlier (BR-R5 while scheduled) → the next sweep picks it up
    await termsRepo.updateRound(db, round2, { opensAt: new Date(r2Open.getTime() - 2 * 24 * hour) });
    expect(await sweepRounds(db, new Date(r2Open.getTime() - 1000), enqueue)).toEqual({ open: 1, close: 0 });
    expect(sent).toEqual([[ROUND_OPEN_QUEUE, round2]]); // draft term's round never enqueued
    await openRound(db, round2, new Date(r2Open.getTime() - 1000));
    sent.length = 0;
    const after = new Date(closesAt.getTime() + 31 * 24 * hour);
    await sweepRounds(db, after, enqueue);
    expect(sent).toEqual([[ROUND_CLOSE_QUEUE, round2]]);
  });
});

describe('admin edit of round_class_areas (BR-R4)', () => {
  test('lists every selected class with its frozen area; missing ones counted', async () => {
    const view = await getRoundAreas(db, executive, round1);
    expect(view.rows.map((r) => r.classId).sort()).toEqual([amanah, berdikari, dedikasi].sort());
    expect(view.rows.find((r) => r.classId === dedikasi)?.areaId).toBeNull();
    expect(view.missing).toBe(1);
    expect(view.editable).toBe(false); // executive
    expect(view.areas.map((a) => a.name)).toEqual(['อาคาร 1', 'อาคาร 2']);
    expect((await getRoundAreas(db, admin, round1)).editable).toBe(true);
  });

  test('admin sets the missing area and corrects a class; rules enforced', async () => {
    const at = new Date(closesAt.getTime() + 2 * hour);
    await expect(
      editRoundClassArea(db, executive, { roundId: round1, classId: dedikasi, areaId: b1 }, meta, at),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await editRoundClassArea(db, admin, { roundId: round1, classId: dedikasi, areaId: b1 }, meta, at);
    await editRoundClassArea(db, admin, { roundId: round1, classId: amanah, areaId: b2 }, meta, at);
    const rows = await frozen(round1);
    expect(rows.find((r) => r.classId === dedikasi)).toMatchObject({ areaId: b1, physicalRoomId: null });
    expect(rows.find((r) => r.classId === amanah)).toMatchObject({ areaId: b2, physicalRoomId: r1 });
    const audit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, `${round1}:${amanah}`));
    expect(audit).toHaveLength(1);

    await expect(
      editRoundClassArea(db, admin, { roundId: round1, classId: amanah, areaId: zoneA }, meta, at),
    ).rejects.toMatchObject({ message: 'เลือกพื้นที่ตามรูปแบบการประเมินของภาคเรียนนี้' });
    await expect(
      editRoundClassArea(db, admin, { roundId: round1, classId: usaha, areaId: b1 }, meta, at),
    ).rejects.toMatchObject({ message: 'ห้องเรียนนี้ไม่ได้ใช้ในภาคเรียนนี้' });
    await expect(
      editRoundClassArea(db, admin, { roundId: draftRound, classId: amanah, areaId: b1 }, meta, at),
    ).rejects.toMatchObject({ message: 'รอบนี้ยังไม่เปิด ระบบจะกำหนดพื้นที่ให้เมื่อเปิดรอบ' });
    await db.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, round1));
    await expect(
      editRoundClassArea(db, admin, { roundId: round1, classId: amanah, areaId: b1 }, meta, at),
    ).rejects.toMatchObject({ message: 'รอบนี้ปิดรอบแล้ว แก้ไม่ได้' });
  });
});
