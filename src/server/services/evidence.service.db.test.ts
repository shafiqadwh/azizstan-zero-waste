/** T17: evidence upload, permission-checked reads, thumbnails and orphan GC against PostgreSQL. */
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { auditLogs, evidence } from '../../../db/schema.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import { MAX_UPLOAD_BYTES } from '../evidence/image.ts';
import type { SessionUser } from '../policies/index.ts';
import { SlidingWindowLimiter } from '../rate-limit.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { gcOrphanEvidence } from './evidence-gc.service.ts';
import { readEvidenceFile, uploadEvidence } from './evidence.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_evidence_${randomBytes(4).toString('hex')}`;
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
let root: string;
const meta = { ip: '10.0.0.10', userAgent: 'vitest' };
const now = new Date('2026-11-16T09:30:00Z'); // 16:30 Bangkok
let admin: SessionUser;
let executive: SessionUser;
let committee: SessionUser;
let outsider: SessionUser;
let amanah: string;
let b1: string;
let photo: Buffer;

const limiter = () => new SlidingWindowLimiter(1000, 60_000);
const upload = (
  user: SessionUser,
  extra: Partial<{ kind: 'site' | 'signature'; targetRef: string; data: Uint8Array }> = {},
  at = now,
) =>
  uploadEvidence(db, user, { kind: 'site', targetRef: `class:${amanah}`, data: photo, ...extra }, meta, at, {
    root,
    limiter: limiter(),
  });

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'zw-data-'));
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  const su = await signIn('root', 'root-password');
  const mk = async (username: string, role: 'admin' | 'executive' | 'teacher') => {
    const u = await createUser(db, su, { username, displayName: username, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'admin');
  executive = await mk('exe', 'executive');
  committee = await mk('t.com', 'teacher');
  outsider = await mk('t.out', 'teacher');

  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  const r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121' }, meta, now);
  amanah = await upsertClass(
    db,
    admin,
    { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 1, name: 'Amanah' },
    meta,
    now,
  );
  await linkClassRoom(db, admin, { classId: amanah, physicalRoomId: r121, effectiveFrom: '2026-11-01' }, meta, now);
  const term = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await setTermClasses(db, admin, { termId: term, classIds: [amanah] }, meta, now);
  await activateTerm(db, admin, { termId: term }, meta, now);
  await assignDuty(
    db,
    admin,
    { termId: term, userId: committee.id, duty: 'committee', targetType: 'class', targetId: amanah },
    meta,
    now,
  );

  // a phone photo: 3000×2000 landscape stored sideways (orientation 6) with GPS in its EXIF
  photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#4a7f5a' } })
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'TestCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 52/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '101/1 15/1 0/1' },
    })
    .toBuffer();
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await rm(root, { recursive: true, force: true });
});

const hasGps = (exif: Buffer | undefined) =>
  !!exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])));

