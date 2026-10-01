/** T23b: monitor board scope, counters, filters, popover, activity feed and PDF retry against PostgreSQL. */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { auditLogs, evaluations, requests, roundClassAreas, rounds, scoreComponents } from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { COUNTERS, getActivity, getBoard, getTargetDetail, MONITOR_MSG, retryPdf } from './monitor.service.ts';
import { listMyRequests, listRequestLog } from './request.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_mon_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-11-18T03:00:00Z'); // round 1 is open
const meta = { ip: '10.0.0.24', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let admin: SessionUser;
let adminCommittee: SessionUser;
let executive: SessionUser;
let t1: SessionUser;
let t2: SessionUser;
let outsider: SessionUser;
let termId: string;
let roundId: string;
let A: string;
let B: string;
let b1: string;
let b2: string;
let evalA: string;
let evalB: string;

async function evaluation(classId: string, status: 'approved' | 'submitted', room: string, owner: SessionUser) {
  const id = newId();
  const comps = await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId));
  await db.insert(evaluations).values({
    id,
    roundId,
    componentId: comps.find((c) => c.key === 'room')!.id,
    targetType: 'class',
    targetClassId: classId,
    ownerId: owner.id,
    score: '4.500',
    roomNumberAtEval: room,
    status,
    firstSubmittedAt: now,
    selfEditUntil: now,
    lastEditedAt: now,
    approvedBy: status === 'approved' ? admin.id : null,
    approvedAt: status === 'approved' ? now : null,
    pdfStatus: status === 'approved' ? 'failed' : 'none',
    pdfError: status === 'approved' ? 'chromium crashed' : null,
  });
  return id;
}

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  const su = await signIn('root', 'root-password');
  const mk = async (username: string, displayName: string, role: 'admin' | 'teacher' | 'executive') => {
    const u = await createUser(db, su, { username, displayName, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'แอดมิน', 'admin');
  adminCommittee = await mk('adm.c', 'แอดมินกรรมการ', 'admin');
  executive = await mk('exe', 'ผู้บริหาร', 'executive');
  t1 = await mk('t.one', 'ครูหนึ่ง', 'teacher');
  t2 = await mk('t.two', 'ครูสอง', 'teacher');
  outsider = await mk('t.out', 'ครูนอก', 'teacher');
  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  b2 = await upsertArea(db, admin, { type: 'building', code: '2', name: 'อาคาร 2' }, meta, now);
  const r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121', floor: 2 }, meta, now);
  const r221 = await upsertPhysicalRoom(db, admin, { buildingId: b2, roomNumber: '221', floor: 2 }, meta, now);
  A = await upsertClass(
    db,
    admin,
    { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 1, name: 'Amanah' },
    meta,
    now,
  );
  B = await upsertClass(
    db,
    admin,
    { track: 'general', gradeCode: 'M2', gradeLabel: 'ม.2', rankGroup: 'ม.2', roomNo: 1, name: 'Berdikari' },
    meta,
    now,
  );
  await linkClassRoom(db, admin, { classId: A, physicalRoomId: r121, effectiveFrom: '2026-11-01' }, meta, now);
  await linkClassRoom(db, admin, { classId: B, physicalRoomId: r221, effectiveFrom: '2026-11-01' }, meta, now);
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
    status: 'open',
  });
  await db.insert(roundClassAreas).values([
    { roundId, classId: A, areaId: b1, physicalRoomId: r121 },
    { roundId, classId: B, areaId: b2, physicalRoomId: r221 },
  ]);
  const duty = (userId: string, targetType: 'class' | 'area', targetId: string, until?: Date) =>
    assignDuty(
      db,
      admin,
      {
        termId,
        userId,
        duty: 'committee',
        targetType,
        targetId,
        ...(until ? { isFreelance: true, validUntil: until } : {}),
      },
      meta,
      now,
    );
  await duty(t1.id, 'class', A);
  await duty(t1.id, 'area', b1);
  await duty(t2.id, 'class', B);
  await duty(adminCommittee.id, 'class', A, new Date('2026-11-25T10:00:00Z'));
  evalA = await evaluation(A, 'approved', '121', t1);
  evalB = await evaluation(B, 'submitted', '221', t2);
  const comps = await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId));
  await db.insert(requests).values({
    id: newId(),
    type: 'edit_score',
    requesterId: t2.id,
    roundId,
    componentId: comps.find((c) => c.key === 'room')!.id,
    evaluationId: evalB,
    targetType: 'class',
    targetClassId: B,
    reason: 'กดคะแนนผิด',
    payload: { score: '3.000' },
  });
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

