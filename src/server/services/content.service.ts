/**
 * Public content managed by admins (T24): appointment orders (PDF files shown on `/orders`) and guide pages
 * (Markdown shown on `/guide`). Every change is audited; the public pages refresh through the cache tag.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { newId } from '../../lib/ids.ts';
import { AppError, notFound, parseInput, validation } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as repo from '../repositories/content.repository.ts';
import * as places from '../repositories/places.repository.ts';
import { dataDir, removeDataFile, resolveData, writeDataFile } from '../storage.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';

export const ORDER_MAX_BYTES = 10 * 1024 * 1024;

export const CONTENT_MSG = {
  noTerm: 'ยังไม่มีภาคเรียนที่ใช้งาน',
  title: 'กรุณาระบุชื่อเอกสาร (ไม่เกิน 120 ตัวอักษร)',
  notPdf: 'ไฟล์ต้องเป็น PDF',
  tooLarge: 'ไฟล์ต้องไม่เกิน 10 MB',
  slug: 'ชื่อในลิงก์ใช้ได้เฉพาะ a-z 0-9 และ - (ไม่เกิน 60 ตัว)',
  slugTaken: 'มีหน้าที่ใช้ชื่อในลิงก์นี้แล้ว',
  body: 'เนื้อหาต้องไม่เกิน 20,000 ตัวอักษร',
} as const;

// ───────────── appointment orders ─────────────

export async function uploadOrder(
  db: Db,
  actor: SessionUser,
  input: { title: string; file: Uint8Array },
  meta: ClientMeta,
  now: Date,
  opts: { root?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'content.manage');
  const title = input.title.trim();
  if (!title || [...title].length > 120) throw validation('title', CONTENT_MSG.title);
  if (input.file.byteLength > ORDER_MAX_BYTES) throw validation('file', CONTENT_MSG.tooLarge);
  if (Buffer.from(input.file.subarray(0, 5)).toString('latin1') !== '%PDF-')
    throw validation('file', CONTENT_MSG.notPdf);
  const term = await places.findActiveTerm(db);
  if (!term) throw new AppError('VALIDATION', { message: CONTENT_MSG.noTerm });
  const id = newId();
  const filePath = `orders/${term.academicYear}/${id}.pdf`;
  await writeDataFile(filePath, input.file, opts.root ?? dataDir());
  const existing = await repo.listOrders(db, term.id);
  await withTransaction(db, async (tx) => {
    await repo.insertOrder(tx, {
      id,
      termId: term.id,
      title,
      filePath,
      sortOrder: existing.length,
      uploadedBy: actor.id,
      createdAt: now,
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'order.create',
        entity: 'appointment_order',
        entityId: id,
        after: { title, bytes: input.file.byteLength },
        ip: meta.ip,
      },
      now,
    );
  });
  return { id };
}

export async function deleteOrder(
  db: Db,
  actor: SessionUser,
  id: string,
  meta: ClientMeta,
  now: Date,
  opts: { root?: string } = {},
) {
  assertCan(actor, 'content.manage');
  const order = await repo.findOrder(db, id);
  if (!order) throw notFound();
  await withTransaction(db, async (tx) => {
    await repo.deleteOrder(tx, id);
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'order.delete',
        entity: 'appointment_order',
        entityId: id,
        before: { title: order.title },
        ip: meta.ip,
      },
      now,
    );
  });
  await removeDataFile(order.filePath, opts.root ?? dataDir());
}

/** GET /api/v1/orders/{id} — public: orders are published documents. */
export async function readOrderFile(db: Db, id: string, opts: { root?: string } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const order = await repo.findOrder(db, id);
  if (!order) throw notFound();
  try {
    return { data: await readFile(resolveData(order.filePath, opts.root ?? dataDir())), title: order.title };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound();
    throw err;
  }
}

// ───────────── guide pages ─────────────

export const guideInput = z.object({
  id: z.uuid().optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, CONTENT_MSG.slug)
    .max(60, CONTENT_MSG.slug),
  title: z.string().trim().min(1, CONTENT_MSG.title).max(120, CONTENT_MSG.title),
  bodyMd: z.string().max(20_000, CONTENT_MSG.body),
  audience: z.enum(['public', 'committee', 'admin']),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export async function saveGuidePage(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof guideInput>,
  meta: ClientMeta,
  now: Date,
): Promise<{ id: string }> {
  assertCan(actor, 'content.manage');
  const input = parseInput(guideInput, raw);
  return withTransaction(db, async (tx) => {
    const same = await repo.findGuidePage(tx, input.slug);
    if (same && same.id !== input.id) throw validation('slug', CONTENT_MSG.slugTaken);
    const before = input.id ? await repo.findGuidePageById(tx, input.id) : null;
    if (input.id && !before) throw notFound();
    const id = input.id ?? newId();
    const row = {
      slug: input.slug,
      title: input.title,
      bodyMd: input.bodyMd,
      audience: input.audience,
      sortOrder: input.sortOrder,
      updatedAt: now,
    };
    if (before) await repo.updateGuidePage(tx, id, row);
    else await repo.insertGuidePage(tx, { id, ...row });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: before ? 'guide.update' : 'guide.create',
        entity: 'guide_page',
        entityId: id,
        before: before ? { slug: before.slug, title: before.title, audience: before.audience } : undefined,
        after: { slug: row.slug, title: row.title, audience: row.audience, length: row.bodyMd.length },
        ip: meta.ip,
      },
      now,
    );
    return { id };
  });
}

export async function deleteGuidePage(db: Db, actor: SessionUser, id: string, meta: ClientMeta, now: Date) {
  assertCan(actor, 'content.manage');
  await withTransaction(db, async (tx) => {
    const page = await repo.findGuidePageById(tx, id);
    if (!page) throw notFound();
    await repo.deleteGuidePage(tx, id);
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'guide.delete',
        entity: 'guide_page',
        entityId: id,
        before: { slug: page.slug, title: page.title },
        ip: meta.ip,
      },
      now,
    );
  });
}

export async function listGuideForAdmin(db: Db, actor: SessionUser) {
  assertCan(actor, 'staff.read');
  return repo.listGuidePages(db);
}

export async function listOrdersForAdmin(db: Db, actor: SessionUser) {
  assertCan(actor, 'staff.read');
  const term = await places.findActiveTerm(db);
  return term ? repo.listOrders(db, term.id) : [];
}
