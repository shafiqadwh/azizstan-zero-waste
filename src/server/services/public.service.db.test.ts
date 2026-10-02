/** T24: public read models and admin-managed content against PostgreSQL. */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import {
  evaluations,
  rosterSnapshots,
  roundClassAreas,
  rounds,
  scoreComponents,
  students,
} from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { CONTENT_MSG, deleteOrder, readOrderFile, saveGuidePage, uploadOrder } from './content.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import {
  getClassScores,
  getPublicGuidePage,
  getPublicSummary,
  getRankings,
  getSeries,
  listPublicAreas,
  listPublicClasses,
  listPublicGuide,
  listPublicOrders,
} from './public.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_pub_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-11-18T03:00:00Z');
const meta = { ip: '10.0.0.25', userAgent: 'vitest' };
const STUDENT_NAME = 'เด็กชายทดสอบ ไม่ควรปรากฏ';
const TEACHER_NAME = 'ครูผู้ประเมินลับ';
let db: Db;
let close: () => Promise<void>;
let root: string;
let admin: SessionUser;
let teacher: SessionUser;
let roundId: string;
let A: string;
let B: string;
let C: string;
let b1: string;

async function approved(target: { classId?: string; areaId?: string }, key: 'room' | 'area', score: string) {
  const comps = await db.select().from(scoreComponents);
  await db.insert(evaluations).values({
    id: newId(),
    roundId,
    componentId: comps.find((c) => c.key === key)!.id,
    targetType: target.classId ? 'class' : 'area',
    targetClassId: target.classId ?? null,
    targetAreaId: target.areaId ?? null,
    ownerId: teacher.id,
    score,
    status: 'approved',
    firstSubmittedAt: now,
    selfEditUntil: now,
    lastEditedAt: now,
    approvedBy: admin.id,
    approvedAt: now,
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'zw-pub-'));
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  const su = await signIn('root', 'root-password');
  const mk = async (username: string, displayName: string, role: 'admin' | 'teacher') => {
    const u = await createUser(db, su, { username, displayName, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'แอดมินลับ', 'admin');
  teacher = await mk('t.one', TEACHER_NAME, 'teacher');
  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  const b2 = await upsertArea(db, admin, { type: 'building', code: '2', name: 'อาคาร 2' }, meta, now);
  const room = (b: string, n: string) =>
    upsertPhysicalRoom(db, admin, { buildingId: b, roomNumber: n, floor: 1 }, meta, now);
  const r121 = await room(b1, '121');
  const r122 = await room(b1, '122');
  const r221 = await room(b2, '221');
  const cls = (gradeCode: string, rankGroup: string, roomNo: number, name: string) =>
    upsertClass(db, admin, { track: 'general', gradeCode, gradeLabel: rankGroup, rankGroup, roomNo, name }, meta, now);
  A = await cls('M1', 'ม.1', 1, 'Amanah');
  B = await cls('M1', 'ม.1', 2, 'Berdikari');
  C = await cls('M2', 'ม.2', 1, 'Cemerlang');
  for (const [c, r] of [
    [A, r121],
    [B, r122],
    [C, r221],
  ] as const)
    await linkClassRoom(db, admin, { classId: c, physicalRoomId: r, effectiveFrom: '2026-11-01' }, meta, now);
  const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await setTermClasses(db, admin, { termId, classIds: [A, B, C] }, meta, now);
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
    { roundId, classId: B, areaId: b1, physicalRoomId: r122 },
    { roundId, classId: C, areaId: b2, physicalRoomId: r221 },
  ]);
  await approved({ classId: A }, 'room', '4.500');
  await approved({ classId: B }, 'room', '3.000');
  await approved({ classId: C }, 'room', '5.000');
  await approved({ areaId: b1 }, 'area', '8.000');
  const studentId = newId();
  await db.insert(students).values({
    id: studentId,
    studentCode: '65001',
    fullName: STUDENT_NAME,
    homeClassId: A,
    deleteAfter: '2027-11-18',
  });
  await db.insert(rosterSnapshots).values({ roundId, studentId, classId: A });
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await rm(root, { recursive: true, force: true });
});

