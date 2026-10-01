/** T23: admin dashboard and approval cards against PostgreSQL. */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import {
  auditLogs,
  evaluations,
  evidence,
  notifications,
  roundClassAreas,
  rounds,
  scoreComponents,
} from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { DASHBOARD_MSG, getDashboard, listWaitingResults, remindPendingCommittees } from './dashboard.service.ts';
import { assignDuty } from './duty.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_dash_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-11-21T03:00:00Z'); // the day after round 1 closed
const meta = { ip: '10.0.0.23', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let su: SessionUser;
let admin: SessionUser;
let approver: SessionUser;
let executive: SessionUser;
let t1: SessionUser;
let t2: SessionUser;
let termId: string;
let roundId: string;
let A: string;
let B: string;
let b1: string;
let evalB: string;

async function evaluation(classId: string, status: 'approved' | 'submitted', room: string) {
  const id = newId();
  const comps = await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId));
  await db.insert(evaluations).values({
    id,
    roundId,
    componentId: comps.find((c) => c.key === 'room')!.id,
    targetType: 'class',
    targetClassId: classId,
    ownerId: t1.id,
    score: '4.500',
    comment: 'ห้องสะอาด',
    roomNumberAtEval: room,
    status,
    firstSubmittedAt: now,
    selfEditUntil: now,
    lastEditedAt: now,
    approvedBy: status === 'approved' ? admin.id : null,
  });
  for (const [i, kind] of (['signature', 'site', 'site'] as const).entries()) {
    await db.insert(evidence).values({
      id: newId(),
      evaluationId: id,
      uploadedBy: t1.id,
      kind,
      filePath: 'uploads/00/x.webp',
      sha256: newId(),
      width: 10,
      height: 10,
      bytes: 10,
      capturedAt: now,
      sortOrder: i,
    });
  }
  return id;
}

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  su = await signIn('root', 'root-password');
  const mk = async (username: string, displayName: string, role: 'admin' | 'teacher' | 'executive') => {
    const u = await createUser(db, su, { username, displayName, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'แอดมิน', 'admin');
  approver = await mk('adm2', 'แอดมินสอง', 'admin');
  executive = await mk('exe', 'ผู้บริหาร', 'executive');
  t1 = await mk('t.one', 'ครูหนึ่ง', 'teacher');
  t2 = await mk('t.two', 'ครูสอง', 'teacher');
  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  const r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121', floor: 2 }, meta, now);
  const r122 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '122', floor: 2 }, meta, now);
  const cls = (roomNo: number, name: string) =>
    upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo, name },
      meta,
      now,
    );
  A = await cls(1, 'Amanah');
  B = await cls(2, 'Berdikari');
  await linkClassRoom(db, admin, { classId: A, physicalRoomId: r121, effectiveFrom: '2026-11-01' }, meta, now);
  await linkClassRoom(db, admin, { classId: B, physicalRoomId: r122, effectiveFrom: '2026-11-01' }, meta, now);
  termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await setTermClasses(db, admin, { termId, classIds: [A, B] }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  roundId = newId();
  await db.insert(rounds).values({
    id: roundId,
    termId,
    roundNo: 1,
    opensAt: new Date('2026-11-16T01:00:00Z'),
    closesAt: new Date('2026-11-20T09:30:00Z'),
    status: 'closed',
  });
  await db.insert(roundClassAreas).values([
    { roundId, classId: A, areaId: b1, physicalRoomId: r121 },
    { roundId, classId: B, areaId: b1, physicalRoomId: r122 },
  ]);
  const duty = (userId: string, d: 'committee' | 'approver', targetType: 'class' | 'area', targetId: string) =>
    assignDuty(db, admin, { termId, userId, duty: d, targetType, targetId }, meta, now);
  await duty(t1.id, 'committee', 'class', A);
  await duty(t1.id, 'committee', 'class', B);
  await duty(t2.id, 'committee', 'class', B);
  await duty(t1.id, 'committee', 'area', b1);
  await duty(approver.id, 'approver', 'class', B);
  await evaluation(A, 'approved', '121');
  evalB = await evaluation(B, 'submitted', '122');
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('dashboard (08-ux-ui §6.10)', () => {
  test('KPIs, the missing table (late first, with committee) and the finalize blocker', async () => {
    const d = await getDashboard(db, admin, now);
    expect(d.round).toMatchObject({ id: roundId, roundNo: 1, status: 'closed' });
    expect(d.kpi).toEqual({
      classesDone: 1,
      classesTotal: 2,
      areasDone: 0,
      areasTotal: 1,
      waitingResults: 1,
      waitingRequests: 0,
      overdue: 1,
    });
    expect(d.missing.map((m) => [m.target.label, m.status, m.late, m.committee])).toEqual([
      ['อาคาร 1', 'not_evaluated', true, ['ครูหนึ่ง']],
      ['ม.1 Berdikari', 'submitted', false, ['ครูหนึ่ง', 'ครูสอง']],
    ]);
    expect(d.missing[1]!.target.roomNumber).toBe('122');
    expect(d.missing[1]!.evaluationId).toBe(evalB);
    expect(d.finalizeBlocker).toBe(DASHBOARD_MSG.incomplete(2));
    expect(d.canAct).toBe(true);
    expect(d.sync).toBeNull();
  });

  test('executives read the same data without actions; teachers are refused', async () => {
    const d = await getDashboard(db, executive, now);
    expect(d.canAct).toBe(false);
    expect(d.kpi.classesDone).toBe(1);
    await expect(getDashboard(db, t1, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('approval cards (08-ux-ui §6.11)', () => {
  test('waiting results with score, photos (signature last) and the approver rule (BR-E6)', async () => {
    const [card, ...rest] = await listWaitingResults(db, admin, now);
    expect(rest).toHaveLength(0);
    expect(card).toMatchObject({
      id: evalB,
      version: 1,
      roundNo: 1,
      target: { roomNumber: '122', label: 'ม.1 Berdikari' },
      ownerName: 'ครูหนึ่ง',
      score: '4.5',
      max: '5',
      comment: 'ห้องสะอาด',
      canDecide: false, // the target's approver is another admin
    });
    expect(card!.photos.map((p) => p.kind)).toEqual(['site', 'site', 'signature']);
    expect(card!.photos[0]!.thumb).toMatch(/^\/api\/v1\/files\/.+\?w=320$/);
    expect((await listWaitingResults(db, approver, now))[0]!.canDecide).toBe(true);
    expect((await listWaitingResults(db, su, now))[0]!.canDecide).toBe(true);
    expect((await listWaitingResults(db, executive, now))[0]!.canDecide).toBe(false);
  });
});

describe('remind pending committees', () => {
  test('one overdue notice per member with open targets; submitted targets do not count', async () => {
    const out = await remindPendingCommittees(db, admin, meta, now);
    expect(out).toEqual({ users: 1, message: DASHBOARD_MSG.reminded(1) });
    const rows = await db.select().from(notifications).where(eq(notifications.type, 'overdue'));
    expect(rows.map((r) => [r.userId, r.title, r.body, r.link])).toEqual([
      [t1.id, 'เลยกำหนดใส่คะแนน', 'คุณยังเหลือ 1 รายการ', '/tasks'],
    ]);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'round.remind'));
    expect(audit).toHaveLength(1);
    await expect(remindPendingCommittees(db, executive, meta, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
