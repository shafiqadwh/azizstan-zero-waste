/** T22: PDF job against PostgreSQL with a fake renderer (layout and fonts are checked in e2e/pdf.spec.ts). */
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { evaluations, evidence, pdfDocuments, roundClassAreas, rounds, scoreComponents } from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { LoginRateLimiter } from '../auth/rate-limit.ts';
import type { PdfRenderer } from '../pdf/renderer.ts';
import { pdfToken, verifyPdfToken } from '../pdf/token.ts';
import type { SessionUser } from '../policies/index.ts';
import { writeDataFile } from '../storage.ts';
import { login, upsertSuperAdmin } from './auth.service.ts';
import { assignDuty } from './duty.service.ts';
import { readPdf, renderEvaluationPdf, sweepQueuedPdfs } from './pdf.service.ts';
import { linkClassRoom, setTermClasses, upsertArea, upsertClass, upsertPhysicalRoom } from './place.service.ts';
import { activateTerm, createTerm } from './term.service.ts';
import { createUser } from './user.service.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_pdf_${randomBytes(4).toString('hex')}`;
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

const now = new Date('2026-11-17T03:20:00Z');
const meta = { ip: '10.0.0.15', userAgent: 'vitest' };
let db: Db;
let close: () => Promise<void>;
let root: string;
let admin: SessionUser;
let teacher: SessionUser;
let outsider: SessionUser;
let roundId: string;
let evalA: string;
let evalB: string;

/** Records the HTML and returns a recognisable fake PDF. */
const htmls: string[] = [];
const fake: PdfRenderer = {
  async render(html) {
    htmls.push(html);
    return Buffer.from(`%PDF-fake ${htmls.length}`);
  },
  async close() {},
};

async function evaluation(classId: string, status: 'approved' | 'submitted', approvedBy: string | null) {
  const id = newId();
  const comps = await db.select().from(scoreComponents);
  await db.insert(evaluations).values({
    id,
    roundId,
    componentId: comps.find((c) => c.key === 'room')!.id,
    targetType: 'class',
    targetClassId: classId,
    ownerId: teacher.id,
    score: '4.500',
    comment: 'ห้องสะอาด <script>x</script>',
    roomNumberAtEval: '121',
    status,
    firstSubmittedAt: now,
    selfEditUntil: now,
    lastEditedAt: now,
    approvedBy,
    pdfStatus: status === 'approved' ? 'queued' : 'none',
  });
  const photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#4a7' } })
    .webp()
    .toBuffer();
  for (const [i, kind] of (['site', 'site', 'signature'] as const).entries()) {
    const evId = newId();
    const filePath = `uploads/ab/${evId}.webp`;
    await writeDataFile(filePath, photo, root);
    await db.insert(evidence).values({
      id: evId,
      evaluationId: id,
      uploadedBy: teacher.id,
      kind,
      filePath,
      sha256: evId,
      width: 40,
      height: 30,
      bytes: photo.length,
      capturedAt: now,
      sortOrder: i,
    });
  }
  return id;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'zw-pdf-'));
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
  admin = await mk('adm', 'แอดมิน', 'admin');
  teacher = await mk('t.one', 'ครูกามัล', 'teacher');
  outsider = await mk('t.out', 'ครูนอก', 'teacher');
  const b1 = await upsertArea(db, admin, { type: 'building', code: '1', name: 'อาคาร 1' }, meta, now);
  const r121 = await upsertPhysicalRoom(db, admin, { buildingId: b1, roomNumber: '121', floor: 2 }, meta, now);
  const cls = (roomNo: number, name: string) =>
    upsertClass(
      db,
      admin,
      { track: 'general', gradeCode: 'M1', gradeLabel: 'ม.1', rankGroup: 'ม.1', roomNo, name },
      meta,
      now,
    );
  const A = await cls(1, 'Amanah');
  const B = await cls(2, 'Berdikari');
  await linkClassRoom(db, admin, { classId: A, physicalRoomId: r121, effectiveFrom: '2026-11-01' }, meta, now);
  const termId = await createTerm(db, admin, { academicYear: 2569, termNo: 2 }, meta, now);
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
  await db.insert(roundClassAreas).values({ roundId, classId: A, areaId: b1, physicalRoomId: r121 });
  await assignDuty(
    db,
    admin,
    { termId, userId: teacher.id, duty: 'committee', targetType: 'class', targetId: A },
    meta,
    now,
  );
  evalA = await evaluation(A, 'approved', admin.id);
  evalB = await evaluation(B, 'submitted', null);
});

afterAll(async () => {
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await rm(root, { recursive: true, force: true });
});

