/** T32 / FR-D5: the merged PDF of a round — current versions of approved evaluations, in document order. */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { evaluations, pdfDocuments, rounds, scoreComponents } from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { SessionUser } from '../policies/index.ts';
import { writeDataFile } from '../storage.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { setTermClasses, upsertClass } from './place.service.ts';
import { mergeRoundPdfs } from './round-pdf.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_rpdf_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-11-25T02:00:00Z');
const meta = { ip: '10.0.0.32', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let root: string;
let admin: SessionUser;
let teacher: SessionUser;
let roundId: string;

/** A one-page PDF whose page size encodes `n`, so the merged order is checkable. */
async function onePage(n: number) {
  const doc = await PDFDocument.create();
  doc.addPage([200 + n, 300]);
  return doc.save();
}

async function evaluationWithPdfs(
  classId: string,
  status: 'approved' | 'submitted',
  pdfs: { doc: string; version: number; superseded?: boolean; size?: number; onDisk?: boolean }[],
) {
  const [comp] = await db.select().from(scoreComponents).limit(1);
  const id = newId();
  await db.insert(evaluations).values({
    id,
    roundId,
    componentId: comp!.id,
    targetType: 'class',
    targetClassId: classId,
    ownerId: admin.id,
    score: '4.000',
    status,
    firstSubmittedAt: now,
    selfEditUntil: now,
    lastEditedAt: now,
    approvedBy: status === 'approved' ? admin.id : null,
    approvedAt: status === 'approved' ? now : null,
  });
  for (const p of pdfs) {
    const filePath = `pdf/2026/${p.doc}-v${p.version}.pdf`;
    if (p.onDisk !== false) await writeDataFile(filePath, await onePage(p.size ?? 0), root);
    await db.insert(pdfDocuments).values({
      id: newId(),
      evaluationId: id,
      evaluationVersion: p.version,
      docNumber: p.doc,
      version: p.version,
      isDraft: false,
      filePath,
      supersededAt: p.superseded ? now : null,
    });
  }
}

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(withDb(dbName));
  ({ db, close } = createDb(withDb(dbName)));
  root = await mkdtemp(path.join(tmpdir(), 'zw-rpdf-'));
  const signIn = async (u: string, p: string) =>
    (await login(db, { username: u, password: p }, meta, now, { limiter: new LoginRateLimiter() })).user;
  await upsertSuperAdmin(db, { username: 'root', displayName: 'root', password: 'root-password' }, now);
  const su = await signIn('root', 'root-password');
  const mk = async (username: string, role: 'admin' | 'teacher') => {
    const u = await createUser(db, su, { username, displayName: username, role }, meta, now);
    return signIn(username, u.tempPassword!);
  };
  admin = await mk('adm', 'admin');
  teacher = await mk('tch', 'teacher');
  const cls = async (roomNo: number) =>
    upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo, name: `R${roomNo}` },
      meta,
      now,
    );
  const [a, b, c, d] = [await cls(1), await cls(2), await cls(3), await cls(4)];
  const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
  await setTermClasses(db, admin, { termId, classIds: [a, b, c, d] }, meta, now);
  await activateTerm(db, admin, { termId }, meta, now);
  roundId = newId();
  await db.insert(rounds).values({
    id: roundId,
    termId,
    roundNo: 1,
    opensAt: new Date('2026-11-16T01:00:00Z'),
    closesAt: new Date('2026-11-20T09:30:00Z'),
    status: 'closed',
  });
  // b's PDF number sorts before a's; a has an older superseded version; c is not approved; d's file is gone
  await evaluationWithPdfs(a, 'approved', [
    { doc: 'ZW-2569-2-R1-0002', version: 1, superseded: true, size: 99 },
    { doc: 'ZW-2569-2-R1-0002', version: 2, size: 2 },
  ]);
  await evaluationWithPdfs(b, 'approved', [{ doc: 'ZW-2569-2-R1-0001', version: 1, size: 1 }]);
  await evaluationWithPdfs(c, 'submitted', [{ doc: 'ZW-2569-2-R1-0003', version: 1, size: 3 }]);
  await evaluationWithPdfs(d, 'approved', [{ doc: 'ZW-2569-2-R1-0004', version: 1, onDisk: false }]);
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  if (root) await rm(root, { recursive: true, force: true });
});

describe('merged round PDF (FR-D5)', () => {
  test('current versions of approved evaluations, in document order; a missing file is listed on a cover page', async () => {
    const out = await mergeRoundPdfs(db, admin, roundId, { root });
    expect(out.filename).toBe('round-2569-2-r1.pdf');
    expect(out.documents).toBe(2);
    expect(out.missing).toEqual(['ZW-2569-2-R1-0004 v1']);
    const merged = await PDFDocument.load(out.bytes);
    // cover (A4) + R1-0001 (width 201) + R1-0002 v2 (width 202); never the superseded v1 or the unapproved one
    expect(merged.getPages().map((p) => Math.round(p.getWidth()))).toEqual([595, 201, 202]);
  });

  test('staff only; an unknown round is 404', async () => {
    await expect(mergeRoundPdfs(db, teacher, roundId, { root })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(mergeRoundPdfs(db, admin, newId(), { root })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('when every file is present there is no cover page', async () => {
    await db.delete(pdfDocuments).where(eq(pdfDocuments.docNumber, 'ZW-2569-2-R1-0004'));
    const merged = await PDFDocument.load((await mergeRoundPdfs(db, admin, roundId, { root })).bytes);
    expect(merged.getPageCount()).toBe(2);
  });
});
