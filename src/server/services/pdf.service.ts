/**
 * Evaluation PDFs (09-pdf, FR-D1/D2, T22): data for the template, the render job (versions, document numbers,
 * superseding older versions, pdf_status), the queue sweep and permission-checked downloads.
 */
import { readFile } from 'node:fs/promises';
import type { Db } from '../../../db/client.ts';
import { formatTermLabel, formatThaiDateTime } from '../../lib/dates/index.ts';
import { newId } from '../../lib/ids.ts';
import { parseScore, toDisplay } from '../../lib/scoring/decimal.ts';
import { trimScore } from '../../lib/term/config.ts';
import { AppError, notFound } from '../errors.ts';
import { sarabunCss } from '../pdf/fonts.ts';
import type { PdfRenderer } from '../pdf/renderer.ts';
import { evaluationHtml, type EvaluationPdfData } from '../pdf/template.ts';
import { can, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as evalRepo from '../repositories/evaluations.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as repo from '../repositories/pdf.repository.ts';
import * as roundsRepo from '../repositories/rounds.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import * as usersRepo from '../repositories/users.repository.ts';
import { dataDir, resolveData, writeDataFile } from '../storage.ts';
import { withTransaction } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';

export const PDF_RENDER_QUEUE = 'pdf.render';

const show = (s: string) => trimScore(toDisplay(parseScore(s)));

async function dataUri(relative: string, root: string): Promise<string | null> {
  try {
    return `data:image/webp;base64,${(await readFile(resolveData(relative, root))).toString('base64')}`;
  } catch {
    return null; // a missing file leaves its cell out rather than failing the whole document
  }
}

export interface PreparedPdf {
  data: EvaluationPdfData;
  evaluation: evalRepo.EvaluationRow;
  docNumber: string;
  version: number;
  academicYear: number;
}

/** Everything the template needs; the document number is reused across versions of one evaluation. */
export async function preparePdf(db: Db, evaluationId: string, now: Date, root = dataDir()): Promise<PreparedPdf> {
  const e = await evalRepo.findEvaluation(db, evaluationId);
  if (!e) throw notFound();
  const round = (await termsRepo.findRound(db, e.roundId))!;
  const term = (await places.findTerm(db, round.termId))!;
  const component = (await termsRepo.listComponents(db, term.id)).find((c) => c.id === e.componentId)!;
  const override = (await termsRepo.listRoundMax(db, [round.id])).find((m) => m.componentId === component.id);
  const owner = await usersRepo.findUserById(db, e.ownerId);
  const approver = e.approvedBy ? await usersRepo.findUserById(db, e.approvedBy) : null;
  const photos = await evalRepo.listEvaluationEvidence(db, e.id);

  let target: string;
  let place: string | null = null;
  if (e.targetType === 'class') {
    const cls = await places.findClass(db, e.targetClassId!);
    target = `${e.roomNumberAtEval ? `${e.roomNumberAtEval} · ` : ''}${cls?.displayName ?? '–'}`;
    const frozen = (await roundsRepo.listRoundClassAreas(db, round.id)).find((r) => r.classId === e.targetClassId);
    const room = frozen?.physicalRoomId ? await places.findRoom(db, frozen.physicalRoomId) : null;
    const area = frozen ? await places.findArea(db, frozen.areaId) : null;
    place = area ? `${area.name}${room?.floor != null ? ` ชั้น ${room.floor}` : ''}` : null;
  } else {
    const area = await places.findArea(db, e.targetAreaId!);
    target = area?.name ?? '–';
    place = area?.description ?? null;
  }

  const existing = await repo.listPdfs(db, e.id);
  const version = (existing[0]?.version ?? 0) + 1;
  const seq = existing[0] ? null : (await repo.countNumberedInRound(db, round.id)) + 1;
  const docNumber =
    existing[0]?.docNumber ??
    `ZW-${term.academicYear}-${term.termNo}-R${round.roundNo}-${String(seq).padStart(4, '0')}`;

  const site = [];
  for (const p of photos.filter((x) => x.kind === 'site')) {
    const uri = await dataUri(p.filePath, root);
    if (uri) site.push(uri);
  }
  const sig = photos.find((x) => x.kind === 'signature');
  return {
    evaluation: e,
    docNumber,
    version,
    academicYear: term.academicYear,
    data: {
      kind: e.targetType,
      termLabel: formatTermLabel(term.termNo, term.academicYear),
      target,
      place,
      roundNo: round.roundNo,
      evaluatedAt: formatThaiDateTime(e.firstSubmittedAt),
      ownerName: owner?.displayName ?? '–',
      approverName: approver?.displayName ?? null,
      score: e.score === null ? '–' : show(e.score),
      max: show(override?.maxValue ?? component.maxValue),
      comment: e.comment ?? '',
      sitePhotos: site,
      signature: e.targetType === 'class' && sig ? await dataUri(sig.filePath, root) : null,
      docNumber,
      version,
      generatedAt: formatThaiDateTime(now),
      draft: round.status !== 'finalized',
    },
  };
}

export async function evaluationPdfHtml(db: Db, evaluationId: string, now: Date, root = dataDir()) {
  const prepared = await preparePdf(db, evaluationId, now, root);
  return evaluationHtml(prepared.data, await sarabunCss());
}

/**
 * Job `pdf.render`: only approved evaluations get a PDF. Writes `pdf/{year}/{docNumber}-v{n}.pdf`, inserts the
 * version, supersedes the older ones and sets `pdf_status = ready`. On error the status becomes `failed` with
 * the message (shown to admins) and the error is rethrown so pg-boss retries.
 */
export async function renderEvaluationPdf(
  db: Db,
  evaluationId: string,
  now: Date,
  renderer: PdfRenderer,
  opts: { root?: string } = {},
): Promise<{ pdfId: string; version: number } | null> {
  const root = opts.root ?? dataDir();
  const current = await evalRepo.findEvaluation(db, evaluationId);
  if (!current) return null;
  if (current.status !== 'approved') {
    await evalRepo.updateEvaluation(db, evaluationId, { pdfStatus: 'none', pdfError: null });
    return null;
  }
  try {
    const prepared = await preparePdf(db, evaluationId, now, root);
    const bytes = await renderer.render(evaluationHtml(prepared.data, await sarabunCss()));
    const filePath = `pdf/${prepared.academicYear}/${prepared.docNumber}-v${prepared.version}.pdf`;
    await writeDataFile(filePath, bytes, root);
    const id = newId();
    await withTransaction(db, async (tx) => {
      await repo.insertPdf(tx, {
        id,
        evaluationId,
        evaluationVersion: prepared.evaluation.version,
        docNumber: prepared.docNumber,
        version: prepared.version,
        isDraft: prepared.data.draft,
        filePath,
        createdAt: now,
      });
      await repo.supersedeOthers(tx, evaluationId, id, now);
      await evalRepo.updateEvaluation(tx, evaluationId, { pdfStatus: 'ready', pdfError: null });
      await writeAudit(
        tx,
        {
          actorId: null,
          action: 'pdf.render',
          entity: 'evaluation',
          entityId: evaluationId,
          after: {
            pdfId: id,
            docNumber: prepared.docNumber,
            version: prepared.version,
            draft: prepared.data.draft,
            bytes: bytes.byteLength,
          },
        },
        now,
      );
    });
    return { pdfId: id, version: prepared.version };
  } catch (err) {
    await evalRepo.updateEvaluation(db, evaluationId, {
      pdfStatus: 'failed',
      pdfError: String((err as Error).message ?? err).slice(0, 500),
    });
    throw err;
  }
}

/** Worker sweep: enqueue a render for every evaluation whose PDF is queued (approve, request, finalize). */
export async function sweepQueuedPdfs(db: Db, enqueue: (evaluationId: string) => Promise<unknown>) {
  const ids = await repo.listQueuedEvaluationIds(db);
  for (const id of ids) await enqueue(id);
  return ids.length;
}

/** GET /api/v1/pdf/{id}: staff, the owner, or a committee member of the target (same rule as evidence). */
export async function readPdf(
  db: Db,
  actor: SessionUser | null,
  pdfId: string,
  now: Date,
  opts: { root?: string } = {},
): Promise<{ data: Buffer; fileName: string }> {
  if (!actor) throw new AppError('UNAUTHENTICATED');
  if (!/^[0-9a-f-]{36}$/i.test(pdfId)) throw notFound();
  const pdf = await repo.findPdf(db, pdfId);
  if (!pdf) throw notFound();
  if (!can(actor, 'staff.read')) {
    const e = (await evalRepo.findEvaluation(db, pdf.evaluationId))!;
    const round = (await termsRepo.findRound(db, e.roundId))!;
    const ownTarget =
      e.ownerId === actor.id ||
      (await dutiesRepo.hasCommitteeDutyFor(
        db,
        round.termId,
        actor.id,
        { classId: e.targetClassId, areaId: e.targetAreaId },
        now,
      ));
    if (!can(actor, 'staff.read', { ownTarget })) throw new AppError('FORBIDDEN');
  }
  try {
    const data = await readFile(resolveData(pdf.filePath, opts.root ?? dataDir()));
    return { data, fileName: `${pdf.docNumber}-v${pdf.version}.pdf` };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound();
    throw err;
  }
}

/** The current (not superseded) PDF of an evaluation, for the "ดู PDF" link. */
export async function currentPdfId(db: Db, evaluationId: string): Promise<string | null> {
  const rows = await repo.listPdfs(db, evaluationId);
  return rows.find((r) => r.supersededAt === null)?.id ?? null;
}