const labels = (rows: { target: { roomNumber: string | null; label: string }; componentLabel: string }[]) =>
  rows.map((r) => `${r.target.roomNumber ? `${r.target.roomNumber} · ` : ''}${r.target.label}`);

describe('board (08-ux-ui §6.17)', () => {
  test('staff see every target; counters match the rows each one filters to', async () => {
    const board = await getBoard(db, admin, {}, now);
    expect(board.round).toMatchObject({ id: roundId, roundNo: 1 });
    expect(labels(board.rows)).toEqual(['121 · ม.1 Amanah', '221 · ม.2 Berdikari', 'อาคาร 1', 'อาคาร 2']);
    expect(board.counters).toEqual({
      not_evaluated: 2,
      submitted: 1,
      returned: 0,
      approved: 1,
      pdf_queued: 0,
      pdf_failed: 1,
      request: 1,
    });
    for (const status of COUNTERS) {
      const filtered = await getBoard(db, admin, { filters: { status } }, now);
      expect(filtered.rows.length, status).toBe(board.counters[status]);
    }
    const a = board.rows[0]!;
    expect(a).toMatchObject({
      status: 'approved',
      pdfStatus: 'failed',
      pdfError: 'chromium crashed',
      ownerName: 'ครูหนึ่ง',
    });
    expect(a.committee.map((c) => [c.name, c.until])).toEqual([
      ['ครูหนึ่ง', null],
      ['แอดมินกรรมการ', new Date('2026-11-25T10:00:00Z')],
    ]);
    expect(board.rows[1]).toMatchObject({ status: 'submitted', waitingRequest: 'แก้คะแนน', score: '4.5' });
    expect(board.canAct).toBe(true);
    expect(board.options.groups).toEqual(['ม.1', 'ม.2']);
  });

  test('filters combine (group, area, committee, room search) and counters follow them', async () => {
    const g = await getBoard(db, admin, { filters: { group: 'ม.1', area: b1 } }, now);
    expect(labels(g.rows)).toEqual(['121 · ม.1 Amanah']);
    expect(g.counters.approved).toBe(1);
    expect(g.counters.submitted).toBe(0);
    expect(labels((await getBoard(db, admin, { filters: { area: b2 } }, now)).rows)).toEqual([
      '221 · ม.2 Berdikari',
      'อาคาร 2',
    ]);
    expect(labels((await getBoard(db, admin, { filters: { committee: t2.id } }, now)).rows)).toEqual([
      '221 · ม.2 Berdikari',
    ]);
    expect(labels((await getBoard(db, admin, { filters: { q: '221' } }, now)).rows)).toEqual(['221 · ม.2 Berdikari']);
  });

  test('a teacher-committee sees only assigned targets; another target is FORBIDDEN; no duty → FORBIDDEN', async () => {
    const mine = await getBoard(db, t1, {}, now);
    expect(labels(mine.rows)).toEqual(['121 · ม.1 Amanah', 'อาคาร 1']);
    expect(mine.counters.submitted).toBe(0);
    expect(mine.canAct).toBe(false);
    expect(mine.canToggleMine).toBe(false);
    await expect(getTargetDetail(db, t1, { type: 'class', id: B }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getBoard(db, outsider, {}, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('an admin who is also committee sees everything and can narrow to "เฉพาะที่ฉันรับผิดชอบ"', async () => {
    const all = await getBoard(db, adminCommittee, {}, now);
    expect(all.rows).toHaveLength(4);
    expect(all.canToggleMine).toBe(true);
    const mine = await getBoard(db, adminCommittee, { filters: { mine: true } }, now);
    expect(mine.mine).toBe(true);
    expect(labels(mine.rows)).toEqual(['121 · ม.1 Amanah']);
    expect((await getBoard(db, admin, { filters: { mine: true } }, now)).rows).toHaveLength(4); // no duty: ignored
  });

  test('executive: same rows, no actions', async () => {
    const board = await getBoard(db, executive, {}, now);
    expect(board.rows).toHaveLength(4);
    expect(board.canAct).toBe(false);
  });
});

describe('target popover', () => {
  test('every assigned committee member, the evaluator, approver and the waiting request', async () => {
    const a = await getTargetDetail(db, t1, { type: 'class', id: A }, now);
    expect(a.target).toMatchObject({ roomNumber: '121', label: 'ม.1 Amanah', subtitle: 'อาคาร 1 ชั้น 2' });
    expect(a.committee.map((c) => c.name)).toEqual(['ครูหนึ่ง', 'แอดมินกรรมการ']);
    expect(a.items).toEqual([
      expect.objectContaining({
        status: 'approved',
        ownerName: 'ครูหนึ่ง',
        approverName: 'แอดมิน',
        href: `/evaluate/${evalA}`,
      }),
    ]);
    const b = await getTargetDetail(db, admin, { type: 'class', id: B }, now);
    expect(b.requests).toEqual([{ label: 'แก้คะแนน', requesterName: 'ครูสอง' }]);
    const area = await getTargetDetail(db, admin, { type: 'area', id: b2 }, now);
    expect(area.items[0]).toMatchObject({ status: 'not_evaluated', ownerName: null });
    expect(area.committee).toEqual([]);
  });
});

describe('PDF retry ("สร้างใหม่")', () => {
  test('a failed PDF goes back to the queue; counters move from ล้มเหลว to กำลังสร้าง', async () => {
    await expect(retryPdf(db, executive, evalA, meta, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await retryPdf(db, admin, evalA, meta, now);
    const [e] = await db.select().from(evaluations).where(eq(evaluations.id, evalA));
    expect(e).toMatchObject({ pdfStatus: 'queued', pdfError: null });
    const board = await getBoard(db, admin, {}, now);
    expect(board.counters).toMatchObject({ pdf_failed: 0, pdf_queued: 1 });
    await expect(retryPdf(db, admin, evalA, meta, now)).rejects.toMatchObject({ message: MONITOR_MSG.notFailed });
  });
});

describe('activity feed (11-jobs §2b)', () => {
  test('latest round events, newest first, limited to the viewer scope', async () => {
    await db.insert(auditLogs).values([
      {
        at: new Date(now.getTime() - 60_000),
        actorId: t2.id,
        action: 'evaluation.submit',
        entity: 'evaluation',
        entityId: evalB,
        after: { score: '4.5' },
      },
      { at: now, actorId: admin.id, action: 'evaluation.approve', entity: 'evaluation', entityId: evalA, after: {} },
    ]);
    const all = await getActivity(db, admin, {}, now);
    expect(all.map((i) => i.text)).toEqual([
      'แอดมิน อนุมัติผลประเมิน 121 · ม.1 Amanah',
      'ครูสอง ใส่คะแนน 221 · ม.2 Berdikari ได้ 4.5',
    ]);
    expect(all[0]!.href).toBe(`/evaluate/${evalA}`);
    expect((await getActivity(db, t1, {}, now)).map((i) => i.text)).toEqual([
      'แอดมิน อนุมัติผลประเมิน 121 · ม.1 Amanah',
    ]);
    expect(await getActivity(db, admin, { since: now }, now)).toEqual([]);
  });
});

describe('requests log and "คำขอของฉัน" (§6.18–6.19)', () => {
  test('staff filter the term log; teachers only see their own requests', async () => {
    const log = await listRequestLog(db, executive, { status: 'waiting', type: 'edit_score' });
    expect(log.cards.map((c) => [c.typeLabel, c.target.label, c.requesterName, c.oldValue, c.newValue])).toEqual([
      ['แก้คะแนน', 'ม.2 Berdikari', 'ครูสอง', '4.5', '3'],
    ]);
    expect(log.requesters).toEqual([{ id: t2.id, name: 'ครูสอง' }]);
    expect((await listRequestLog(db, admin, { status: 'approved' })).cards).toEqual([]);
    await expect(listRequestLog(db, t2, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listMyRequests(db, t2, now)).map((r) => [r.status, r.lateEntry])).toEqual([['waiting', null]]);
    expect(await listMyRequests(db, t1, now)).toEqual([]);
  });
});