describe('public read models (05-api §3.1)', () => {
  test('summary: current round and progress', async () => {
    const s = await getPublicSummary(db, now);
    expect(s.term).toMatchObject({ termNo: 2, academicYear: 2569, areaWord: 'อาคาร' });
    expect(s.round).toMatchObject({ roundNo: 1, status: 'open', closesAt: '2026-11-20T09:30:00.000Z' });
    expect(s.progress).toEqual({ classesDone: 3, classesTotal: 3, areasDone: 1, areasTotal: 2 });
    expect(s.allFinalized).toBe(false);
  });

  test('round rankings per rank group with ties-ready ranks; unscored = null ("รอผล"); areas in one list', async () => {
    const r = await getRankings(db, { roundNo: 1 }, now);
    expect(r.roundNo).toBe(1);
    expect(r.groups).toEqual([
      {
        group: 'ม.1',
        rows: [
          { rank: 1, classId: A, display: 'ม.1 Amanah', roomNumber: '121', score: '12.5' },
          { rank: 2, classId: B, display: 'ม.1 Berdikari', roomNumber: '122', score: '11' },
        ],
      },
      { group: 'ม.2', rows: [{ rank: null, classId: C, display: 'ม.2 Cemerlang', roomNumber: '221', score: null }] },
    ]);
    expect(r.areas.map((a) => [a.name, a.rank, a.score])).toEqual([
      ['อาคาร 1', 1, '8'],
      ['อาคาร 2', null, null],
    ]);
    const term = await getRankings(db, {}, now);
    expect(term.roundNo).toBeNull();
    expect(term.groups[0]!.rows.map((x) => [x.display, x.rank])).toEqual([
      ['ม.1 Amanah', 1],
      ['ม.1 Berdikari', 2],
    ]);
    expect(term.hasScores).toBe(true);
  });

  test('class scores and areas with their classes', async () => {
    expect((await listPublicClasses(db, now)).map((c) => [c.grade, c.roomNumber, c.display])).toEqual([
      ['ม.1', '121', 'ม.1 Amanah'],
      ['ม.1', '122', 'ม.1 Berdikari'],
      ['ม.2', '221', 'ม.2 Cemerlang'],
    ]);
    const a = await getClassScores(db, A, now);
    expect(a).toMatchObject({ display: 'ม.1 Amanah', roomNumber: '121', areaWord: 'อาคาร' });
    expect(a!.rounds).toEqual([{ roundNo: 1, classScore: '4.5', areaScore: '8', total: '12.5' }]);
    expect(a!.termScore).not.toBeNull();
    expect((await getClassScores(db, C, now))!.rounds[0]).toMatchObject({ total: null });
    expect(await getClassScores(db, newId(), now)).toBeNull();
    const { areas } = await listPublicAreas(db, now);
    expect(areas.map((x) => [x.name, x.rounds, x.classes.map((c) => c.display)])).toEqual([
      ['อาคาร 1', [{ roundNo: 1, score: '8' }], ['ม.1 Amanah', 'ม.1 Berdikari']],
      ['อาคาร 2', [{ roundNo: 1, score: null }], ['ม.2 Cemerlang']],
    ]);
  });

  test('chart series (§6.5): one point per started round with its maximum; unknown targets are null', async () => {
    const a = await getSeries(db, { type: 'class', id: A }, now);
    expect(a).toMatchObject({ type: 'class', title: '121 · ม.1 Amanah', areaWord: 'อาคาร' });
    expect(a!.points).toEqual([{ roundNo: 1, value: 12.5, label: '12.5', max: expect.any(Number) }]);
    expect(a!.yMax).toBe(a!.points[0]!.max);
    expect(a!.yMax).toBeGreaterThan(12.5);
    expect((await getSeries(db, { type: 'class', id: C }, now))!.points[0]).toMatchObject({ value: null, label: null });
    const area = await getSeries(db, { type: 'area', id: b1 }, now);
    expect(area).toMatchObject({ title: 'อาคาร 1', points: [{ roundNo: 1, value: 8, label: '8' }] });
    expect(await getSeries(db, { type: 'class', id: newId() }, now)).toBeNull();
    expect(await getSeries(db, { type: 'area', id: newId() }, now)).toBeNull();
  });

  test('no person ever appears: no evaluator, approver or student names in any public payload', async () => {
    const payloads = JSON.stringify([
      await getPublicSummary(db, now),
      await getRankings(db, { roundNo: 1 }, now),
      await getRankings(db, {}, now),
      await listPublicClasses(db, now),
      await getClassScores(db, A, now),
      await listPublicAreas(db, now),
    ]);
    for (const name of [STUDENT_NAME, TEACHER_NAME, 'แอดมินลับ', '65001']) expect(payloads).not.toContain(name);
    expect(payloads).not.toContain('/api/v1/files/');
  });
});

