/** T14: terms, components and rounds against PostgreSQL (T-TM1, T-TM2, AC items). */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { newId } from '../../lib/ids.ts';
import { parseScore as p } from '../../lib/scoring/decimal.ts';
import { termScoreByRound } from '../../lib/scoring/index.ts';
import { roundMaxima, scoreStepFor } from '../../lib/term/config.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import * as places from '../repositories/places.repository.ts';
import * as repo from '../repositories/terms.repository.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { setTermClasses, upsertClass } from './place.service.ts';
import {
  activateTerm,
  componentsInUseForTerm,
  createTerm,
  getTermSettings,
  setRoundCount,
  updateRoundDates,
  updateScoring,
  updateTermConfig,
} from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_terms_${randomBytes(4).toString('hex')}`;
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
const now = new Date('2026-10-01T03:00:00Z');
let admin: SessionUser;
let executive: SessionUser;
const limiter = () => ({ limiter: new LoginRateLimiter() });

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  const root = (await login(db, { username: 'root', password: 'root-password' }, meta, now, limiter())).user;
  const a = await createUser(db, root, { username: 'adm', displayName: 'แอดมิน', role: 'admin' }, meta, now);
  const e = await createUser(db, root, { username: 'exe', displayName: 'ผู้บริหาร', role: 'executive' }, meta, now);
  admin = (await login(db, { username: 'adm', password: a.tempPassword! }, meta, now, limiter())).user;
  executive = (await login(db, { username: 'exe', password: e.tempPassword! }, meta, now, limiter())).user;
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

const configOf = (termId: string, over: Record<string, unknown> = {}) => ({
  termId,
  areaType: 'building' as const,
  roomMode: 'group' as const,
  areaMode: 'group' as const,
  scoreFormat: 'decimal' as const,
  scoreStep: '0.500' as const,
  finalMax: '15',
  photoMin: 3,
  photoMax: 5,
  commentMax: 300,
  selfEditHours: 24,
  lateEntryDefaultHours: 24,
  ...over,
});

describe('create and copy terms', () => {
  let t1: string;

  test('a term from nothing gets the 2/2569 defaults: room 5 + building 10, teacher score off', async () => {
    t1 = await createTerm(db, admin, { academicYear: 2569, termNo: 1 }, meta, now);
    const s = await getTermSettings(db, admin, t1);
    expect(s.term.status).toBe('draft');
    expect(s.components.map((c) => [c.key, c.maxValue, c.enabled])).toEqual([
      ['room', '5.000', true],
      ['area', '10.000', true],
      ['area_teacher', '5.000', false],
    ]);
    await expect(createTerm(db, admin, { academicYear: 2569, termNo: 1 }, meta, now)).rejects.toMatchObject({
      message: 'มีภาคเรียนนี้อยู่แล้ว',
    });
  });

  test('T-TM2: copies config, components and zones; duties only when asked; class selection only in the same year', async () => {
    await updateTermConfig(db, admin, configOf(t1, { scoreFormat: 'integer', finalMax: '20', photoMin: 2 }), meta, now);
    const cls = await upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 1, name: 'Amanah' },
      meta,
      now,
    );
    await setTermClasses(db, admin, { termId: t1, classIds: [cls] }, meta, now);
    const zone = newId();
    await db.execute(`INSERT INTO areas (id, type, code, name) VALUES ('${zone}', 'zone', 'A', 'โซน A')`);
    await db.execute(`INSERT INTO term_class_zones (term_id, class_id, area_id) VALUES ('${t1}', '${cls}', '${zone}')`);
    await db.execute(
      `INSERT INTO duties (id, term_id, user_id, duty, target_type, target_class_id) VALUES ('${newId()}', '${t1}', '${admin.id}', 'committee', 'class', '${cls}')`,
    );

    const t2 = await createTerm(db, admin, { academicYear: 2569, termNo: 2, copyFromTermId: t1 }, meta, now);
    const s2 = await getTermSettings(db, admin, t2);
    expect(s2.term).toMatchObject({
      scoreFormat: 'integer',
      scoreStep: '1.000',
      finalMax: '20.000',
      photoMin: 2,
      copiedFromTermId: t1,
    });
    expect(s2.components.map((c) => c.key)).toEqual(['room', 'area', 'area_teacher']);
    expect(await places.listTermClassIds(db, t2)).toEqual([cls]); // same academic year
    expect(await repo.listTermClassZones(db, t2)).toHaveLength(1);
    expect(await repo.listDuties(db, t2)).toHaveLength(0); // not copied by default

    const t3 = await createTerm(
      db,
      admin,
      { academicYear: 2570, termNo: 1, copyFromTermId: t2, copyDuties: true, copyZones: false },
      meta,
      now,
    );
    expect(await places.listTermClassIds(db, t3)).toEqual([]); // new academic year starts empty (FR-P7)
    expect(await repo.listTermClassZones(db, t3)).toHaveLength(0);
    expect(await repo.listDuties(db, t3)).toHaveLength(0); // t2 had none to copy

    const t4 = await createTerm(
      db,
      admin,
      { academicYear: 2570, termNo: 2, copyFromTermId: t1, copyDuties: true },
      meta,
      now,
    );
    expect(await repo.listDuties(db, t4)).toHaveLength(1);
    // the old term is untouched
    expect(await repo.listDuties(db, t1)).toHaveLength(1);
  });

  test('executives cannot create or configure terms', async () => {
    await expect(createTerm(db, executive, { academicYear: 2571, termNo: 1 }, meta, now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('config lock (T-TM1)', () => {
  test('once locked, config, scoring and round count are refused with CONFIG_LOCKED; round dates may still be extended', async () => {
    const t = await createTerm(db, admin, { academicYear: 2572, termNo: 1 }, meta, now);
    await setRoundCount(db, admin, { termId: t, count: 2 }, meta, now);
    await db.execute(`UPDATE terms SET config_locked_at = now() WHERE id = '${t}'`); // what the first evaluation does
    const locked = { code: 'CONFIG_LOCKED', message: 'เทอมนี้มีผลประเมินแล้ว แก้การตั้งค่าไม่ได้' };
    await expect(updateTermConfig(db, admin, configOf(t), meta, now)).rejects.toMatchObject(locked);
    await expect(setRoundCount(db, admin, { termId: t, count: 3 }, meta, now)).rejects.toMatchObject(locked);
    const s = await getTermSettings(db, admin, t);
    await expect(
      updateScoring(
        db,
        admin,
        { termId: t, equalMax: true, components: s.components.map((c) => ({ ...c, maxValue: '1' })) },
        meta,
        now,
      ),
    ).rejects.toMatchObject(locked);
    const r1 = s.rounds[0]!;
    await expect(
      updateRoundDates(
        db,
        admin,
        { roundId: r1.id, opensAt: r1.opensAt, closesAt: new Date(r1.closesAt.getTime() + 86_400_000) },
        meta,
        now,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('scoring and rounds (AC)', () => {
  let t: string;
  beforeAll(async () => {
    t = await createTerm(db, admin, { academicYear: 2573, termNo: 1 }, meta, now);
  });

  test('integer vs decimal changes the step the committee form will use', async () => {
    await updateTermConfig(db, admin, configOf(t, { scoreFormat: 'decimal', scoreStep: '0.250' }), meta, now);
    expect(scoreStepFor((await getTermSettings(db, admin, t)).term)).toBe(250);
    await updateTermConfig(db, admin, configOf(t, { scoreFormat: 'integer' }), meta, now);
    expect(scoreStepFor((await getTermSettings(db, admin, t)).term)).toBe(1000);
  });

  test('the round stepper creates and removes rounds; started rounds cannot be removed', async () => {
    await setRoundCount(db, admin, { termId: t, count: 3 }, meta, now);
    let rounds = (await getTermSettings(db, admin, t)).rounds;
    expect(rounds.map((r) => r.roundNo)).toEqual([1, 2, 3]);
    expect(rounds[1]!.opensAt.getTime()).toBeGreaterThan(rounds[0]!.closesAt.getTime());
    await setRoundCount(db, admin, { termId: t, count: 2 }, meta, now);
    rounds = (await getTermSettings(db, admin, t)).rounds;
    expect(rounds.map((r) => r.roundNo)).toEqual([1, 2]);
    await db.execute(`UPDATE rounds SET status = 'open' WHERE id = '${rounds[1]!.id}'`);
    await expect(setRoundCount(db, admin, { termId: t, count: 1 }, meta, now)).rejects.toMatchObject({
      message: 'ลดจำนวนรอบไม่ได้ เพราะรอบที่จะลบเปิดไปแล้ว',
    });
    await expect(setRoundCount(db, admin, { termId: t, count: 11 }, meta, now)).rejects.toMatchObject({
      field: 'count',
    });
  });

  test('BR-R5 through the service: an open round can only extend its close date', async () => {
    const r2 = (await getTermSettings(db, admin, t)).rounds[1]!;
    await expect(
      updateRoundDates(
        db,
        admin,
        { roundId: r2.id, opensAt: new Date(r2.opensAt.getTime() - 86_400_000), closesAt: r2.closesAt },
        meta,
        now,
      ),
    ).rejects.toMatchObject({ message: 'รอบนี้เปิดแล้ว แก้ได้เฉพาะวันปิดรับคะแนน' });
    await db.execute(`UPDATE rounds SET status = 'scheduled' WHERE id = '${r2.id}'`);
  });

  test('a disabled component never appears in the components in use', async () => {
    const used = await componentsInUseForTerm(db, t);
    expect(used.map((c) => c.key)).toEqual(['room', 'area']); // area_teacher is off by default
  });

  test('switching off equal full marks stores round_component_max rows; results use termScoreByRound', async () => {
    const s = await getTermSettings(db, admin, t);
    const components = s.components.map((c) => ({ ...c, maxValue: c.maxValue }));
    await updateScoring(
      db,
      admin,
      { termId: t, equalMax: false, components, roundMax: [{ roundNo: 2, key: 'area', maxValue: '15' }] },
      meta,
      now,
    );
    const after = await getTermSettings(db, admin, t);
    expect(after.equalMax).toBe(false);
    expect(after.roundMax).toHaveLength(2 * 2); // 2 rounds × 2 enabled components
    const maxima = roundMaxima(
      after.rounds.map((r) => r.id),
      after.components,
      after.roundMax,
    );
    expect([...maxima.values()]).toEqual([p(15), p(20)]);
    expect(
      termScoreByRound(
        [
          { total: p(12), max: maxima.get(after.rounds[0]!.id)! },
          { total: p(10), max: maxima.get(after.rounds[1]!.id)! },
        ],
        p(15),
      ),
    ).toBe(p('9.75'));

    // switching back on removes the per-round rows
    await updateScoring(db, admin, { termId: t, equalMax: true, components: after.components }, meta, now);
    expect((await getTermSettings(db, admin, t)).roundMax).toHaveLength(0);
  });

  test('at least one enabled score component; keys must be unique', async () => {
    const s = await getTermSettings(db, admin, t);
    await expect(
      updateScoring(
        db,
        admin,
        { termId: t, equalMax: true, components: s.components.map((c) => ({ ...c, enabled: false })) },
        meta,
        now,
      ),
    ).rejects.toMatchObject({
      message: 'ต้องเปิดใช้ส่วนคะแนนอย่างน้อย 1 ส่วน',
    });
    await expect(
      updateScoring(
        db,
        admin,
        { termId: t, equalMax: true, components: s.components.map((c) => ({ ...c, key: 'room' })) },
        meta,
        now,
      ),
    ).rejects.toMatchObject({
      message: 'รหัสส่วนคะแนนซ้ำกัน',
    });
  });
});

describe('activate (BR-TM4)', () => {
  test('exactly one active term; the previous one closes and its retention clock starts', async () => {
    const a = await createTerm(db, admin, { academicYear: 2574, termNo: 1 }, meta, now);
    const b = await createTerm(db, admin, { academicYear: 2574, termNo: 2 }, meta, now);
    await activateTerm(db, admin, { termId: a }, meta, now);
    await activateTerm(db, admin, { termId: b }, meta, now);
    const active = await repo.findActiveTerms(db);
    expect(active.map((x) => x.id)).toEqual([b]);
    const closed = await repo.findTerm(db, a);
    expect(closed).toMatchObject({ status: 'closed', purgeAfter: '2027-10-01' });
    await expect(activateTerm(db, admin, { termId: b }, meta, now)).rejects.toMatchObject({
      message: 'ภาคเรียนนี้เปิดใช้อยู่แล้ว',
    });
  });
});
