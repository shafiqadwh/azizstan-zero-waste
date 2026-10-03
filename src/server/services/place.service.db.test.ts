/** T13: places register against PostgreSQL. */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/places.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import {
  addClassAlias,
  classSelectionToCopy,
  getPlaces,
  linkClassRoom,
  setTermClasses,
  upsertArea,
  upsertClass,
  upsertPhysicalRoom,
} from './place.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_places_${randomBytes(4).toString('hex')}`;
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
const meta = { ip: '10.0.0.7', userAgent: 'vitest' };
const now = new Date('2026-11-01T03:00:00Z');
let admin: SessionUser;
let executive: SessionUser;
let b1: string;
let r121: string;
let r122: string;
let amanah: string;
let berdikari: string;

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  const root = (
    await login(db, { username: 'root', password: 'root-password' }, meta, now, { limiter: new LoginRateLimiter() })
  ).user;
  const a = await createUser(db, root, { username: 'adm', displayName: 'แอดมิน', role: 'admin' }, meta, now);
  const e = await createUser(db, root, { username: 'exe', displayName: 'ผู้บริหาร', role: 'executive' }, meta, now);
  admin = (
    await login(db, { username: 'adm', password: a.tempPassword! }, meta, now, { limiter: new LoginRateLimiter() })
  ).user;
  executive = (
    await login(db, { username: 'exe', password: e.tempPassword! }, meta, now, { limiter: new LoginRateLimiter() })
  ).user;

  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121', floor: 2 }, meta, now);
  r122 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '122', floor: 2 }, meta, now);
  amanah = await upsertClass(
    db,
    admin,
    { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 1, name: 'Amanah' },
    meta,
    now,
  );
  berdikari = await upsertClass(
    db,
    admin,
    { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 2, name: 'Berdikari' },
    meta,
    now,
  );
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

