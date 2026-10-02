/** T21: results engine against PostgreSQL — live results, ranking, finalize (T-R2, T-R3), term score (G1). */
import { randomBytes } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import {
  auditLogs,
  evaluationStudentScores,
  evaluations,
  notifications,
  requests,
  rosterSnapshots,
  roundClassAreas,
  roundClassResults,
  roundStudentResults,
  rounds,
  scoreComponents,
  students,
  terms,
} from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { setTermClasses, upsertArea, upsertClass } from './place.service.ts';
import { approveRequest, createRequest } from './request.service.ts';
import { computeRoundResults, finalizeRound, getRoundResults, getTermResults } from './result.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_results_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-12-01T03:00:00Z');
const meta = { ip: '10.0.0.14', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let root: SessionUser;
let admin: SessionUser;
let executive: SessionUser;
let teacher: SessionUser;
let termId: string;
let roomC: string;
let areaC: string;
let A: string;
let B: string;
let C: string;
let b1: string;
let b2: string;
const roundIds: string[] = [];
const studentIds: string[] = [];
let amanahRound3Room: string;

/** An approved evaluation straight in the table (results only read approved scores). */
async function approved(
  roundId: string,
  componentId: string,
  target: { class?: string; area?: string },
  score: string,
) {
  const id = newId();
  await db.insert(evaluations).values({
    id,
    roundId,
    componentId,
    targetType: target.class ? 'class' : 'area',
    targetClassId: target.class ?? null,
    targetAreaId: target.area ?? null,
    ownerId: teacher.id,
    score,
    status: 'approved',
    firstSubmittedAt: now,
    selfEditUntil: now,
    lastEditedAt: now,
  });
  return id;
}

const th = (n: number) => n * 1000;

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  root = await signIn('root', 'root-password');
  const mk = async (username: string, role: 'admin' | 'executive' | 'teacher') => {
    const u = await createUser(db, root, { username, displayName: username, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'admin');
  executive = await mk('exe', 'executive');
  teacher = await mk('t.one', 'teacher');

  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  b2 = await upsertArea(db, admin, { type: 'building', code: '2', name: 'อาคาร 2' }, meta, now);
  const cls = (gradeCode: string, grade: string, roomNo: number, name: string) =>
    upsertClass(
      db,
      admin,
      { track: 'general', gradeCode, gradeLabel: grade, rankGroup: grade, roomNo, name },
      meta,
      now,
    );
  A = await cls('M1', 'ม.1', 1, 'Amanah');
  B = await cls('M1', 'ม.1', 2, 'Berdikari');
  C = await cls('M2', 'ม.2', 1, 'Cergas');
  termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now); // room 5 + building 10, max 15
  await setTermClasses(db, admin, { termId, classIds: [A, B, C] }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  const comps = await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId));
  roomC = comps.find((c) => c.key === 'room')!.id;
  areaC = comps.find((c) => c.key === 'area')!.id;
  // evaluations here are seeded without photos; let request approvals (BR-Q3 re-validation) pass without them
  await db.update(terms).set({ photoMin: 0 }).where(eq(terms.id, termId));
  await db.update(scoreComponents).set({ requiresSignature: false }).where(eq(scoreComponents.id, roomC));
  for (let n = 1; n <= 3; n++) {
    const id = newId();
    roundIds.push(id);
    await db.insert(rounds).values({
      id,
      termId,
      roundNo: n,
      opensAt: new Date(Date.UTC(2026, 10, n * 7)),
      closesAt: new Date(Date.UTC(2026, 10, n * 7 + 4)),
      status: 'closed',
    });
    await db.insert(roundClassAreas).values([
      { roundId: id, classId: A, areaId: b1 },
      { roundId: id, classId: B, areaId: b1 },
      { roundId: id, classId: C, areaId: b2 },
    ]);
  }
  await assignDuty(
    db,
    admin,
    { termId, userId: teacher.id, duty: 'committee', targetType: 'class', targetId: A },
    meta,
    now,
  );

  // G1 (04-business-rules §7.7): Amanah 4+9, 5+7, 4+10 → 13, 12, 14
  const [r1, r2, r3] = roundIds as [string, string, string];
  for (const [round, room, bld] of [
    [r1, '4', '9'],
    [r2, '5', '7'],
    [r3, '4', '10'],
  ] as const) {
    const id = await approved(round, roomC, { class: A }, room);
    if (round === r3) amanahRound3Room = id;
    await approved(round, areaC, { area: b1 }, bld);
  }
  await approved(r1, roomC, { class: B }, '5'); // B: 5 + 9 = 14
  await approved(r1, roomC, { class: C }, '3'); // C: 3 + b2
  await approved(r1, areaC, { area: b2 }, '7'); // C: 10

  // two students snapshot in Amanah for round 1
  const s = [newId(), newId()];
  studentIds.push(...s);
  await db.insert(students).values(
    s.map((id, i) => ({
      id,
      studentCode: `S${i}`,
      fullName: `ทดสอบ ${i}`,
      homeClassId: A,
      deleteAfter: '2027-12-31',
    })),
  );
  await db.insert(rosterSnapshots).values(s.map((studentId) => ({ roundId: r1, studentId, classId: A })));
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('live round results (BR-S1..S3, S5, S6)', () => {
  test('totals, ranks per rank group, areas, students', async () => {
    const r = await computeRoundResults(db, roundIds[0]!);
    const byId = new Map(r.classes.map((c) => [c.classId, c]));
    expect(byId.get(A)).toMatchObject({ classScore: th(4), areaScore: th(9), total: th(13), max: th(15), rank: 2 });
    expect(byId.get(B)).toMatchObject({ total: th(14), rank: 1 });
    expect(byId.get(C)).toMatchObject({ total: th(10), rank: 1 }); // own group ม.2
    expect(r.areas).toEqual([
      { areaId: b1, score: th(9), max: th(10), rank: 1 },
      { areaId: b2, score: th(7), max: th(10), rank: 2 },
    ]);
    expect(r.students.map((s) => s.total)).toEqual([th(13), th(13)]);
    expect(r.missing).toEqual([]);
  });

  test('a submitted (not approved) evaluation does not count: the class waits ("รอผล") and is missing', async () => {
    const r = await computeRoundResults(db, roundIds[1]!);
    const byId = new Map(r.classes.map((c) => [c.classId, c]));
    expect(byId.get(A)!.total).toBe(th(12));
    expect(byId.get(B)).toMatchObject({ total: null, rank: null });
    expect(r.missing).toEqual(
      expect.arrayContaining([
        { componentId: roomC, targetType: 'class', targetId: B },
        { componentId: roomC, targetType: 'class', targetId: C },
        { componentId: areaC, targetType: 'area', targetId: b2 },
      ]),
    );
  });
});

describe('individual mode student results (FR-R6, T40)', () => {
  test('the class ranks on the mean; each student keeps their own room score', async () => {
    const r3 = roundIds[2]!;
    const [s0, s1] = studentIds as [string, string];
    await db.update(terms).set({ roomMode: 'individual' }).where(eq(terms.id, termId));
    await db.insert(rosterSnapshots).values([s0, s1].map((studentId) => ({ roundId: r3, studentId, classId: A })));
    await db.update(evaluations).set({ score: null }).where(eq(evaluations.id, amanahRound3Room));
    await db.insert(evaluationStudentScores).values([
      { evaluationId: amanahRound3Room, studentId: s0, score: '5.000' },
      { evaluationId: amanahRound3Room, studentId: s1, score: '2.000' },
    ]);
    try {
      const r = await computeRoundResults(db, r3);
      // room mean 3.5 + building 10
      expect(r.classes.find((c) => c.classId === A)).toMatchObject({ classScore: th(3.5), total: th(13.5) });
      const byStudent = new Map(r.students.map((x) => [x.studentId, x.total]));
      expect(byStudent.get(s0)).toBe(th(15));
      expect(byStudent.get(s1)).toBe(th(12));
    } finally {
      await db.delete(evaluationStudentScores).where(eq(evaluationStudentScores.evaluationId, amanahRound3Room));
      await db.update(evaluations).set({ score: '4.000' }).where(eq(evaluations.id, amanahRound3Room));
      await db.delete(rosterSnapshots).where(eq(rosterSnapshots.roundId, r3));
      await db.update(terms).set({ roomMode: 'group' }).where(eq(terms.id, termId));
    }
  });
});

describe('finalize (BR-R3)', () => {
  test('T-R2: missing evaluations → ROUND_NOT_COMPLETE (n); a waiting request blocks; only closed rounds', async () => {
    await expect(finalizeRound(db, executive, { roundId: roundIds[1]! }, meta, now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(finalizeRound(db, admin, { roundId: roundIds[1]! }, meta, now)).rejects.toMatchObject({
      code: 'ROUND_NOT_COMPLETE',
      message: 'ยังปิดรอบไม่ได้ เหลือ 3 รายการ',
    });
    // complete round 1 data exists; a waiting edit request still blocks it
    const [aEval] = await db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.roundId, roundIds[0]!), eq(evaluations.targetClassId, A)));
    const req = await createRequest(
      db,
      teacher,
      { type: 'edit_score', evaluationId: aEval!.id, reason: 'ขอแก้คะแนน', payload: { score: 4.5 } },
      meta,
      now,
    );
    await expect(finalizeRound(db, admin, { roundId: roundIds[0]! }, meta, now)).rejects.toMatchObject({
      message: 'ยังปิดรอบไม่ได้ มีคำขอรออนุมัติ 1 รายการ',
    });
    await db.update(requests).set({ status: 'rejected' }).where(eq(requests.id, req.id));
    await db.update(rounds).set({ status: 'open' }).where(eq(rounds.id, roundIds[0]!));
    await expect(finalizeRound(db, admin, { roundId: roundIds[0]! }, meta, now)).rejects.toMatchObject({
      message: 'ปิดรอบได้เมื่อรอบปิดรับคะแนนแล้ว',
    });
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, roundIds[0]!));
  });

  test('T-R3: finalize freezes exactly the live results; later reads return the frozen rows', async () => {
    const live = await computeRoundResults(db, roundIds[0]!);
    // a stale late-entry request lapses at finalize (BR-Q4)
    const lateId = newId();
    await db.insert(requests).values({
      id: lateId,
      type: 'late_entry',
      requesterId: teacher.id,
      roundId: roundIds[0]!,
      componentId: roomC,
      targetType: 'class',
      targetClassId: A,
      reason: 'ขอใส่คะแนน',
    });
    const before = (await db.select({ n: count() }).from(auditLogs))[0]!.n;
    const out = await finalizeRound(db, admin, { roundId: roundIds[0]! }, meta, now);
    expect((await db.select({ n: count() }).from(auditLogs))[0]!.n - before).toBe(1);
    expect(out.frozen).toBe(true);

    const frozenRows = await db.select().from(roundClassResults).where(eq(roundClassResults.roundId, roundIds[0]!));
    expect(frozenRows.every((r) => r.frozen)).toBe(true);
    expect(frozenRows.map((r) => [r.classId, r.total, r.rankInGroup]).sort()).toEqual(
      live.classes.map((c) => [c.classId, `${c.total! / 1000}.000`, c.rank]).sort(),
    );
    expect(
      await db.select().from(roundStudentResults).where(eq(roundStudentResults.roundId, roundIds[0]!)),
    ).toHaveLength(2);
    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundIds[0]!));
    expect(round).toMatchObject({ status: 'finalized', finalizedBy: admin.id });
    expect((await db.select().from(requests).where(eq(requests.id, lateId)))[0]!.status).toBe('expired');
    const pdfs = await db.select().from(evaluations).where(eq(evaluations.roundId, roundIds[0]!));
    expect(pdfs.every((e) => e.pdfStatus === 'queued')).toBe(true);
    const inbox = await db.select().from(notifications).where(eq(notifications.type, 'round_finalized'));
    expect(inbox.map((n) => n.userId).sort()).toEqual([root.id, admin.id, executive.id].sort());

    // the frozen rows win even if the live data changes afterwards
    await db
      .update(evaluations)
      .set({ score: '1.000' })
      .where(and(eq(evaluations.roundId, roundIds[0]!), eq(evaluations.targetClassId, B)));
    const read = await getRoundResults(db, roundIds[0]!);
    expect(read.frozen).toBe(true);
    expect(read.classes.find((c) => c.classId === B)!.total).toBe(th(14));
    await db
      .update(evaluations)
      .set({ score: '5.000' })
      .where(and(eq(evaluations.roundId, roundIds[0]!), eq(evaluations.targetClassId, B)));
    await expect(finalizeRound(db, admin, { roundId: roundIds[0]! }, meta, now)).rejects.toMatchObject({
      message: 'รอบนี้ปิดรอบแล้ว',
    });
  });

  test('BR-Q5: a super admin request on the finalized round recomputes and refreezes it', async () => {
    const [aEval] = await db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.roundId, roundIds[0]!), eq(evaluations.targetClassId, A)));
    const req = await createRequest(
      db,
      root,
      { type: 'edit_score', evaluationId: aEval!.id, reason: 'แก้หลังปิดรอบ', payload: { score: 5 } },
      meta,
      now,
    ).catch((e) => e);
    // the super admin is not on the committee: ask as the teacher would, then the super admin decides
    expect(req).toMatchObject({ code: 'FORBIDDEN' });
    const id = newId();
    await db.insert(requests).values({
      id,
      type: 'edit_score',
      requesterId: teacher.id,
      roundId: roundIds[0]!,
      componentId: roomC,
      evaluationId: aEval!.id,
      targetType: 'class',
      targetClassId: A,
      reason: 'แก้หลังปิดรอบ',
      payload: { score: '5' },
    });
    await approveRequest(db, root, { id }, meta, now);
    const read = await getRoundResults(db, roundIds[0]!);
    expect(read.classes.find((c) => c.classId === A)).toMatchObject({ total: th(14), rank: 1 });
    expect(read.classes.find((c) => c.classId === B)).toMatchObject({ total: th(14), rank: 1 }); // tie at 14
    // put G1 back for the term test
    await db.update(evaluations).set({ score: '4.000' }).where(eq(evaluations.id, aEval!.id));
    await db.delete(roundClassResults).where(eq(roundClassResults.roundId, roundIds[0]!));
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, roundIds[0]!));
  });
});

describe('term results (BR-S4, G1)', () => {
  test('G1: 13, 12, 14 → 13.000; without round 2 → 13.500; final max 20 → 17.333', async () => {
    const termA = async () => (await getTermResults(db, termId)).classes.find((c) => c.classId === A)!;
    expect(await termA()).toMatchObject({ rounds: [th(13), th(12), th(14)], termScore: th(13) });
    await db
      .update(evaluations)
      .set({ status: 'returned' })
      .where(and(eq(evaluations.roundId, roundIds[1]!), eq(evaluations.targetClassId, A)));
    expect((await termA()).termScore).toBe(13_500);
    await db
      .update(evaluations)
      .set({ status: 'approved' })
      .where(and(eq(evaluations.roundId, roundIds[1]!), eq(evaluations.targetClassId, A)));
    await db.update(terms).set({ finalMax: '20.000' }).where(eq(terms.id, termId));
    expect((await termA()).termScore).toBe(17_333);
  });
});
