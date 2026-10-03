/** T19: committee read models — my tasks, form context, detail, door QR. */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { evidence, roundClassAreas, rounds, scoreComponents } from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { returnEvaluation, submitEvaluation } from './evaluation.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { getEvaluationDetail, getEvaluationForm, getMyTasks } from './task.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_tasks_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-11-17T03:00:00Z');
const meta = { ip: '10.0.0.12', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let admin: SessionUser;
let t1: SessionUser;
let t2: SessionUser;
let outsider: SessionUser;
let roundId: string;
let roomC: string;
let areaC: string;
let b1: string;
let amanah: string;
let berdikari: string;
let cergas: string;

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

const submit = async (user: SessionUser, classId: string) =>
  submitEvaluation(
    db,
    user,
    {
      roundId,
      componentId: roomC,
      target: { type: 'class', id: classId },
      score: 4,
      siteEvidenceIds: await photos(user, 3),
      signatureEvidenceId: (await photos(user, 1, 'signature'))[0],
    },
    meta,
    now,
  );

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  const root = await signIn('root', 'root-password');
  const mk = async (username: string, displayName: string, role: 'admin' | 'teacher') => {
    const u = await createUser(db, root, { username, displayName, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'แอดมิน', 'admin');
  t1 = await mk('t.one', 'ครูหนึ่ง', 'teacher');
  t2 = await mk('t.two', 'ครูสอง', 'teacher');
  outsider = await mk('t.out', 'ครูนอก', 'teacher');

  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
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
  cergas = await cls(3, 'Cergas');
  const r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121', floor: 2 }, meta, now);
  const r122 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '122', floor: 2 }, meta, now);
  const r131 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '131', floor: 3 }, meta, now);
  for (const [c, r] of [
    [amanah, r121],
    [berdikari, r122],
    [cergas, r131],
  ] as const) {
    await linkClassRoom(db, admin, { classId: c, physicalRoomId: r, effectiveFrom: '2026-11-01' }, meta, now);
  }
  const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await setTermClasses(db, admin, { termId, classIds: [amanah, berdikari, cergas] }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  const comps = await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId));
  roomC = comps.find((c) => c.key === 'room')!.id;
  areaC = comps.find((c) => c.key === 'area')!.id;
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
    { roundId, classId: amanah, areaId: b1, physicalRoomId: r121 },
    { roundId, classId: berdikari, areaId: b1, physicalRoomId: r122 },
    { roundId, classId: cergas, areaId: b1, physicalRoomId: r131 },
  ]);
  for (const u of [t1, t2]) {
    for (const [type, id] of [
      ['class', amanah],
      ['class', berdikari],
      ['class', cergas],
      ['area', b1],
    ] as const) {
      await assignDuty(
        db,
        admin,
        { termId, userId: u.id, duty: 'committee', targetType: type, targetId: id },
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

describe('getMyTasks (§6.7)', () => {
  test('one row per target × matching component; labels, subtitles, links', async () => {
    const tasks = await getMyTasks(db, t1, now);
    expect(tasks.round).toMatchObject({ roundNo: 1, entryOpen: true });
    expect(tasks.items.map((i) => `${i.target.roomNumber ?? '-'} ${i.target.label} ${i.componentLabel}`)).toEqual([
      '121 ม.1 Amanah คะแนนห้องเรียน',
      '122 ม.1 Berdikari คะแนนห้องเรียน',
      '131 ม.1 Cergas คะแนนห้องเรียน',
      '- อาคาร 1 คะแนนอาคาร',
    ]);
    expect(tasks.items[0]).toMatchObject({
      status: 'not_evaluated',
      href: `/evaluate/new?round=${roundId}&component=${roomC}&target=class:${amanah}`,
      target: { subtitle: 'อาคาร 1 ชั้น 2' },
    });
    expect(tasks.items[3]!.target.subtitle).toBe('3 ห้องรับผิดชอบ');
    expect((await getMyTasks(db, outsider, now)).items).toEqual([]);
  });

  test('statuses, owner names, returned first', async () => {
    const a = await submit(t1, amanah);
    const c = await submit(t2, cergas);
    await returnEvaluation(db, admin, { id: c.id, expectedVersion: 1, reason: 'รูปไม่ชัดเจน' }, meta, now);
    const mine = await getMyTasks(db, t1, now);
    expect(mine.items.map((i) => [i.target.roomNumber, i.status, i.mine, i.ownerName])).toEqual([
      ['131', 'returned', false, 'ครูสอง'],
      ['122', 'not_evaluated', false, null],
      [null, 'not_evaluated', false, null],
      ['121', 'submitted', true, 'ครูหนึ่ง'],
    ]);
    expect(mine.items.find((i) => i.target.roomNumber === '121')!.href).toBe(`/evaluate/${a.id}`);
  });
});

describe('form, detail, QR', () => {
  test('form context: rules of the component; duty required; existing evaluation reported', async () => {
    const f = await getEvaluationForm(
      db,
      t1,
      { roundId, componentId: roomC, target: { type: 'class', id: berdikari } },
      now,
    );
    expect(f).toMatchObject({
      max: 5000,
      step: 500,
      photoMin: 3,
      photoMax: 5,
      requiresSignature: true,
      canEnter: true,
      existingId: null,
      target: { roomNumber: '122', label: 'ม.1 Berdikari' },
    });
    const area = await getEvaluationForm(
      db,
      t1,
      { roundId, componentId: areaC, target: { type: 'area', id: b1 } },
      now,
    );
    expect(area).toMatchObject({ requiresSignature: false, max: 10000 });
    await expect(
      getEvaluationForm(db, outsider, { roundId, componentId: roomC, target: { type: 'class', id: berdikari } }, now),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const done = await getEvaluationForm(
      db,
      t2,
      { roundId, componentId: roomC, target: { type: 'class', id: amanah } },
      now,
    );
    expect(done.existingId).not.toBeNull();
    const late = await getEvaluationForm(
      db,
      t1,
      { roundId, componentId: roomC, target: { type: 'class', id: berdikari } },
      new Date('2026-11-21T00:00:00Z'),
    );
    expect(late.canEnter).toBe(false);
  });

  test('detail: owner may edit inside the window; other committee member reads; outsider refused', async () => {
    const tasks = await getMyTasks(db, t1, now);
    const id = tasks.items.find((i) => i.target.roomNumber === '121')!.evaluationId!;
    const own = await getEvaluationDetail(db, t1, id, now);
    expect(own).toMatchObject({
      isOwner: true,
      canEdit: true,
      score: '4.000',
      ownerName: 'ครูหนึ่ง',
      status: 'submitted',
    });
    expect(own.photos).toHaveLength(4);
    expect(own.photos[0]!.thumb).toMatch(/^\/api\/v1\/files\/.+\?w=320$/);
    expect(own.history.map((h) => h.action)).toEqual(['evaluation.submit']);
    expect((await getEvaluationDetail(db, t1, id, new Date(now.getTime() + 25 * 3600_000))).canEdit).toBe(false);
    expect((await getEvaluationDetail(db, t2, id, now)).canEdit).toBe(false);
    expect((await getEvaluationDetail(db, admin, id, now)).isOwner).toBe(false);
    await expect(getEvaluationDetail(db, outsider, id, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
