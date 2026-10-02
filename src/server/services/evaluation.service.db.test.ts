/** T18: evaluation service against PostgreSQL — T-P1..P3, T-E1..E7, T-A1 (13-testing). */
import { randomBytes } from 'node:crypto';
import { and, count, eq, ne } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import {
  auditLogs,
  evaluationStudentScores,
  evaluations,
  evidence,
  notifications,
  requests,
  rosterSnapshots,
  roundClassAreas,
  rounds,
  scoreComponents,
  students,
  terms,
} from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { findTerm } from '../repositories/places.repository.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import {
  approveEvaluation,
  deleteEvaluation,
  resubmitEvaluation,
  returnEvaluation,
  submitEvaluation,
  updateEvaluation,
} from './evaluation.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { getEvaluationDetail, getEvaluationForm, getMyTasks } from './task.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_eval_${randomBytes(4).toString('hex')}`;
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

const hour = 3600_000;
const now = new Date('2026-11-17T03:00:00Z'); // round open
const opensAt = new Date('2026-11-16T01:00:00Z');
const closesAt = new Date('2026-11-20T09:30:00Z');
const meta = { ip: '10.0.0.11', userAgent: 'vitest' };

let db: Db;
let close: () => Promise<void>;
let root: SessionUser;
let admin: SessionUser;
let approver: SessionUser;
let executive: SessionUser;
let t1: SessionUser;
let t2: SessionUser;
let noDuty: SessionUser;
let termId: string;
let roundId: string;
let roomC: string; // class-unit component "คะแนนห้องเรียน"
let areaC: string; // area-unit component "คะแนนอาคาร"
let b1: string;
const cls: Record<string, string> = {};

const signIn = async (u: string, p: string) =>
  (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;

/** Orphan photos as T17 would leave them (files are not needed by the service). */
async function photos(owner: SessionUser, n: number, kind: 'site' | 'signature' = 'site') {
  const ids = Array.from({ length: n }, () => newId());
  await db.insert(evidence).values(
    ids.map((id) => ({
      id,
      uploadedBy: owner.id,
      kind,
      filePath: `uploads/xx/${id}.webp`,
      sha256: id,
      width: 1600,
      height: 1200,
      bytes: 1000,
      capturedAt: now,
    })),
  );
  return ids;
}

async function submitRoom(user: SessionUser, classKey: string, extra: Record<string, unknown> = {}, at = now) {
  return submitEvaluation(
    db,
    user,
    {
      roundId,
      componentId: roomC,
      target: { type: 'class', id: cls[classKey]! },
      score: '4.5',
      siteEvidenceIds: await photos(user, 3),
      signatureEvidenceId: (await photos(user, 1, 'signature'))[0],
      comment: 'สะอาดดี',
      ...extra,
    },
    meta,
    at,
  );
}

async function liveEval(classId: string) {
  const [row] = await db
    .select()
    .from(evaluations)
    .where(
      and(eq(evaluations.targetClassId, classId), eq(evaluations.componentId, roomC), ne(evaluations.status, 'void')),
    );
  return row!;
}

const auditCount = async () => (await db.select({ n: count() }).from(auditLogs))[0]!.n;
/** T-A1: every mutating call writes exactly one audit row. */
async function oneAudit<T>(fn: () => Promise<T>): Promise<T> {
  const before = await auditCount();
  const out = await fn();
  expect((await auditCount()) - before).toBe(1);
  return out;
}

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  await upsertSuperAdmin(db, { username: 'root', displayName: 'ผู้ดูแลสูงสุด', password: 'root-password' }, now);
  root = await signIn('root', 'root-password');
  const mk = async (username: string, displayName: string, role: 'admin' | 'executive' | 'teacher') => {
    const u = await createUser(db, root, { username, displayName, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'แอดมิน', 'admin');
  approver = await mk('adm.app', 'ผู้อนุมัติ', 'admin');
  executive = await mk('exe', 'ผู้บริหาร', 'executive');
  t1 = await mk('t.one', 'ครูหนึ่ง', 'teacher');
  t2 = await mk('t.two', 'ครูสอง', 'teacher');
  noDuty = await mk('t.none', 'ครูไม่มีหน้าที่', 'teacher');

  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  const names = ['Amanah', 'Berdikari', 'Cergas', 'Dedikasi', 'Fatanah', 'Hormat', 'Ikhlas', 'Mulia', 'Patuh'];
  for (const [i, name] of names.entries()) {
    cls[name] = await upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: i + 1, name },
      meta,
      now,
    );
  }
  const r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121' }, meta, now);
  await linkClassRoom(
    db,
    admin,
    { classId: cls.Amanah!, physicalRoomId: r121, effectiveFrom: '2026-11-01' },
    meta,
    now,
  );

  termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await setTermClasses(db, admin, { termId, classIds: Object.values(cls) }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  const comps = await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId));
  roomC = comps.find((c) => c.key === 'room')!.id;
  areaC = comps.find((c) => c.key === 'area')!.id;
  roundId = newId();
  await db.insert(rounds).values({ id: roundId, termId, roundNo: 1, opensAt, closesAt, status: 'open' });
  await db.insert(roundClassAreas).values({ roundId, classId: cls.Amanah!, areaId: b1, physicalRoomId: r121 });

  for (const u of [t1, t2]) {
    for (const id of Object.values(cls)) {
      await assignDuty(
        db,
        admin,
        { termId, userId: u.id, duty: 'committee', targetType: 'class', targetId: id },
        meta,
        now,
      );
    }
    await assignDuty(
      db,
      admin,
      { termId, userId: u.id, duty: 'committee', targetType: 'area', targetId: b1 },
      meta,
      now,
    );
  }
  await assignDuty(
    db,
    admin,
    { termId, userId: approver.id, duty: 'approver', targetType: 'class', targetId: cls.Patuh! },
    meta,
    now,
  );
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('submit (BR-P*, BR-E1)', () => {
  test('T-P1: a teacher without the duty → FORBIDDEN; so is an admin or executive without it (BR-P4)', async () => {
    for (const u of [noDuty, admin, executive]) {
      await expect(submitRoom(u, 'Amanah')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  test('T-E1: photo, signature and score rules; score 0 is a score', async () => {
    await expect(submitRoom(t1, 'Amanah', { siteEvidenceIds: await photos(t1, 2) })).rejects.toMatchObject({
      code: 'VALIDATION',
      field: 'sitePhotos',
      message: 'ต้องถ่ายรูปอีก 1 รูป',
    });
    await expect(submitRoom(t1, 'Amanah', { signatureEvidenceId: null })).rejects.toMatchObject({
      field: 'signature',
      message: 'กรุณาถ่ายรูปใบลงชื่อนักเรียน',
    });
    await expect(submitRoom(t1, 'Amanah', { score: null })).rejects.toMatchObject({
      field: 'score',
      message: 'กรุณาเลือกคะแนน (ถ้าไม่ให้คะแนน ให้เลือก 0)',
    });
    await expect(submitRoom(t1, 'Amanah', { score: '4.25' })).rejects.toMatchObject({
      message: 'คะแนนต้องเป็นทีละ 0.5',
    });
    await expect(submitRoom(t1, 'Amanah', { score: '5.5' })).rejects.toMatchObject({
      message: 'คะแนนต้องอยู่ระหว่าง 0 ถึง 5',
    });
    await expect(submitRoom(t1, 'Amanah', { siteEvidenceIds: await photos(t2, 3) })).rejects.toMatchObject({
      message: 'รูปบางรูปใช้ไม่ได้ กรุณาถ่ายใหม่',
    }); // someone else's uploads

    const term = await findTerm(db, termId);
    expect(term?.configLockedAt).toBeNull();
    const e = await oneAudit(() => submitRoom(t1, 'Amanah', { score: '0' }));
    expect(e).toMatchObject({ status: 'submitted', score: '0.000', roomNumberAtEval: '121', version: 1 });
    expect(e.siteEvidenceIds).toHaveLength(3);
    expect(e.signatureEvidenceId).not.toBeNull();
    expect(e.selfEditUntil).toEqual(new Date(now.getTime() + 24 * hour));
    expect((await findTerm(db, termId))?.configLockedAt).toEqual(now); // BR-TM2
    const inbox = await db.select().from(notifications).where(eq(notifications.type, 'evaluation_submitted'));
    expect(inbox.map((n) => n.userId).sort()).toEqual([root.id, admin.id, approver.id].sort());
    expect(inbox[0]?.body).toBe('ครูหนึ่ง ใส่คะแนน ม.1 Amanah ได้ 0/5');
  });

  test('area unit: no signature photo', async () => {
    const e = await submitEvaluation(
      db,
      t1,
      { roundId, componentId: areaC, target: { type: 'area', id: b1 }, score: 9, siteEvidenceIds: await photos(t1, 3) },
      meta,
      now,
    );
    expect(e).toMatchObject({ score: '9.000', signatureEvidenceId: null, roomNumberAtEval: null });
  });

  test('T-P2: closed entry; a late-entry grant opens it until grant_until', async () => {
    const late = new Date(closesAt.getTime() + 1000);
    await expect(submitRoom(t1, 'Berdikari', {}, late)).rejects.toMatchObject({ code: 'ENTRY_CLOSED' });
    await db.insert(requests).values({
      id: newId(),
      type: 'late_entry',
      status: 'approved',
      requesterId: t1.id,
      roundId,
      componentId: roomC,
      targetType: 'class',
      targetClassId: cls.Berdikari!,
      reason: 'ไม่สบายวันประเมิน',
      grantUntil: new Date(closesAt.getTime() + 24 * hour),
    });
    await expect(submitRoom(t1, 'Berdikari', {}, new Date(closesAt.getTime() + 25 * hour))).rejects.toMatchObject({
      code: 'ENTRY_CLOSED',
    });
    await expect(submitRoom(t2, 'Berdikari', {}, late)).rejects.toMatchObject({ code: 'ENTRY_CLOSED' }); // not t2's grant
    expect((await submitRoom(t1, 'Berdikari', {}, late)).status).toBe('submitted');
  });

  test('T-P3: two members submit the same target at once → one wins, the other gets the winner name', async () => {
    const results = await Promise.allSettled([submitRoom(t1, 'Cergas'), submitRoom(t2, 'Cergas')]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const winner =
      (ok[0] as PromiseFulfilledResult<{ ownerId: string }>).value.ownerId === t1.id ? 'ครูหนึ่ง' : 'ครูสอง';
    expect(failed[0]!.reason).toMatchObject({
      code: 'ALREADY_EVALUATED',
      message: `ห้องนี้ประเมินแล้วโดย ${winner} เมื่อ 17 พ.ย. 2569 10:00 น.`,
    });
  });
});

describe('owner changes (BR-E2..E5)', () => {
  test('T-E2: owner edits at +23h59m after the round closed; at +24h → EDIT_WINDOW_PASSED', async () => {
    const e = await submitRoom(t1, 'Dedikasi');
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, roundId));
    try {
      const almost = new Date(now.getTime() + 24 * hour - 60_000);
      const edited = await oneAudit(() =>
        updateEvaluation(db, t1, { id: e.id, expectedVersion: 1, score: 3, comment: 'แก้แล้ว' }, meta, almost),
      );
      expect(edited).toMatchObject({ score: '3.000', comment: 'แก้แล้ว', version: 2 });
      const changed = await db.select().from(notifications).where(eq(notifications.type, 'evaluation_changed'));
      expect(changed.at(-1)?.body).toBe('ครูหนึ่ง แก้ไขคะแนน 4.5 → 3 / ข้อติชม ม.1 Dedikasi');
      await expect(
        updateEvaluation(db, t1, { id: e.id, expectedVersion: 2, score: 2 }, meta, new Date(now.getTime() + 24 * hour)),
      ).rejects.toMatchObject({ code: 'EDIT_WINDOW_PASSED' });
    } finally {
      await db.update(rounds).set({ status: 'open' }).where(eq(rounds.id, roundId));
    }
  });

  test('stale version → CONFLICT; photos can be swapped and removed ones are soft-deleted', async () => {
    const e = await submitRoom(t1, 'Fatanah');
    await expect(updateEvaluation(db, t1, { id: e.id, expectedVersion: 9, score: 1 }, meta, now)).rejects.toMatchObject(
      {
        code: 'CONFLICT',
      },
    );
    const fresh = await photos(t1, 3);
    const out = await updateEvaluation(db, t1, { id: e.id, expectedVersion: 1, siteEvidenceIds: fresh }, meta, now);
    expect(out.siteEvidenceIds.sort()).toEqual(fresh.sort());
    const old = await db.select().from(evidence).where(eq(evidence.id, e.siteEvidenceIds[0]!));
    expect(old[0]?.removedAt).toEqual(now);
  });

  test('T-E3: another committee member cannot edit → FORBIDDEN', async () => {
    const e = await submitRoom(t1, 'Hormat');
    await expect(updateEvaluation(db, t2, { id: e.id, expectedVersion: 1, score: 1 }, meta, now)).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      },
    );
    await expect(deleteEvaluation(db, t2, { id: e.id, expectedVersion: 1 }, meta, now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('T-E5: owner deletes within the window → void; another member can now create', async () => {
    const e = await submitRoom(t1, 'Ikhlas');
    await expect(submitRoom(t2, 'Ikhlas')).rejects.toMatchObject({ code: 'ALREADY_EVALUATED' });
    await oneAudit(() => deleteEvaluation(db, t1, { id: e.id, expectedVersion: 1 }, meta, now));
    const second = await submitRoom(t2, 'Ikhlas');
    expect(second.ownerId).toBe(t2.id);
  });
});

describe('approve and return (BR-E6, BR-E7)', () => {
  test('T-E6: with an approver on the target, other admins are refused; super admin and the approver may', async () => {
    const e = await submitRoom(t1, 'Patuh');
    await expect(approveEvaluation(db, admin, { id: e.id, expectedVersion: 1 }, meta, now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(approveEvaluation(db, executive, { id: e.id, expectedVersion: 1 }, meta, now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const approved = await oneAudit(() => approveEvaluation(db, root, { id: e.id, expectedVersion: 1 }, meta, now));
    expect(approved.status).toBe('approved');
    const [row] = await db.select().from(evaluations).where(eq(evaluations.id, e.id));
    expect(row).toMatchObject({ pdfStatus: 'queued', approvedBy: root.id }); // PDF job queued for T22's worker
    // approved → changes only through requests (BR-E9)
    await expect(updateEvaluation(db, t1, { id: e.id, expectedVersion: 1, score: 1 }, meta, now)).rejects.toMatchObject(
      {
        message: 'ผลประเมินนี้อนุมัติแล้ว แก้ไขได้โดยกด "ขออนุมัติแก้ไข"',
      },
    );
    // any admin approves a target without an approver (Q10)
    const other = await submitRoom(t2, 'Mulia');
    expect((await approveEvaluation(db, admin, { id: other.id, expectedVersion: 1 }, meta, now)).status).toBe(
      'approved',
    );
  });

  test('T-E7: return needs a reason, extends the window to now + 24 h; owner fixes and resubmits', async () => {
    // Amanah was submitted at `now` by t1 (score 0)
    const amanahEval = await liveEval(cls.Amanah!);
    const later = new Date(now.getTime() + 20 * hour);
    await expect(
      returnEvaluation(
        db,
        admin,
        { id: amanahEval!.id, expectedVersion: amanahEval!.version, reason: 'สั้น' },
        meta,
        later,
      ),
    ).rejects.toMatchObject({ field: 'reason', message: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });
    const returned = await oneAudit(() =>
      returnEvaluation(
        db,
        admin,
        { id: amanahEval!.id, expectedVersion: amanahEval!.version, reason: 'รูปไม่ชัด ถ่ายใหม่' },
        meta,
        later,
      ),
    );
    expect(returned.status).toBe('returned');
    expect(returned.selfEditUntil).toEqual(new Date(later.getTime() + 24 * hour));
    const inbox = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, t1.id), eq(notifications.type, 'evaluation_returned')));
    expect(inbox[0]).toMatchObject({ body: 'ม.1 Amanah: รูปไม่ชัด ถ่ายใหม่', link: `/evaluate/${amanahEval!.id}` });

    // after the original window (now + 24 h) the owner can still fix it
    const afterOriginal = new Date(now.getTime() + 30 * hour);
    const fixed = await updateEvaluation(
      db,
      t1,
      { id: amanahEval!.id, expectedVersion: returned.version, siteEvidenceIds: await photos(t1, 4) },
      meta,
      afterOriginal,
    );
    const resubmitted = await oneAudit(() =>
      resubmitEvaluation(db, t1, { id: amanahEval!.id, expectedVersion: fixed.version, score: 2 }, meta, afterOriginal),
    );
    expect(resubmitted).toMatchObject({ status: 'submitted', score: '2.000', version: fixed.version + 1 });
    await expect(
      resubmitEvaluation(db, t1, { id: amanahEval!.id, expectedVersion: resubmitted.version }, meta, afterOriginal),
    ).rejects.toMatchObject({ message: 'แก้แล้วส่งใหม่ได้เฉพาะผลประเมินที่ถูกส่งกลับ' });
  });
});

describe('individual mode (FR-R6)', () => {
  test('every snapshot student needs a score; stored per student, no class score', async () => {
    await db.update(terms).set({ roomMode: 'individual' }).where(eq(terms.id, termId));
    try {
      const sIds = [newId(), newId()];
      await db.insert(students).values(
        sIds.map((id, i) => ({
          id,
          studentCode: `S${i}`,
          fullName: `ทดสอบ ${i}`,
          homeClassId: cls.Berdikari!,
          deleteAfter: '2027-12-31',
        })),
      );
      // free the Hormat slot (t1's group-mode evaluation from T-E3)
      const hormat = await liveEval(cls.Hormat!);
      await deleteEvaluation(db, t1, { id: hormat.id, expectedVersion: hormat.version }, meta, now);
      // no snapshot yet: nothing to score per student, so nothing may be sent (T40)
      await expect(submitRoom(t2, 'Hormat', { score: undefined, studentScores: [] })).rejects.toMatchObject({
        field: 'studentScores',
        message: 'ยังไม่มีรายชื่อนักเรียนของห้องนี้ในรอบนี้ แจ้งผู้ดูแลระบบให้ซิงก์รายชื่อก่อน',
      });
      await db.insert(rosterSnapshots).values(sIds.map((studentId) => ({ roundId, studentId, classId: cls.Hormat! })));
      const form = await getEvaluationForm(
        db,
        t2,
        { roundId, componentId: roomC, target: { type: 'class', id: cls.Hormat! } },
        now,
      );
      expect(form.individual).toBe(true);
      expect(form.students).toEqual([
        { id: sIds[0], code: 'S0' },
        { id: sIds[1], code: 'S1' },
      ]);
      expect(JSON.stringify(form)).not.toContain('ทดสอบ'); // codes only, never names (FR-S1)

      await expect(
        submitRoom(t2, 'Hormat', { score: undefined, studentScores: [{ studentId: sIds[0]!, score: 4 }] }),
      ).rejects.toMatchObject({ field: 'studentScores', message: 'ยังไม่ได้ให้คะแนนนักเรียนอีก 1 คน' });
      const e = await submitRoom(t2, 'Hormat', {
        score: undefined,
        studentScores: [
          { studentId: sIds[0]!, score: 4 },
          { studentId: sIds[1]!, score: '3.5' },
        ],
      });
      expect(e.score).toBeNull();
      const rows = await db
        .select()
        .from(evaluationStudentScores)
        .where(eq(evaluationStudentScores.evaluationId, e.id));
      expect(rows.map((r) => r.score).sort()).toEqual(['3.500', '4.000']);
      const detail = await getEvaluationDetail(db, t2, e.id, now);
      expect(detail.score).toBe('3.750'); // class mean shown in place of a class score
      expect(detail.studentScores).toEqual([
        { studentId: sIds[0], code: 'S0', score: 4000 },
        { studentId: sIds[1], code: 'S1', score: 3500 },
      ]);
      expect(JSON.stringify(detail)).not.toContain('ทดสอบ');
    } finally {
      await db.update(terms).set({ roomMode: 'group' }).where(eq(terms.id, termId));
    }
  });
});

describe('area-teacher deductions (T41, FR-E12, Q4)', () => {
  test('only the area teacher of the class’s area, once per round, > 0, a reason and a photo', async () => {
    const u = await createUser(db, root, { username: 't.area', displayName: 'ครูอาคาร', role: 'teacher' }, meta, now);
    const areaTeacher = await signIn('t.area', u.tempPassword!);
    await expect(
      assignDuty(
        db,
        admin,
        { termId, userId: areaTeacher.id, duty: 'area_teacher', targetType: 'class', targetId: cls.Amanah! },
        meta,
        now,
      ),
    ).rejects.toMatchObject({ message: 'ครูผู้รับผิดชอบพื้นที่ต้องเลือกอาคารหรือโซน' });
    await assignDuty(
      db,
      admin,
      { termId, userId: areaTeacher.id, duty: 'area_teacher', targetType: 'area', targetId: b1 },
      meta,
      now,
    );
    const deductC = newId();
    await db.insert(scoreComponents).values({
      id: deductC,
      termId,
      key: 'area_deduct',
      label: 'หักคะแนนจากครูผู้รับผิดชอบ',
      unit: 'class',
      source: 'area_teacher',
      kind: 'deduct',
      maxValue: '3.000',
      enabled: true,
      requiresSignature: false,
      sortOrder: 9,
    });
    const deduct = async (user: SessionUser, classKey: string, extra: Record<string, unknown> = {}) =>
      submitEvaluation(
        db,
        user,
        {
          roundId,
          componentId: deductC,
          target: { type: 'class', id: cls[classKey]! },
          score: '2',
          siteEvidenceIds: await photos(user, 1),
          signatureEvidenceId: null,
          comment: 'ขยะล้นถังหน้าห้อง',
          ...extra,
        },
        meta,
        now,
      );
    try {
      // a committee duty on the class is not an area-teacher duty
      await expect(deduct(t1, 'Amanah')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // Berdikari is not frozen into อาคาร 1 for this round
      await expect(deduct(areaTeacher, 'Berdikari')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(deduct(areaTeacher, 'Amanah', { score: '0' })).rejects.toMatchObject({
        field: 'score',
        message: 'คะแนนที่หักต้องมากกว่า 0',
      });
      await expect(deduct(areaTeacher, 'Amanah', { score: '3.5' })).rejects.toMatchObject({ field: 'score' });
      await expect(deduct(areaTeacher, 'Amanah', { siteEvidenceIds: [] })).rejects.toMatchObject({
        field: 'sitePhotos',
        message: 'ต้องถ่ายรูปอีก 1 รูป',
      });
      await expect(deduct(areaTeacher, 'Amanah', { comment: 'ขยะ' })).rejects.toMatchObject({
        field: 'comment',
        message: 'กรุณาระบุเหตุผลที่หักคะแนนอย่างน้อย 5 ตัวอักษร',
      });

      const tasks = await getMyTasks(db, areaTeacher, now);
      const mine = tasks.items.filter((i) => i.componentId === deductC);
      expect(mine.map((i) => [i.target.id, i.optional, i.status])).toEqual([[cls.Amanah, true, 'not_evaluated']]);
      const form = await getEvaluationForm(
        db,
        areaTeacher,
        { roundId, componentId: deductC, target: { type: 'class', id: cls.Amanah! } },
        now,
      );
      expect(form).toMatchObject({ deduction: true, photoMin: 1, requiresSignature: false, individual: false });

      const e = await deduct(areaTeacher, 'Amanah');
      expect(e).toMatchObject({ status: 'submitted', score: '2.000' });
      // once per round (BR-P3)
      await expect(deduct(areaTeacher, 'Amanah')).rejects.toMatchObject({ code: 'ALREADY_EVALUATED' });
      // the area teacher sees their deduction, a committee member of the class does not get it as their own
      expect((await getEvaluationDetail(db, areaTeacher, e.id, now)).deduction).toBe(true);
      await approveEvaluation(db, admin, { id: e.id, expectedVersion: e.version }, meta, now);
    } finally {
      await db.update(scoreComponents).set({ enabled: false }).where(eq(scoreComponents.id, deductC));
    }
  });
});