describe('pdf.render', () => {
  test('the sweep enqueues queued evaluations only', async () => {
    const sent: string[] = [];
    expect(await sweepQueuedPdfs(db, async (id) => void sent.push(id))).toBe(1);
    expect(sent).toEqual([evalA]);
  });

  test('first version: number, file, row, status ready; HTML carries the data, escapes text, draft watermark', async () => {
    const out = await renderEvaluationPdf(db, evalA, now, fake, { root });
    expect(out?.version).toBe(1);
    const [pdf] = await db.select().from(pdfDocuments).where(eq(pdfDocuments.evaluationId, evalA));
    expect(pdf).toMatchObject({
      docNumber: 'ZW-2569-2-R1-0001',
      version: 1,
      isDraft: true,
      filePath: 'pdf/2569/ZW-2569-2-R1-0001-v1.pdf',
      supersededAt: null,
    });
    expect(await readFile(path.join(root, pdf!.filePath), 'utf8')).toBe('%PDF-fake 1');
    expect((await db.select().from(evaluations).where(eq(evaluations.id, evalA)))[0]!.pdfStatus).toBe('ready');
    const html = htmls.at(-1)!;
    for (const text of [
      'แบบรายงานผลการประเมินความสะอาดห้องเรียน',
      '121 · ม.1 Amanah',
      'อาคาร 1 ชั้น 2',
      'ภาคเรียนที่ 2/2569',
      'ครูกามัล',
      'แอดมิน',
      '>4.5<',
      'จากคะแนนเต็ม 5',
      '17 พ.ย. 2569 10:20 น.',
      'เลขที่เอกสาร ZW-2569-2-R1-0001 · ฉบับที่ 1',
      'ฉบับร่าง',
      'ใบลงชื่อนักเรียน',
      "font-family:'Sarabun'",
    ])
      expect(html).toContain(text);
    expect(html).toContain('&lt;script&gt;'); // comment is escaped
    expect(html).not.toContain('<script>x');
    expect(html.match(/<img class="site"/g)).toHaveLength(2);
    expect(html).not.toMatch(/https?:\/\//); // no network: fonts and images are inline
  });

  test('a new version keeps the number, supersedes the old one; finalized → no watermark', async () => {
    await db.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, roundId));
    const out = await renderEvaluationPdf(db, evalA, now, fake, { root });
    expect(out?.version).toBe(2);
    const rows = await db.select().from(pdfDocuments).where(eq(pdfDocuments.evaluationId, evalA));
    const v1 = rows.find((r) => r.version === 1)!;
    const v2 = rows.find((r) => r.version === 2)!;
    expect(v1.supersededAt).toEqual(now);
    expect(v2).toMatchObject({ docNumber: 'ZW-2569-2-R1-0001', isDraft: false, supersededAt: null });
    expect(htmls.at(-1)).not.toContain('class="watermark"');
    await db.update(rounds).set({ status: 'open' }).where(eq(rounds.id, roundId));
  });

  test('not approved → no PDF; a renderer error marks the evaluation failed and rethrows', async () => {
    expect(await renderEvaluationPdf(db, evalB, now, fake, { root })).toBeNull();
    const broken: PdfRenderer = {
      render: async () => Promise.reject(new Error('chromium crashed')),
      close: async () => {},
    };
    await expect(renderEvaluationPdf(db, evalA, now, broken, { root })).rejects.toThrow('chromium crashed');
    expect((await db.select().from(evaluations).where(eq(evaluations.id, evalA)))[0]).toMatchObject({
      pdfStatus: 'failed',
      pdfError: 'chromium crashed',
    });
  });
});

describe('download and internal token', () => {
  test('staff, the owner and the committee read it; others are refused', async () => {
    const [pdf] = (await db.select().from(pdfDocuments).where(eq(pdfDocuments.evaluationId, evalA))).filter(
      (r) => r.version === 2,
    );
    expect((await readPdf(db, admin, pdf!.id, now, { root })).fileName).toBe('ZW-2569-2-R1-0001-v2.pdf');
    expect((await readPdf(db, teacher, pdf!.id, now, { root })).data.toString()).toBe('%PDF-fake 2');
    await expect(readPdf(db, outsider, pdf!.id, now, { root })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(readPdf(db, null, pdf!.id, now, { root })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(readPdf(db, admin, 'nope', now, { root })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('HMAC token: valid for 5 minutes, for that evaluation, with that secret', () => {
    const t = pdfToken('secret', evalA, now);
    expect(verifyPdfToken('secret', evalA, t, now)).toBe(true);
    expect(verifyPdfToken('secret', evalB, t, now)).toBe(false);
    expect(verifyPdfToken('other', evalA, t, now)).toBe(false);
    expect(verifyPdfToken(undefined, evalA, t, now)).toBe(false);
    expect(verifyPdfToken('secret', evalA, t, new Date(now.getTime() + 6 * 60_000))).toBe(false);
  });
});