describe('content (orders and guide)', () => {
  const pdf = new Uint8Array(Buffer.from('%PDF-1.7 test order'));

  test('orders: admins upload PDFs; the public list links them; non-PDF and teachers are refused', async () => {
    await expect(
      uploadOrder(db, admin, { title: 'คำสั่ง', file: new Uint8Array(Buffer.from('hello')) }, meta, now, { root }),
    ).rejects.toMatchObject({ message: CONTENT_MSG.notPdf });
    await expect(uploadOrder(db, teacher, { title: 'x', file: pdf }, meta, now, { root })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const { id } = await uploadOrder(db, admin, { title: 'คำสั่งที่ 23/2569', file: pdf }, meta, now, { root });
    expect(await listPublicOrders(db)).toEqual([{ id, title: 'คำสั่งที่ 23/2569', url: `/api/v1/orders/${id}` }]);
    expect((await readOrderFile(db, id, { root })).data.toString()).toBe('%PDF-1.7 test order');
    await deleteOrder(db, admin, id, meta, now, { root });
    expect(await listPublicOrders(db)).toEqual([]);
    await expect(readOrderFile(db, id, { root })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('guide: unique slugs; only public pages are listed and readable', async () => {
    const page = {
      slug: 'how-to',
      title: 'ดูอันดับอย่างไร',
      bodyMd: '# หัวข้อ\n\nข้อความ',
      audience: 'public' as const,
    };
    const { id } = await saveGuidePage(db, admin, page, meta, now);
    await saveGuidePage(db, admin, { ...page, slug: 'committee-only', audience: 'committee' }, meta, now);
    await expect(saveGuidePage(db, admin, { ...page, title: 'ซ้ำ' }, meta, now)).rejects.toMatchObject({
      message: CONTENT_MSG.slugTaken,
    });
    await expect(saveGuidePage(db, admin, { ...page, slug: 'Bad Slug' }, meta, now)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await saveGuidePage(db, admin, { ...page, id, title: 'ดูอันดับ' }, meta, now);
    const listed = await listPublicGuide(db);
    expect(listed).toContainEqual({ slug: 'how-to', title: 'ดูอันดับ' });
    expect(listed.map((g) => g.slug)).not.toContain('committee-only');
    // the default pages from migration 0006 (sort order 10–40) follow the new page (sort order 0)
    expect(listed.map((g) => g.slug)).toEqual(['how-to', 'how-scores-work', 'committee-guide', 'faq', 'privacy']);
    expect(await getPublicGuidePage(db, 'how-to')).toMatchObject({ bodyMd: '# หัวข้อ\n\nข้อความ' });
    expect(await getPublicGuidePage(db, 'committee-only')).toBeNull();
  });
});

describe('evaluation data stays unpublished until approved', () => {
  test('a submitted evaluation does not move the public ranking', async () => {
    const comps = await db.select().from(scoreComponents);
    await db
      .update(evaluations)
      .set({ status: 'submitted' })
      .where(eq(evaluations.componentId, comps.find((c) => c.key === 'area')!.id));
    const r = await getRankings(db, { roundNo: 1 }, now);
    expect(r.groups[0]!.rows.every((x) => x.score === null)).toBe(true);
    expect(r.areas.every((a) => a.score === null)).toBe(true);
  });
});
