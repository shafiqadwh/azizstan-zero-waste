/**
 * Evidence photos (FR-E3, BR-V1..V3, 05-api §3): upload → stamped WebP under DATA_DIR + an orphan `evidence`
 * row (attached to an evaluation later, T18), and permission-checked reads with optional thumbnails.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { bangkokDateString, formatStampDateTime } from '../../lib/dates/index.ts';
import { newId } from '../../lib/ids.ts';
import { AppError, forbidden, notFound, parseInput } from '../errors.ts';
import { checkImage, processEvidenceImage, resizeWebp } from '../evidence/image.ts';
import { THUMB_WIDTHS } from '../evidence/paths.ts';
import { assertCan, can, type SessionUser } from '../policies/index.ts';
import { SlidingWindowLimiter } from '../rate-limit.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as repo from '../repositories/evidence.repository.ts';
import * as places from '../repositories/places.repository.ts';
import { dataDir, dataFileExists, resolveData, writeDataFile } from '../storage.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';

export const UPLOADS_PER_MINUTE = 30;

const g = globalThis as typeof globalThis & { __zwUploadLimiter?: SlidingWindowLimiter };
/** 05-api §3: 30 uploads per minute per user (process-wide, survives dev hot reloads). */
export function uploadLimiter(): SlidingWindowLimiter {
  g.__zwUploadLimiter ??= new SlidingWindowLimiter(UPLOADS_PER_MINUTE, 60_000);
  return g.__zwUploadLimiter;
}

export const EVIDENCE_MSG = {
  noActiveTerm: 'ยังไม่มีภาคเรียนที่เปิดใช้',
  badTarget: 'ไม่พบห้องเรียนหรือพื้นที่ที่จะประเมิน',
} as const;

export const uploadInput = z.object({
  kind: z.enum(['site', 'signature']),
  // "class:<uuid>" | "area:<uuid>"
  targetRef: z.string().regex(/^(class|area):[0-9a-f-]{36}$/i, EVIDENCE_MSG.badTarget),
});

export interface UploadResult {
  evidenceId: string;
  url: string;
  capturedAt: Date;
}

export const evidenceUrl = (id: string, w?: number) => `/api/v1/files/${id}${w ? `?w=${w}` : ''}`;

/**
 * The upload's target in the active term and the text stamped on the photo. Scoring needs a committee duty on
 * the target (BR-P1), whatever the role (BR-P4), so uploading does too.
 */
async function resolveTarget(db: Db, actor: SessionUser, targetRef: string, now: Date) {
  const [type, id] = targetRef.split(':') as ['class' | 'area', string];
  const term = await places.findActiveTerm(db);
  if (!term) throw new AppError('VALIDATION', { message: EVIDENCE_MSG.noActiveTerm });
  const target = type === 'class' ? { classId: id } : { areaId: id };
  const hasDuty = await dutiesRepo.hasCommitteeDutyFor(db, term.id, actor.id, target, now);
  assertCan(actor, 'evaluation.create', { hasDuty });
  if (type === 'area') {
    const area = await places.findArea(db, id);
    if (!area) throw new AppError('VALIDATION', { field: 'targetRef', message: EVIDENCE_MSG.badTarget });
    return area.name;
  }
  const cls = await places.findClass(db, id);
  if (!cls) throw new AppError('VALIDATION', { field: 'targetRef', message: EVIDENCE_MSG.badTarget });
  const link = await places.linkOfClassOnDate(db, cls.id, bangkokDateString(now));
  const room = link ? await places.findRoom(db, link.physicalRoomId) : null;
  return room ? `${room.roomNumber} · ${cls.displayName}` : cls.displayName;
}

