/** T28: close term (BR-D1), 30-day warning (BR-D2), retention.run purge (BR-D3/D4, T-D1), the PDF archive ZIP. */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import {
  appointmentOrders,
  areas,
  auditLogs,
  classes,
  duties,
  evaluations,
  evidence,
  notifications,
  pdfDocuments,
  requests,
  rosterSnapshots,
  roundClassAreas,
  roundClassResults,
  rounds,
  scoreComponents,
  sessions,
  students,
  termClassZones,
  terms,
  users,
} from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { dataFileExists, writeDataFile } from '../storage.ts';
import { writeAudit } from './audit.service.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { setTermClasses, upsertArea, upsertClass } from './place.service.ts';
import { purgeAfterFor, runRetention, termPdfArchive, warnRetention } from './retention.service.ts';
import { activateTerm, closeTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_ret_${randomBytes(4).toString('hex')}`;
const withDb = (name: string) => Object.assign(new URL(baseUrl), { pathname: `/${name}` }).toString();
const pgAdmin = async (q: string) => {
  const c = new pg.Client({ connectionString: withDb('postgres') });
  await c.connect();
  try {
    await c.query(q);
  } finally {
    await c.end();
  }
};

const DAY = 86_400_000;
const now = new Date('2027-12-20T02:00:00Z');
const closedAt = new Date(now.getTime() - 366 * DAY); // the old term closed 366 days ago
const meta = { ip: '10.0.0.28', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let root: string;
let admin: SessionUser;
let oldTerm: string;
let keptTerm: string;
let A: string;
let b1: string;
let oldEval: string;
const files = {
  shared: 'uploads/aa/shared.webp',
  own: 'uploads/bb/own.webp',
  pdf: 'pdf/ZW-2568-1-R1-0001_v1.pdf',
  order: 'orders/order-2568-1.pdf',
  keptPdf: 'pdf/ZW-2568-2-R1-0001_v1.pdf',
};

async function round(termId: string, roundNo: number, status: 'closed' | 'finalized' | 'open' = 'finalized') {
  const id = newId();
  await db.insert(rounds).values({
    id,
    termId,
    roundNo,
    opensAt: new Date(closedAt.getTime() - 30 * DAY),
    closesAt: new Date(closedAt.getTime() - 25 * DAY),
    status,
  });
  await db.insert(roundClassAreas).values({ roundId: id, classId: A, areaId: b1 });
  return id;
}

async function evaluation(termId: string, roundId: string) {
  const [comp] = await db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId)).limit(1);
  const id = newId();
  await db.insert(evaluations).values({
    id,
    roundId,
    componentId: comp!.id,
    targetType: 'class',
    targetClassId: A,
    ownerId: admin.id,
    score: '4.000',
    status: 'approved',
    firstSubmittedAt: closedAt,
    selfEditUntil: closedAt,
    lastEditedAt: closedAt,
    approvedBy: admin.id,
    approvedAt: closedAt,
  });
  return id;
}

async function photo(evaluationId: string, filePath: string, sha: string) {
  const id = newId();
  await db.insert(evidence).values({
    id,
    evaluationId,
    uploadedBy: admin.id,
    kind: 'site',
    filePath,
    sha256: sha,
    width: 10,
    height: 10,
    bytes: 4,
    capturedAt: closedAt,
  });
  return id;
}

async function pdf(evaluationId: string, filePath: string, docNumber: string) {
  await db.insert(pdfDocuments).values({
    id: newId(),
    evaluationId,
    evaluationVersion: 1,
    docNumber,
    version: 1,
    isDraft: false,
    filePath,
  });
}

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  root = await mkdtemp(path.join(tmpdir(), 'zw-ret-'));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, closedAt, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, closedAt);
  const su = await signIn('root', 'root-password');
  const u = await createUser(db, su, { username: 'adm', displayName: 'adm', role: 'admin' }, meta, closedAt);
  admin = await signIn('adm', u.tempPassword!);

  b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, closedAt);
  A = await upsertClass(
    db,
    admin,
    { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo: 1, name: 'Amanah' },
    meta,
    closedAt,
  );
  // old term 1/2568: active, then closed 366 days ago when 2/2568 was activated
  const before = new Date(closedAt.getTime() - 60 * DAY);
  oldTerm = await createTerm(db, admin, { academicYear: 2568, termNo: 1 }, meta, before);
  await setTermClasses(db, admin, { termId: oldTerm, classIds: [A] }, meta, before);
  await activateTerm(db, admin, { termId: oldTerm }, meta, before);
  const r1 = await round(oldTerm, 1);
  oldEval = await evaluation(oldTerm, r1);
  await photo(oldEval, files.shared, 'sha-shared');
  const ownPhoto = await photo(oldEval, files.own, 'sha-own');
  await pdf(oldEval, files.pdf, 'ZW-2568-1-R1-0001');
  await db.insert(roundClassResults).values({
    roundId: r1,
    classId: A,
    areaId: b1,
    classScore: '4.000',
    areaScore: '0.000',
    deduction: '0.000',
    total: '4.000',
    rankInGroup: 1,
    frozen: true,
  });
  await db.insert(requests).values({
    id: newId(),
    type: 'edit_comment',
    status: 'rejected',
    requesterId: admin.id,
    roundId: r1,
    evaluationId: oldEval,
    reason: 'x',
  });
  await db.insert(duties).values({
    id: newId(),
    termId: oldTerm,
    userId: admin.id,
    duty: 'committee',
    targetType: 'class',
    targetClassId: A,
  });
  await db.insert(termClassZones).values({ termId: oldTerm, classId: A, areaId: b1 });
  await db.insert(appointmentOrders).values({
    id: newId(),
    termId: oldTerm,
    title: 'คำสั่งที่ 1/2568',
    filePath: files.order,
    uploadedBy: admin.id,
  });
  // term-entity audit rows besides the ones the services wrote
  await writeAudit(
    db,
    { actorId: admin.id, action: 'evaluation.approve', entity: 'evaluation', entityId: oldEval },
    closedAt,
  );
  await writeAudit(
    db,
    { actorId: admin.id, action: 'evidence.upload', entity: 'evidence', entityId: ownPhoto },
    closedAt,
  );
  await writeAudit(
    db,
    { actorId: admin.id, action: 'round_class_area.update', entity: 'round_class_area', entityId: `${r1}:${A}` },
    closedAt,
  );

  // students: only in the old term (expired), also in the kept term (expired), not expired
  const [s1, s2, s3] = [newId(), newId(), newId()];
  await db.insert(students).values([
    { id: s1, studentCode: '60001', fullName: 'x', homeClassId: A, deleteAfter: '2027-01-01' },
    { id: s2, studentCode: '60002', fullName: 'x', homeClassId: A, deleteAfter: '2027-01-01' },
    { id: s3, studentCode: '60003', fullName: 'x', homeClassId: A, deleteAfter: '2028-06-01' },
  ]);
  await db.insert(rosterSnapshots).values([
    { roundId: r1, studentId: s1, classId: A },
    { roundId: r1, studentId: s2, classId: A },
  ]);

  // kept term 2/2568, activated at `closedAt` (closes 1/2568)
  keptTerm = await createTerm(db, admin, { academicYear: 2568, termNo: 2, copyFromTermId: oldTerm }, meta, closedAt);
  await activateTerm(db, admin, { termId: keptTerm }, meta, closedAt);
  const k1 = await round(keptTerm, 1);
  const keptEval = await evaluation(keptTerm, k1);
  await photo(keptEval, files.shared, 'sha-shared'); // identical bytes uploaded again
  await pdf(keptEval, files.keptPdf, 'ZW-2568-2-R1-0001');
  await db.insert(rosterSnapshots).values({ roundId: k1, studentId: s2, classId: A });

  for (const f of Object.values(files)) await writeDataFile(f, new TextEncoder().encode(f), root);
  await writeDataFile(files.own.replace('.webp', '_w320.webp'), new Uint8Array([1]), root);

  // not tied to a term: old (400 d) and recent login rows; an expired and a live session
  await writeAudit(
    db,
    { actorId: admin.id, action: 'user.login', entity: 'user', entityId: admin.id },
    new Date(now.getTime() - 400 * DAY),
  );
  await writeAudit(
    db,
    { actorId: admin.id, action: 'user.login', entity: 'user', entityId: admin.id },
    new Date(now.getTime() - DAY),
  );
  await db.insert(sessions).values([
    { id: 'expired', userId: admin.id, expiresAt: new Date(now.getTime() - DAY) },
    { id: 'live', userId: admin.id, expiresAt: new Date(now.getTime() + DAY) },
  ]);
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  if (root) await rm(root, { recursive: true, force: true });
});

async function count(table: PgTable, where?: SQL) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return row!.n;
}

/** Reads a stored-only ZIP back: names and bytes (tiny reader for the test, central directory based). */
function readZip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < entries; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    out.push({ name, data: method === 8 ? inflateRawSync(raw) : raw });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

describe('BR-D1 close term', () => {
  test('activating the next term closed the old one with purge_after one year later (Bangkok date)', async () => {
    const [t] = await db.select().from(terms).where(eq(terms.id, oldTerm));
    expect(t).toMatchObject({ status: 'closed', closedAt, purgeAfter: purgeAfterFor(closedAt), purgedAt: null });
    expect(purgeAfterFor(new Date('2026-03-31T18:30:00Z'))).toBe('2027-04-01'); // 01:30 on 1 Apr in Bangkok
  });
});

describe('BR-D2 archive and warning', () => {
  test('the archive ZIP holds every PDF of the term by round; missing files are listed, not fatal', async () => {
    const a = await termPdfArchive(db, admin, oldTerm, { root });
    const zip = readZip(Buffer.from(await new Response(a.stream).arrayBuffer()));
    expect(a.filename).toBe('pdf-2568-1.zip');
    expect(zip).toEqual([{ name: 'รอบ1/ZW-2568-1-R1-0001_v1.pdf', data: Buffer.from(files.pdf) }]);
    const empty = await termPdfArchive(db, admin, keptTerm, { root: path.join(root, 'nowhere') });
    const z2 = readZip(Buffer.from(await new Response(empty.stream).arrayBuffer()));
    expect(z2.map((e) => e.name)).toEqual(['ไฟล์ที่หาไม่พบ.txt']);
    expect(z2[0]!.data.toString()).toContain('ZW-2568-2-R1-0001_v1.pdf');
  });

  test('30 days before purge_after admins are warned once, with the download link', async () => {
    const thirtyBefore = new Date(`${purgeAfterFor(closedAt)}T01:00:00Z`).getTime() - 30 * DAY;
    expect((await warnRetention(db, new Date(thirtyBefore - DAY))).warned).toEqual([]); // 31 days: not yet
    expect((await warnRetention(db, new Date(thirtyBefore))).warned).toEqual([oldTerm]);
    expect((await warnRetention(db, new Date(thirtyBefore + DAY))).warned).toEqual([]); // once only
    const rows = await db.select().from(notifications).where(eq(notifications.type, 'retention_warning'));
    expect(rows.map((r) => r.userId).sort()).toEqual(
      (await db.select({ id: users.id }).from(users)).map((u) => u.id).sort(),
    );
    expect(rows[0]).toMatchObject({
      title: 'ข้อมูลภาคเรียน 1/2568 จะถูกลบใน 30 วัน',
      link: '/admin/settings/privacy',
    });
  });
});

describe('T-D1 retention.run', () => {
  test('nothing happens before purge_after has passed', async () => {
    const out = await runRetention(db, new Date(`${purgeAfterFor(closedAt)}T10:00:00Z`), { root });
    expect(out.purgedTerms).toEqual([]);
  });

  test('term closed 366 days ago: its data, files and audit rows are gone; the row shows purged_at', async () => {
    const auditBefore = await count(auditLogs);
    const out = await runRetention(db, now, { root });
    expect(out.purgedTerms).toEqual([{ termId: oldTerm, evaluations: 1, files: 3, auditRows: expect.any(Number) }]);
    expect(out.purgedTerms[0]!.auditRows).toBeGreaterThanOrEqual(5);

    const [t] = await db.select().from(terms).where(eq(terms.id, oldTerm));
    expect(t!.purgedAt).toEqual(now);
    expect(t!.status).toBe('closed');
    for (const table of [rounds, scoreComponents, duties, termClassZones, appointmentOrders])
      expect(await count(table, eq((table as typeof rounds).termId, oldTerm))).toBe(0);
    expect(await count(evaluations, eq(evaluations.id, oldEval))).toBe(0);
    // term audit rows gone; only the warning and purge records (entity "retention") stay
    const left = await db.execute(
      sql`SELECT entity FROM audit_logs WHERE entity_id = ${oldTerm} OR entity_id = ${oldEval} OR entity_id LIKE ${'%:' + A}`,
    );
    expect(left.rows).toEqual([{ entity: 'retention' }, { entity: 'retention' }]);
    expect(await count(auditLogs)).toBeLessThan(auditBefore);

    // files: own photo + thumb, PDF and order deleted; the shared photo is still used by the kept term
    expect(await dataFileExists(files.own, root)).toBe(false);
    expect(await dataFileExists(files.own.replace('.webp', '_w320.webp'), root)).toBe(false);
    expect(await dataFileExists(files.pdf, root)).toBe(false);
    expect(await dataFileExists(files.order, root)).toBe(false);
    expect(await dataFileExists(files.shared, root)).toBe(true);
    expect(await dataFileExists(files.keptPdf, root)).toBe(true);
  });

  test('other terms, places, classes and users are untouched', async () => {
    expect(await count(rounds, eq(rounds.termId, keptTerm))).toBe(1);
    expect(await count(evaluations)).toBe(1);
    expect(await count(evidence)).toBe(1);
    expect(await count(pdfDocuments)).toBe(1);
    expect(await count(classes)).toBe(1);
    expect(await count(areas)).toBeGreaterThanOrEqual(1);
    expect(await count(users)).toBe(2);
    const [t] = await db.select().from(terms).where(eq(terms.id, keptTerm));
    expect(t!.purgedAt).toBeNull();
  });

  test('BR-D4 students, old non-term audit rows and expired sessions', async () => {
    const codes = (await db.select({ c: students.studentCode }).from(students)).map((s) => s.c).sort();
    expect(codes).toEqual(['60002', '60003']); // 60001 expired and in no kept snapshot
    const logins = await db.select().from(auditLogs).where(eq(auditLogs.action, 'user.login'));
    expect(logins).toHaveLength(1);
    expect((await db.select({ id: sessions.id }).from(sessions)).map((s) => s.id)).toEqual(['live']);
  });

  test('a second run is a no-op; the audit table still refuses ordinary deletes and updates', async () => {
    expect((await runRetention(db, now, { root })).purgedTerms).toEqual([]);
    const refused = (q: SQL) =>
      db.execute(q).then(
        () => 'accepted',
        (err: { cause?: Error }) => String(err.cause?.message),
      );
    expect(await refused(sql`DELETE FROM audit_logs`)).toMatch(/append-only/);
    expect(await refused(sql`UPDATE audit_logs SET action = 'x'`)).toMatch(/append-only/);
  });

  test('a purged term has no archive any more', async () => {
    await expect(termPdfArchive(db, admin, oldTerm, { root })).rejects.toMatchObject({ code: 'NOT_AVAILABLE' });
  });
});

describe('closeTerm', () => {
  test('only the active term, never with a round open; sets the retention clock', async () => {
    await expect(closeTerm(db, admin, { termId: oldTerm }, meta, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    const open = await round(keptTerm, 2, 'open');
    await expect(closeTerm(db, admin, { termId: keptTerm }, meta, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, open));
    expect(await closeTerm(db, admin, { termId: keptTerm }, meta, now)).toEqual({ purgeAfter: '2028-12-19' });
    const [t] = await db.select().from(terms).where(eq(terms.id, keptTerm));
    expect(t).toMatchObject({ status: 'closed', closedAt: now, purgeAfter: '2028-12-19' });
  });
});
