/** T27: ปพ.5 API data (finalized rounds only, §3.3 shape), API keys and the network guard. */
import { randomBytes } from 'node:crypto';
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
import { setTermClasses, upsertArea, upsertClass } from './place.service.ts';
import {
  authorizePp5,
  createApiKey,
  getPp5Classes,
  getPp5Students,
  listApiKeys,
  listPp5Terms,
  pp5ClassesCsv,
  pp5StudentsCsv,
  pp5TermsCsv,
  revokeApiKey,
} from './pp5.service.ts';
import { finalizeRound } from './result.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_pp5_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-12-20T02:00:00Z');
const meta = { ip: '10.0.0.28', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let admin: SessionUser;
let executive: SessionUser;
let termId: string;
let A: string;
let r1: string;
let r2: string;

async function approved(
  roundId: string,
  target: { classId?: string; areaId?: string },
  key: 'room' | 'area',
  score: string,
) {
  const comps = await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId));
  await db.insert(evaluations).values({
    id: newId(),
    roundId,
    componentId: comps.find((c) => c.key === key)!.id,
    targetType: target.classId ? 'class' : 'area',
    targetClassId: target.classId ?? null,
    targetAreaId: target.areaId ?? null,
    ownerId: admin.id,
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
  const b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  A = await upsertClass(
    db,
    admin,
    { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 1, name: 'Amanah' },
    meta,
    now,
  );
  termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await setTermClasses(db, admin, { termId, classIds: [A] }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  [r1, r2] = [newId(), newId()];
  await db.insert(rounds).values([
    {
      id: r1,
      termId,
      roundNo: 1,
      opensAt: new Date('2026-11-16T01:00:00Z'),
      closesAt: new Date('2026-11-20T09:30:00Z'),
      status: 'closed',
    },
    {
      id: r2,
      termId,
      roundNo: 2,
      opensAt: new Date('2026-12-14T01:00:00Z'),
      closesAt: new Date('2026-12-18T09:30:00Z'),
      status: 'closed',
    },
  ]);
  for (const r of [r1, r2]) await db.insert(roundClassAreas).values({ roundId: r, classId: A, areaId: b1 });
  await approved(r1, { classId: A }, 'room', '4.000');
  await approved(r1, { areaId: b1 }, 'area', '9.000');
  await approved(r2, { classId: A }, 'room', '5.000');
  await approved(r2, { areaId: b1 }, 'area', '7.000');
  const studentId = newId();
  await db.insert(students).values({
    id: studentId,
    studentCode: '65001',
    fullName: 'ด.ช.สมมติ ไม่ส่งออก',
    homeClassId: A,
    generalClassId: A,
    deleteAfter: '2027-12-20',
  });
  await db.insert(rosterSnapshots).values({ roundId: r1, studentId, classId: A });
  await finalizeRound(db, admin, { roundId: r1 }, meta, now); // round 2 stays closed, not finalized
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('ปพ.5 data (05-api §3.3)', () => {
  test('terms list', async () => {
    expect(await listPp5Terms(db)).toEqual([
      {
        termId,
        academicYear: 2569,
        termNo: 2,
        finalMax: expect.stringMatching(/^\d+\.\d{2}$/),
        roundsFinalized: [1],
        roundsTotal: 2,
      },
    ]);
  });

  test('classes: only finalized rounds, the documented shape, scores with 2 decimals', async () => {
    const out = await getPp5Classes(db, termId, now);
    expect(out).toMatchObject({
      academicYear: 2569,
      termNo: 2,
      roundsFinalized: [1],
      roundsTotal: 2,
      termComplete: false,
      generatedAt: '2026-12-20T09:00:00+07:00',
    });
    expect(out.classes).toEqual([
      {
        classId: A,
        track: 'general',
        grade: 'ม.1',
        name: 'Amanah',
        display: 'ม.1 Amanah',
        sourceClassKey: 'ม.1/1 Amanah',
        rounds: [{ roundNo: 1, classScore: '4.00', areaScore: '9.00', total: '13.00' }],
        termScore: expect.stringMatching(/^\d+\.\d{2}$/),
      },
    ]);
    // round 2 (5 + 7 = 12) appears only once it is finalized, then the term is complete
    await finalizeRound(db, admin, { roundId: r2 }, meta, now);
    const all = await getPp5Classes(db, termId, now);
    expect(all.roundsFinalized).toEqual([1, 2]);
    expect(all.termComplete).toBe(true);
    expect(all.classes[0]!.rounds.map((r) => r.total)).toEqual(['13.00', '12.00']);
  });

  test('students: codes only (no names), per finalized round', async () => {
    const out = await getPp5Students(db, termId, now);
    expect(out.students).toEqual([
      {
        studentCode: '65001',
        homeClassKey: 'ม.1/1 Amanah',
        rounds: [{ roundNo: 1, classKey: 'ม.1/1 Amanah', total: '13.00' }],
        termScore: expect.stringMatching(/^\d+\.\d{2}$/),
      },
    ]);
    expect(JSON.stringify(out)).not.toContain('สมมติ');
  });

  test('students without any roster → 404 NOT_AVAILABLE', async () => {
    const other = await createTerm(db, admin, { academicYear: 2570, termNo: 1 }, meta, now);
    await expect(getPp5Students(db, other, now)).rejects.toMatchObject({ code: 'NOT_AVAILABLE' });
    await expect(getPp5Classes(db, newId(), now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('CSV for the ปพ.5 program', () => {
  test('fixed columns, one row per class (or student) per finalized round', async () => {
    const classes = pp5ClassesCsv(await getPp5Classes(db, termId, now));
    expect(classes[0]).toEqual([
      'academic_year',
      'term_no',
      'term_complete',
      'final_max',
      'class_id',
      'track',
      'grade',
      'class_name',
      'display',
      'source_class_key',
      'round_no',
      'class_score',
      'area_score',
      'round_total',
      'term_score',
    ]);
    expect(classes.slice(1).map((r) => [r[9], r[10], r[11], r[12], r[13]])).toEqual([
      ['ม.1/1 Amanah', 1, '4.00', '9.00', '13.00'],
      ['ม.1/1 Amanah', 2, '5.00', '7.00', '12.00'],
    ]);
    expect(classes[1]!.slice(0, 3)).toEqual([2569, 2, true]);
    const st = pp5StudentsCsv(await getPp5Students(db, termId, now));
    expect(st.slice(1)).toEqual([
      [2569, 2, true, '65001', 'ม.1/1 Amanah', 1, 'ม.1/1 Amanah', '13.00', expect.any(String)],
    ]);
    expect(JSON.stringify(st)).not.toContain('สมมติ');
    expect(pp5TermsCsv(await listPp5Terms(db)).find((r) => r[0] === termId)).toEqual([
      termId,
      2569,
      2,
      expect.any(String),
      '1|2',
      2,
    ]);
  });
});

describe('API keys and the network guard', () => {
  test('keys are shown once, stored hashed, revocable; network and key are both required', async () => {
    await expect(createApiKey(db, executive, { name: 'x' }, meta, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { id, key } = await createApiKey(db, admin, { name: 'ปพ.5 program' }, meta, now);
    expect(key).toMatch(/^zw_pp5_[A-Za-z0-9_-]{32}$/);
    const listed = await listApiKeys(db, executive);
    expect(listed).toEqual([expect.objectContaining({ id, name: 'ปพ.5 program', revokedAt: null })]);
    expect(JSON.stringify(listed)).not.toContain(key);

    const lan = ['10.0.0.0/8', '192.168.0.0/16'];
    const ok = await authorizePp5(db, { ip: '192.168.1.20', authorization: `Bearer ${key}` }, now, lan);
    expect(ok.id).toBe(id);
    await expect(
      authorizePp5(db, { ip: '203.0.113.9', authorization: `Bearer ${key}` }, now, lan),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(authorizePp5(db, { ip: '10.1.1.1', authorization: 'Bearer wrong' }, now, lan)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(authorizePp5(db, { ip: '10.1.1.1', authorization: null }, now, lan)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await revokeApiKey(db, admin, id, meta, now);
    await expect(authorizePp5(db, { ip: '10.1.1.1', authorization: `Bearer ${key}` }, now, lan)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect((await listApiKeys(db, admin))[0]!.lastUsedAt).toEqual(now);
  });
});
