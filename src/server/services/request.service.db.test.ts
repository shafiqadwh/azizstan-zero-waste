/** T20: requests against PostgreSQL — T-Q1..Q3, BR-Q1/Q2/Q5, the six types, one audit row per call. */
import { randomBytes } from 'node:crypto';
import { and, count, eq, ne } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import {
  auditLogs,
  evaluations,
  evidence,
  notifications,
  pdfDocuments,
  requests,
  roundClassAreas,
  rounds,
  scoreComponents,
} from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { approveEvaluation, submitEvaluation } from './evaluation.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { approveRequest, cancelRequest, createRequest, rejectRequest } from './request.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_req_${randomBytes(4).toString('hex')}`;
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
const now = new Date('2026-11-17T03:00:00Z');
const closesAt = new Date('2026-11-20T09:30:00Z');
const afterClose = new Date(closesAt.getTime() + 2 * hour);
const later = new Date(now.getTime() + 30 * hour); // owner's 24 h window has passed
const meta = { ip: '10.0.0.13', userAgent: 'vitest' };

let db: Db;
let close: () => Promise<void>;
let root: SessionUser;
let admin: SessionUser;
let executive: SessionUser;
let t1: SessionUser;
let t2: SessionUser;
let outsider: SessionUser;
let roundId: string;
let roomC: string;
const cls: Record<string, string> = {};

async function photos(owner: SessionUser, n: number, kind: 'site' | 'signature' = 'site') {
  const ids = Array.from({ length: n }, () => newId());
  await db.insert(evidence).values(
    ids.map((id) => ({
      id,
      uploadedBy: owner.id,
      kind,
      filePath: `uploads/xx/${id}.webp`,
      sha256: id,
      width: 10,
      height: 10,
      bytes: 10,
      capturedAt: now,
    })),
  );
  return ids;
}

const submit = async (user: SessionUser, name: string, at = now) =>
  submitEvaluation(
    db,
    user,
    {
      roundId,
      componentId: roomC,
      target: { type: 'class', id: cls[name]! },
      score: '4.5',
      siteEvidenceIds: await photos(user, 3),
      signatureEvidenceId: (await photos(user, 1, 'signature'))[0],
      comment: 'เดิม',
    },
    meta,
    at,
  );

const request = (user: SessionUser, evaluationId: string, type: string, payload: Record<string, unknown>, at = later) =>
  createRequest(db, user, { type: type as 'edit_score', evaluationId, reason: 'ใส่ผิดตอนประเมิน', payload }, meta, at);

const auditCount = async () => (await db.select({ n: count() }).from(auditLogs))[0]!.n;
async function oneAudit<T>(fn: () => Promise<T>): Promise<T> {
  const before = await auditCount();
  const out = await fn();
  expect((await auditCount()) - before).toBe(1);
  return out;
}
const evaluation = async (id: string) => (await db.select().from(evaluations).where(eq(evaluations.id, id)))[0]!;
const requestRow = async (id: string) => (await db.select().from(requests).where(eq(requests.id, id)))[0]!;

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  root = await signIn('root', 'root-password');
  const mk = async (username: string, displayName: string, role: 'admin' | 'executive' | 'teacher') => {
    const u = await createUser(db, root, { username, displayName, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'แอดมิน', 'admin');
  executive = await mk('exe', 'ผู้บริหาร', 'executive');
  t1 = await mk('t.one', 'ครูหนึ่ง', 'teacher');
  t2 = await mk('t.two', 'ครูสอง', 'teacher');
  outsider = await mk('t.out', 'ครูนอก', 'teacher');

  const b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  const names = ['Amanah', 'Berdikari', 'Cergas', 'Dedikasi', 'Fatanah', 'Hormat', 'Ikhlas', 'Mulia'];
  for (const [i, name] of names.entries()) {
    cls[name] = await upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: i + 1, name },
      meta,
      now,
    );
  }
  const r131 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '131' }, meta, now);
  await linkClassRoom(db, admin, { classId: cls.Mulia!, physicalRoomId: r131, effectiveFrom: '2026-11-01' }, meta, now);
  const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await setTermClasses(db, admin, { termId, classIds: Object.values(cls) }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  roomC = (await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId))).find(
    (c) => c.key === 'room',
  )!.id;
  roundId = newId();
  await db.insert(rounds).values({
    id: roundId,
    termId,
    roundNo: 1,
    opensAt: new Date('2026-11-16T01:00:00Z'),
    closesAt,
    status: 'open',
  });
  await db.insert(roundClassAreas).values({ roundId, classId: cls.Mulia!, areaId: b1, physicalRoomId: r131 });
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
  }
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('create (BR-Q1, §6 preconditions)', () => {
  test('reason ≥ 5; owner inside the window edits instead; outsiders and executives without duty refused', async () => {
    const e = await submit(t1, 'Amanah');
    await expect(
      createRequest(
        db,
        t1,
        { type: 'edit_score', evaluationId: e.id, reason: 'สั้น', payload: { score: 3 } },
        meta,
        later,
      ),
    ).rejects.toMatchObject({ field: 'reason', message: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });
    await expect(request(t1, e.id, 'edit_score', { score: 3 }, now)).rejects.toMatchObject({
      message: 'ยังแก้ไขเองได้ ไม่ต้องขออนุมัติ',
    });
    await expect(request(outsider, e.id, 'edit_score', { score: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(request(executive, e.id, 'edit_score', { score: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      request(t2, e.id, 'move_target', { target: { type: 'class', id: cls.Berdikari } }),
    ).rejects.toMatchObject({
      message: 'เฉพาะผู้ประเมินเจ้าของผลนี้เท่านั้นที่ขอย้ายห้องได้',
    });
    await expect(request(t1, e.id, 'edit_score', { score: '3.25' })).rejects.toMatchObject({
      field: 'score',
      message: 'คะแนนต้องเป็นทีละ 0.5',
    });
  });

  test('another committee member may ask; one waiting request per type; requester can cancel', async () => {
    const e = await submit(t1, 'Berdikari');
    const r = await oneAudit(() => request(t2, e.id, 'edit_comment', { comment: 'แก้โดยกรรมการอีกคน' }, now));
    await expect(request(t2, e.id, 'edit_comment', { comment: 'อีกครั้ง' }, now)).rejects.toMatchObject({
      message: 'มีคำขอประเภทนี้รออนุมัติอยู่แล้ว',
    });
    const inbox = await db.select().from(notifications).where(eq(notifications.type, 'request_created'));
    expect(inbox.some((n) => n.userId === admin.id && n.body === 'แก้ข้อติชม · ม.1 Berdikari')).toBe(true);
    await expect(cancelRequest(db, t1, { id: r.id }, meta, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await oneAudit(() => cancelRequest(db, t2, { id: r.id }, meta, now));
    expect((await requestRow(r.id)).status).toBe('cancelled');
  });
});

describe('approve (BR-Q2, BR-Q3)', () => {
  test('edit_score 4.5 → 3 outside the window: version + 1, requester notified; executives cannot decide', async () => {
    const e = await submit(t1, 'Cergas');
    const r = await request(t1, e.id, 'edit_score', { score: 3 });
    await expect(approveRequest(db, executive, { id: r.id }, meta, later)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await oneAudit(() => approveRequest(db, admin, { id: r.id, note: 'ตรวจแล้ว' }, meta, later));
    expect(await evaluation(e.id)).toMatchObject({ score: '3.000', version: 2, status: 'submitted' });
    expect(await requestRow(r.id)).toMatchObject({ status: 'approved', decidedBy: admin.id, decisionNote: 'ตรวจแล้ว' });
    const inbox = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, t1.id), eq(notifications.type, 'request_decided')));
    expect(inbox.at(-1)).toMatchObject({ title: 'คำขออนุมัติแล้ว', body: 'ม.1 Cergas · คะแนน 4.5 → 3 · ตรวจแล้ว' });
    await expect(approveRequest(db, admin, { id: r.id }, meta, later)).rejects.toMatchObject({
      message: 'คำขอนี้ไม่ได้รออนุมัติแล้ว',
    });
  });

  test('T-Q1: an edit_score off the step grid fails at approval and the request stays waiting', async () => {
    const e = await submit(t1, 'Dedikasi');
    const id = newId(); // written straight to the table: creation already refuses this score
    await db.insert(requests).values({
      id,
      type: 'edit_score',
      requesterId: t1.id,
      roundId,
      componentId: roomC,
      evaluationId: e.id,
      targetType: 'class',
      targetClassId: cls.Dedikasi!,
      reason: 'พิมพ์ผิด',
      payload: { score: '3.25' },
    });
    await expect(approveRequest(db, admin, { id }, meta, later)).rejects.toMatchObject({
      code: 'VALIDATION',
      field: 'score',
      message: 'คะแนนต้องเป็นทีละ 0.5',
    });
    expect((await requestRow(id)).status).toBe('waiting');
    expect((await evaluation(e.id)).score).toBe('4.500');
  });

  test('T-Q2: move_target to a target that already has a live evaluation → ALREADY_EVALUATED; to a free one works', async () => {
    const wrong = await submit(t1, 'Fatanah');
    await submit(t2, 'Hormat');
    const r1 = await request(t1, wrong.id, 'move_target', { target: { type: 'class', id: cls.Hormat } });
    await expect(approveRequest(db, admin, { id: r1.id }, meta, later)).rejects.toMatchObject({
      code: 'ALREADY_EVALUATED',
    });
    expect((await requestRow(r1.id)).status).toBe('waiting');
    await rejectRequest(db, admin, { id: r1.id, note: 'ห้องนั้นมีผลแล้ว' }, meta, later);
    expect((await requestRow(r1.id)).status).toBe('rejected');

    const r2 = await request(t1, wrong.id, 'move_target', { target: { type: 'class', id: cls.Mulia } });
    await approveRequest(db, admin, { id: r2.id }, meta, later);
    expect(await evaluation(wrong.id)).toMatchObject({ targetClassId: cls.Mulia, roomNumberAtEval: '131', version: 2 });
  });

  test('T-Q3: a request applied to an approved evaluation keeps it approved, version + 1, new PDF, old superseded', async () => {
    const e = await submit(t1, 'Ikhlas');
    await approveEvaluation(db, admin, { id: e.id, expectedVersion: 1 }, meta, now);
    const pdfId = newId();
    await db.insert(pdfDocuments).values({
      id: pdfId,
      evaluationId: e.id,
      evaluationVersion: 1,
      docNumber: 'ZW-2569-2-R1-0001',
      version: 1,
      isDraft: true,
      filePath: 'pdf/x.pdf',
    });
    await db.update(evaluations).set({ pdfStatus: 'ready' }).where(eq(evaluations.id, e.id));
    // the owner of an approved evaluation asks even inside the 24 h window (BR-E9)
    const r = await request(t1, e.id, 'edit_comment', { comment: 'แก้ข้อติชมหลังอนุมัติ' }, now);
    await approveRequest(db, admin, { id: r.id }, meta, now);
    expect(await evaluation(e.id)).toMatchObject({
      status: 'approved',
      version: 2,
      comment: 'แก้ข้อติชมหลังอนุมัติ',
      pdfStatus: 'queued',
    });
    const [pdf] = await db.select().from(pdfDocuments).where(eq(pdfDocuments.id, pdfId));
    expect(pdf?.supersededAt).toEqual(now);
  });

  test('edit_photos swaps photos and re-validates counts; delete voids', async () => {
    // Amanah's evaluation from the first test is still live (t1's, window passed at `later`)
    const [e] = await db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.targetClassId, cls.Amanah!), ne(evaluations.status, 'void')));
    if (!e) throw new Error('fixture');
    const current = await db
      .select()
      .from(evidence)
      .where(and(eq(evidence.evaluationId, e.id), eq(evidence.kind, 'site')));
    const fresh = await photos(t2, 1);
    const tooFew = await request(t2, e.id, 'edit_photos', { add: [], remove: [current[0]!.id] });
    await expect(approveRequest(db, admin, { id: tooFew.id }, meta, later)).rejects.toMatchObject({
      field: 'sitePhotos',
      message: 'ต้องถ่ายรูปอีก 1 รูป',
    });
    await rejectRequest(db, admin, { id: tooFew.id }, meta, later);
    const swap = await request(t2, e.id, 'edit_photos', { add: fresh, remove: [current[0]!.id] });
    await approveRequest(db, admin, { id: swap.id }, meta, later);
    const now3 = await db
      .select()
      .from(evidence)
      .where(and(eq(evidence.evaluationId, e.id), eq(evidence.kind, 'site')));
    expect(now3.filter((p) => !p.removedAt).map((p) => p.id)).toContain(fresh[0]);
    expect(now3.find((p) => p.id === current[0]!.id)?.removedAt).not.toBeNull();

    const del = await request(t2, e.id, 'delete', {});
    await approveRequest(db, admin, { id: del.id }, meta, later);
    expect((await evaluation(e.id)).status).toBe('void');
  });
});

describe('late entry (BR-P2) and finalized rounds (BR-Q5)', () => {
  test('only after close and without a live evaluation; grant hours; then the requester may submit', async () => {
    const lateReq = (at: Date) =>
      createRequest(
        db,
        t1,
        {
          type: 'late_entry',
          roundId,
          componentId: roomC,
          target: { type: 'class', id: cls.Hormat! },
          reason: 'ป่วยวันประเมิน',
        },
        meta,
        at,
      );
    // Hormat already has t2's evaluation
    await expect(lateReq(afterClose)).rejects.toMatchObject({ code: 'ALREADY_EVALUATED' });
    const free = (at: Date) =>
      createRequest(
        db,
        t1,
        {
          type: 'late_entry',
          roundId,
          componentId: roomC,
          target: { type: 'class', id: cls.Fatanah! }, // moved away in T-Q2, so free again
          reason: 'ป่วยวันประเมิน',
          payload: { hours: 24 },
        },
        meta,
        at,
      );
    await expect(free(now)).rejects.toMatchObject({ message: 'ยังอยู่ในช่วงลงคะแนน ใส่คะแนนได้เลย' });
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, roundId));
    const r = await oneAudit(() => free(afterClose));
    await expect(free(afterClose)).rejects.toMatchObject({ message: 'มีคำขอประเภทนี้รออนุมัติอยู่แล้ว' });
    await expect(submit(t1, 'Fatanah', afterClose)).rejects.toMatchObject({ code: 'ENTRY_CLOSED' });
    await expect(approveRequest(db, admin, { id: r.id, grantHours: 5 }, meta, afterClose)).rejects.toMatchObject({
      field: 'grantHours',
    });
    const out = await approveRequest(db, admin, { id: r.id, grantHours: 48 }, meta, afterClose);
    expect(out.grantUntil).toEqual(new Date(afterClose.getTime() + 48 * hour));
    expect((await submit(t1, 'Fatanah', new Date(afterClose.getTime() + 47 * hour))).status).toBe('submitted');
  });

  test('BR-Q5: on a finalized round only the super admin asks and decides', async () => {
    const [mulia] = await db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.targetClassId, cls.Mulia!), ne(evaluations.status, 'void')));
    const r = await request(t1, mulia!.id, 'edit_comment', { comment: 'ก่อนปิดรอบ' });
    await db.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, roundId));
    await expect(request(t2, mulia!.id, 'edit_score', { score: 1 })).rejects.toMatchObject({
      message: 'รอบนี้ปิดรอบแล้ว แก้ไขได้เฉพาะผู้ดูแลระบบสูงสุด',
    });
    await expect(approveRequest(db, admin, { id: r.id }, meta, later)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approveRequest(db, root, { id: r.id }, meta, later);
    expect((await evaluation(mulia!.id)).comment).toBe('ก่อนปิดรอบ');
  });
});