describe('upload (BR-V1, BR-V2)', () => {
  test('fixture really carries GPS and a sideways orientation', async () => {
    const m = await sharp(photo).metadata();
    expect(hasGps(m.exif)).toBe(true);
    expect(m.orientation).toBe(6);
  });

  test('stored WebP: rotated upright, ≤ 1600 px, no EXIF/GPS, server time, sha path', async () => {
    const out = await upload(committee);
    expect(out.capturedAt).toEqual(now);
    expect(out.url).toBe(`/api/v1/files/${out.evidenceId}`);
    const [row] = await db.select().from(evidence).where(eq(evidence.id, out.evidenceId));
    expect(row).toMatchObject({
      evaluationId: null,
      uploadedBy: committee.id,
      kind: 'site',
      width: 1067,
      height: 1600,
    });
    expect(row!.filePath).toBe(`uploads/${row!.sha256.slice(0, 2)}/${row!.sha256}.webp`);
    const file = await readFile(path.join(root, row!.filePath));
    expect(file.byteLength).toBe(row!.bytes);
    const m = await sharp(file).metadata();
    expect(m).toMatchObject({ format: 'webp', width: 1067, height: 1600 });
    expect(m.exif).toBeUndefined();
    expect(hasGps(m.exif)).toBe(false);
    expect(m.orientation).toBeUndefined();
  });

  test('the stamp is drawn bottom-right (dark box over the green photo)', async () => {
    const out = await upload(committee);
    const [row] = await db.select().from(evidence).where(eq(evidence.id, out.evidenceId));
    const { data, info } = await sharp(path.join(root, row!.filePath)).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return data[i]! + data[i + 1]! + data[i + 2]!;
    };
    expect(px(info.width - 40, info.height - 35)).toBeLessThan(px(40, 40)); // stamp area darker than the top-left
  });

  test('15 MB limit, HEIC and non-images are refused in Thai', async () => {
    await expect(upload(committee, { data: new Uint8Array(MAX_UPLOAD_BYTES + 1) })).rejects.toMatchObject({
      field: 'file',
      message: 'ไฟล์ใหญ่เกิน 15 MB',
    });
    await expect(upload(committee, { data: Buffer.from('not an image') })).rejects.toMatchObject({
      message: 'อ่านรูปนี้ไม่ได้ กรุณาเลือกรูปใหม่',
    });
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    await expect(upload(committee, { data: gif })).rejects.toMatchObject({
      message: 'รองรับเฉพาะรูป JPEG PNG หรือ WebP',
    });
    const heic = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } })
      .heif({ compression: 'av1' })
      .toBuffer();
    await expect(upload(committee, { data: heic })).rejects.toMatchObject({ message: 'กรุณาถ่ายรูปใหม่ในแอป' });
  });

  test('only a committee member of the target may upload (BR-P1); any role needs the duty (BR-P4)', async () => {
    await expect(upload(outsider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(upload(admin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(upload(committee, { targetRef: `area:${b1}` })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(upload(committee, { targetRef: 'room:121' })).rejects.toMatchObject({ field: 'targetRef' });
  });

  test('30 uploads per minute per user', async () => {
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#888' } })
      .png()
      .toBuffer();
    const lim = new SlidingWindowLimiter(2, 60_000);
    const go = () =>
      uploadEvidence(db, committee, { kind: 'site', targetRef: `class:${amanah}`, data: small }, meta, now, {
        root,
        limiter: lim,
      });
    await go();
    await go();
    await expect(go()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('read (/files/{id}?w=)', () => {
  test('uploader and staff can read; other teachers cannot; anonymous is 401', async () => {
    const { evidenceId } = await upload(committee);
    for (const u of [committee, admin, executive]) {
      const f = await readEvidenceFile(db, u, evidenceId, null, now, { root });
      expect((await sharp(f.data).metadata()).width).toBe(1067);
    }
    await expect(readEvidenceFile(db, outsider, evidenceId, null, now, { root })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(readEvidenceFile(db, null, evidenceId, null, now, { root })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(readEvidenceFile(db, admin, 'nope', null, now, { root })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('w=320 gives a 320 px thumbnail, cached next to the original; other widths give the original', async () => {
    const { evidenceId } = await upload(committee);
    const thumb = await readEvidenceFile(db, admin, evidenceId, 320, now, { root });
    expect(await sharp(thumb.data).metadata()).toMatchObject({ format: 'webp', width: 320 });
    const [row] = await db.select().from(evidence).where(eq(evidence.id, evidenceId));
    const cached = path.join(root, row!.filePath.replace('.webp', '_w320.webp'));
    expect((await stat(cached)).isFile()).toBe(true);
    expect((await readEvidenceFile(db, admin, evidenceId, 320, now, { root })).etag).toBe(`${row!.sha256}-w320`);
    expect(
      (await sharp((await readEvidenceFile(db, admin, evidenceId, 999, now, { root })).data).metadata()).width,
    ).toBe(1067);
  });
});

describe('missing file', () => {
  test('a row whose file is gone is a 404, not a crash', async () => {
    const { evidenceId } = await upload(committee);
    const [row] = await db.select().from(evidence).where(eq(evidence.id, evidenceId));
    await rm(path.join(root, row!.filePath));
    await expect(readEvidenceFile(db, admin, evidenceId, null, now, { root })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('evidence.gc (BR-V4)', () => {
  test('orphans older than 24 h are deleted with their files; younger ones stay', async () => {
    const old = await upload(committee, {}, new Date(now.getTime() - 25 * 3600_000));
    const young = await upload(committee, {}, new Date(now.getTime() - 2 * 3600_000));
    const [oldRow] = await db.select().from(evidence).where(eq(evidence.id, old.evidenceId));
    await readEvidenceFile(db, admin, old.evidenceId, 320, now, { root }); // create a thumbnail too
    const before = (await db.select().from(evidence)).length;

    const out = await gcOrphanEvidence(db, now, { root });
    expect(out.deleted).toBeGreaterThanOrEqual(1);
    const ids = (await db.select({ id: evidence.id }).from(evidence)).map((r) => r.id);
    expect(ids).not.toContain(old.evidenceId);
    expect(ids).toContain(young.evidenceId);
    expect(ids.length).toBe(before - out.deleted);
    await expect(stat(path.join(root, oldRow!.filePath))).rejects.toThrow();
    await expect(stat(path.join(root, oldRow!.filePath.replace('.webp', '_w320.webp')))).rejects.toThrow();
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'evidence.gc'));
    expect(audit).toHaveLength(1);
    expect(await gcOrphanEvidence(db, now, { root })).toEqual({ deleted: 0 });
  });
});