export async function uploadEvidence(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof uploadInput> & { data: Uint8Array },
  meta: ClientMeta,
  now: Date,
  opts: { root?: string; limiter?: SlidingWindowLimiter } = {},
): Promise<UploadResult> {
  const input = parseInput(uploadInput, raw);
  const targetLabel = await resolveTarget(db, actor, input.targetRef, now);
  if (!(opts.limiter ?? uploadLimiter()).tryHit(actor.id, now)) throw new AppError('RATE_LIMITED');
  await checkImage(raw.data); // cheap header check before the heavy work

  // BR-V2: the stamped time is the server's receive time
  const image = await processEvidenceImage(raw.data, `${formatStampDateTime(now)} · ${targetLabel}`);
  const sha256 = createHash('sha256').update(image.data).digest('hex');
  const filePath = `uploads/${sha256.slice(0, 2)}/${sha256}.webp`;
  await writeDataFile(filePath, image.data, opts.root ?? dataDir());

  const id = newId();
  await withTransaction(db, async (tx) => {
    await repo.insertEvidence(tx, {
      id,
      evaluationId: null,
      uploadedBy: actor.id,
      kind: input.kind,
      filePath,
      sha256,
      width: image.width,
      height: image.height,
      bytes: image.data.byteLength,
      capturedAt: now,
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'evidence.upload',
        entity: 'evidence',
        entityId: id,
        after: { kind: input.kind, targetRef: input.targetRef, sha256, bytes: image.data.byteLength },
        ip: meta.ip,
      },
      now,
    );
  });
  return { evidenceId: id, url: evidenceUrl(id), capturedAt: now };
}

/**
 * Who may see a photo (05-api §3): staff (admin, executive, super admin), the uploader, and committee members of
 * the evaluation's target. A removed photo stays visible to staff only (kept as evidence, FR-S2).
 */
async function mayRead(db: Db, actor: SessionUser, row: repo.EvidenceRow, now: Date): Promise<boolean> {
  if (can(actor, 'staff.read')) return true;
  if (row.removedAt) return false;
  if (row.uploadedBy === actor.id) return true;
  if (!row.evaluationId) return false;
  const target = await repo.findEvaluationTarget(db, row.evaluationId);
  if (!target) return false;
  if (target.ownerId === actor.id) return true;
  const ownTarget = await dutiesRepo.hasCommitteeDutyFor(
    db,
    target.termId,
    actor.id,
    { classId: target.targetClassId, areaId: target.targetAreaId },
    now,
  );
  return can(actor, 'staff.read', { ownTarget });
}

export interface EvidenceFile {
  data: Buffer;
  etag: string;
}

/** A row whose file is gone (restored backup, manual cleanup) is a 404, not a crash. */
async function readStored(relative: string, root: string): Promise<Buffer> {
  try {
    return await readFile(resolveData(relative, root));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound();
    throw err;
  }
}

/** GET /files/{id}?w= — the stored WebP, or a cached smaller copy for w ∈ THUMB_WIDTHS. */
export async function readEvidenceFile(
  db: Db,
  actor: SessionUser | null,
  id: string,
  width: number | null,
  now: Date,
  opts: { root?: string } = {},
): Promise<EvidenceFile> {
  if (!actor) throw new AppError('UNAUTHENTICATED');
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw notFound();
  const row = await repo.findEvidence(db, parsed.data);
  if (!row) throw notFound();
  if (!(await mayRead(db, actor, row, now))) throw forbidden();
  const root = opts.root ?? dataDir();
  const w = THUMB_WIDTHS.find((t) => t === width);
  if (!w) return { data: await readStored(row.filePath, root), etag: row.sha256 };
  const thumbPath = row.filePath.replace(/\.webp$/, `_w${w}.webp`);
  if (await dataFileExists(thumbPath, root)) {
    return { data: await readFile(resolveData(thumbPath, root)), etag: `${row.sha256}-w${w}` };
  }
  const thumb = await resizeWebp(await readStored(row.filePath, root), w);
  await writeDataFile(thumbPath, thumb, root);
  return { data: thumb, etag: `${row.sha256}-w${w}` };
}