describe('register', () => {
  test('rooms get a random QR token; duplicates are field errors in Thai', async () => {
    const room = await repo.findRoom(db, r121);
    expect(room?.qrToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await expect(upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121' }, meta, now)).rejects.toMatchObject(
      {
        field: 'roomNumber',
        message: 'หมายเลขห้องนี้มีอยู่แล้ว',
      },
    );
    await expect(upsertArea(db, admin, { type: 'building', code: '1', name: 'ซ้ำ' }, meta, now)).rejects.toMatchObject({
      field: 'code',
    });
  });

  test('display names follow FR-P1', async () => {
    const voc = await upsertClass(
      db,
      admin,
      { track: 'vocational', gradeCode: 'VOC2', gradeLabel: 'ปวช.2', rankGroup: 'ปวช.', roomNo: 1, name: 'ปวช.2/1' },
      meta,
      now,
    );
    expect((await repo.findClass(db, amanah))?.displayName).toBe('ม.1 Amanah');
    expect((await repo.findClass(db, voc))?.displayName).toBe('ปวช.2/1');
  });

  test('aliases are stored as lookup keys and cannot point at two classes', async () => {
    await addClassAlias(db, admin, { classId: amanah, alias: 'ม.1/1 Amanah' }, meta, now);
    expect(await repo.findAlias(db, 'ม.1|amanah')).toMatchObject({ classId: amanah });
    await expect(
      addClassAlias(db, admin, { classId: berdikari, alias: 'ม.1/9 amanah' }, meta, now),
    ).rejects.toMatchObject({
      message: 'ชื่อนี้ใช้กับห้องเรียนอื่นแล้ว',
    });
  });

  test('executives read but cannot change places (FORBIDDEN)', async () => {
    await expect(getPlaces(db, executive)).resolves.toBeTruthy();
    await expect(
      upsertArea(db, executive, { type: 'zone', code: 'Z', name: 'โซน Z' }, meta, now),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('class ↔ room links (FR-P3)', () => {
  test('moving a class closes the old link at the effective date', async () => {
    await linkClassRoom(db, admin, { classId: amanah, physicalRoomId: r121, effectiveFrom: '2026-11-01' }, meta, now);
    await linkClassRoom(db, admin, { classId: amanah, physicalRoomId: r122, effectiveFrom: '2026-12-15' }, meta, now);
    const links = await repo.linksOfClass(db, amanah);
    expect(links.map((l) => [l.physicalRoomId, l.effectiveFrom, l.effectiveTo])).toEqual([
      [r121, '2026-11-01', '2026-12-15'],
      [r122, '2026-12-15', null],
    ]);
    // room 121 is free again from 15 Dec, so another class can move in that day
    await linkClassRoom(
      db,
      admin,
      { classId: berdikari, physicalRoomId: r121, effectiveFrom: '2026-12-15' },
      meta,
      now,
    );
  });

  test('overlaps are refused with Thai messages', async () => {
    // room 122 holds Amanah from 15 Dec
    await expect(
      linkClassRoom(db, admin, { classId: berdikari, physicalRoomId: r122, effectiveFrom: '2027-01-05' }, meta, now),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'ห้อง 122 มี ม.1 Amanah ใช้อยู่ในวันที่นั้น ย้าย ม.1 Amanah ออกก่อน',
    });
    // a move dated before an already planned move
    await expect(
      linkClassRoom(db, admin, { classId: amanah, physicalRoomId: r121, effectiveFrom: '2026-11-20' }, meta, now),
    ).rejects.toMatchObject({
      message: 'มีการย้ายห้องที่ตั้งไว้หลังวันที่นี้แล้ว แก้ที่รายการนั้นก่อน',
    });
    await expect(
      linkClassRoom(db, admin, { classId: amanah, physicalRoomId: r122, effectiveFrom: '2027-01-01' }, meta, now),
    ).rejects.toMatchObject({
      message: 'ห้องเรียนนี้อยู่ห้องนี้อยู่แล้ว',
    });
    await expect(
      linkClassRoom(db, admin, { classId: amanah, physicalRoomId: r122, effectiveFrom: '2027-02-30' }, meta, now),
    ).rejects.toMatchObject({
      field: 'effectiveFrom',
    });
  });
});

describe('per-term class selection (FR-P7)', () => {
  let termId: string;
  beforeAll(async () => {
    termId = newId();
    await db.execute(
      `INSERT INTO terms (id, academic_year, term_no, area_type, final_max) VALUES ('${termId}', 2569, 2, 'building', 15)`,
    );
  });

  test('replaces the selection; only selected classes are in the term set', async () => {
    await setTermClasses(db, admin, { termId, classIds: [amanah] }, meta, now);
    expect(await repo.listTermClassIds(db, termId)).toEqual([amanah]);
    await setTermClasses(db, admin, { termId, classIds: [berdikari, berdikari] }, meta, now);
    expect(await repo.listTermClassIds(db, termId)).toEqual([berdikari]);
  });

  test('each selected class keeps its building; areas of other classes or the wrong type are refused', async () => {
    const zone = await upsertArea(db, admin, { type: 'zone', code: 'ZA', name: 'โซน ZA' }, meta, now);
    await setTermClasses(
      db,
      admin,
      {
        termId,
        classIds: [amanah, berdikari],
        areas: [
          { classId: amanah, areaId: b1 },
          { classId: newId(), areaId: b1 }, // not selected: ignored
        ],
      },
      meta,
      now,
    );
    expect(await termsRepo.listTermClassZones(db, termId)).toEqual([{ termId, classId: amanah, areaId: b1 }]);
    await expect(
      setTermClasses(db, admin, { termId, classIds: [amanah], areas: [{ classId: amanah, areaId: zone }] }, meta, now),
    ).rejects.toMatchObject({ field: 'areas' });
    // deselecting a class drops its building
    await setTermClasses(db, admin, { termId, classIds: [berdikari], areas: [] }, meta, now);
    expect(await termsRepo.listTermClassZones(db, termId)).toEqual([]);
  });

  test('unknown classes are refused; locked config → CONFIG_LOCKED; executives → FORBIDDEN', async () => {
    await expect(setTermClasses(db, admin, { termId, classIds: [newId()] }, meta, now)).rejects.toMatchObject({
      field: 'classIds',
    });
    await expect(setTermClasses(db, executive, { termId, classIds: [] }, meta, now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await db.execute(`UPDATE terms SET config_locked_at = now() WHERE id = '${termId}'`);
    await expect(setTermClasses(db, admin, { termId, classIds: [amanah] }, meta, now)).rejects.toMatchObject({
      code: 'CONFIG_LOCKED',
      message: 'เทอมนี้มีผลประเมินแล้ว แก้การตั้งค่าไม่ได้',
    });
  });

  test('a new academic year starts with no classes selected; the same year keeps the selection', () => {
    expect(classSelectionToCopy({ academicYear: 2569 }, { academicYear: 2569 }, [amanah])).toEqual([amanah]);
    expect(classSelectionToCopy({ academicYear: 2569 }, { academicYear: 2570 }, [amanah])).toEqual([]);
  });
});
