/**
 * Evaluations (FR-E*, BR-P1..P5, BR-E1..E9, 05-api "Committee"): submit / update / delete / resubmit by the owner,
 * approve / return by admins. Every mutation: policy → Zod → transaction → exactly one audit row (T-A1);
 * changes check the optimistic `version` (CONFLICT when someone changed it first).
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { formatThaiDateTime } from '../../lib/dates/index.ts';
import { checkContent, type ContentRules } from '../../lib/evaluation/validate.ts';
import { parseScore, toDb, toDisplay, type Th } from '../../lib/scoring/decimal.ts';
import { individualClassValue } from '../../lib/scoring/index.ts';
import { scoreStepFor, trimScore } from '../../lib/term/config.ts';
import { newId } from '../../lib/ids.ts';
import { AppError, notFound, parseInput } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as repo from '../repositories/evaluations.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import { withTransaction, type DbOrTx, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import { send } from './notify.service.ts';

export const EVALUATION_MSG = {
  componentNotUsed: 'ส่วนคะแนนนี้ไม่ได้ใช้ในภาคเรียนนี้',
  wrongTarget: 'ส่วนคะแนนนี้ไม่ได้ใช้กับเป้าหมายนี้',
  targetNotInTerm: 'ห้องเรียนหรือพื้นที่นี้ไม่ได้ใช้ในภาคเรียนนี้',
  badEvidence: 'รูปบางรูปใช้ไม่ได้ กรุณาถ่ายใหม่',
  approvedUseRequest: 'ผลประเมินนี้อนุมัติแล้ว แก้ไขได้โดยกด "ขออนุมัติแก้ไข"',
  voided: 'ผลประเมินนี้ถูกลบแล้ว',
  notReturned: 'แก้แล้วส่งใหม่ได้เฉพาะผลประเมินที่ถูกส่งกลับ',
  notWaiting: 'อนุมัติหรือส่งกลับได้เฉพาะผลประเมินที่รออนุมัติ',
  reasonRequired: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร',
  ownerNotAssigned: 'ผู้ประเมินไม่ได้รับมอบหมายให้ประเมินห้องนี้',
} as const;

const scoreValue = z.union([z.string(), z.number()]).nullable().optional();
const studentScore = z.object({ studentId: z.uuid(), score: scoreValue });
const target = z.object({ type: z.enum(['class', 'area']), id: z.uuid() });

const contentFields = {
  score: scoreValue,
  studentScores: z.array(studentScore).max(200).optional(),
  siteEvidenceIds: z.array(z.uuid()).max(20).optional(),
  signatureEvidenceId: z.uuid().nullable().optional(),
  comment: z.string().max(5000).nullable().optional(),
};

export const submitInput = z.object({ roundId: z.uuid(), componentId: z.uuid(), target, ...contentFields });
export const updateInput = z.object({ id: z.uuid(), expectedVersion: z.number().int().min(1), ...contentFields });
export const versionInput = z.object({ id: z.uuid(), expectedVersion: z.number().int().min(1) });
export const returnInput = versionInput.extend({ reason: z.string().trim() });

export interface EvaluationDTO {
  id: string;
  roundId: string;
  componentId: string;
  target: { type: 'class' | 'area'; id: string };
  ownerId: string;
  status: repo.EvaluationRow['status'];
  score: string | null;
  comment: string | null;
  roomNumberAtEval: string | null;
  siteEvidenceIds: string[];
  signatureEvidenceId: string | null;
  firstSubmittedAt: Date;
  selfEditUntil: Date;
  version: number;
}

/** Score input → thousandths; anything that is not a number becomes a field error, never a 500. */
function toTh(value: string | number | null | undefined, field: string): Th | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    return parseScore(value);
  } catch {
    throw new AppError('VALIDATION', { field, message: 'คะแนนไม่ถูกต้อง' });
  }
}

const showScore = (th: Th) => trimScore(toDisplay(th));

interface Context {
  round: NonNullable<Awaited<ReturnType<typeof termsRepo.findRound>>>;
  term: NonNullable<Awaited<ReturnType<typeof places.findTerm>>>;
  component: Awaited<ReturnType<typeof termsRepo.listComponents>>[number];
  max: Th;
  individual: boolean;
}

async function loadContext(tx: Tx, roundId: string, componentId: string): Promise<Context> {
  const round = await termsRepo.findRound(tx, roundId);
  if (!round) throw notFound();
  const term = (await places.findTerm(tx, round.termId))!;
  const component = (await termsRepo.listComponents(tx, term.id)).find((c) => c.id === componentId);
  if (!component || !component.enabled)
    throw new AppError('VALIDATION', { field: 'componentId', message: EVALUATION_MSG.componentNotUsed });
  const override = (await termsRepo.listRoundMax(tx, [round.id])).find((m) => m.componentId === component.id);
  return {
    round,
    term,
    component,
    max: parseScore(override?.maxValue ?? component.maxValue),
    // Individual mode scores students of a class; areas have no students (FR-R6); deductions are per class (T41)
    individual: component.unit === 'class' && component.kind === 'score' && term.roomMode === 'individual',
  };
}

async function targetLabel(tx: DbOrTx, t: repo.TargetKey): Promise<string> {
  if (t.type === 'class') return (await places.findClass(tx, t.id))?.displayName ?? '–';
  return (await places.findArea(tx, t.id))?.name ?? '–';
}

const targetOf = (e: repo.EvaluationRow): repo.TargetKey =>
  e.targetType === 'class' ? { type: 'class', id: e.targetClassId! } : { type: 'area', id: e.targetAreaId! };

interface NewContent {
  score: Th | null;
  studentScores: Map<string, Th | null>;
  siteIds: string[];
  signatureId: string | null;
  comment: string;
}

/**
 * BR-E1 on the content the evaluation will have after this call, plus the evidence checks: every photo must
 * exist, have the right kind, belong to the actor (or already to this evaluation) and not be removed.
 */
async function validateContent(
  tx: Tx,
  ctx: Context,
  t: repo.TargetKey,
  uploaderId: string,
  content: NewContent,
  evaluationId: string | null,
) {
  const rules: ContentRules = {
    max: ctx.max,
    step: scoreStepFor(ctx.term),
    // FR-E12 / Q4 (T41): a deduction needs at least one photo, a reason, and no signature sheet
    photoMin: ctx.component.kind === 'deduct' ? 1 : ctx.term.photoMin,
    photoMax: ctx.term.photoMax,
    requiresSignature: ctx.component.kind === 'deduct' ? false : ctx.component.requiresSignature,
    commentMax: ctx.term.commentMax,
    rosterIds: ctx.individual ? await repo.listRosterStudentIds(tx, ctx.round.id, t.id) : null,
    deduction: ctx.component.kind === 'deduct',
  };
  const error = checkContent(
    {
      score: content.score,
      studentScores: content.studentScores,
      siteCount: new Set(content.siteIds).size,
      hasSignature: content.signatureId !== null,
      comment: content.comment,
    },
    rules,
  );
  if (error) throw new AppError('VALIDATION', { field: error.field, message: error.message });
  const ids = [...content.siteIds, ...(content.signatureId ? [content.signatureId] : [])];
  const rows = await repo.listEvidenceByIds(tx, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const usable = (id: string, kind: 'site' | 'signature') => {
    const e = byId.get(id);
    if (!e || e.kind !== kind || e.removedAt) return false;
    return e.evaluationId === null ? e.uploadedBy === uploaderId : e.evaluationId === evaluationId;
  };
  if (
    new Set(content.siteIds).size !== content.siteIds.length ||
    !content.siteIds.every((id) => usable(id, 'site')) ||
    (content.signatureId !== null && !usable(content.signatureId, 'signature'))
  )
    throw new AppError('VALIDATION', { field: 'sitePhotos', message: EVALUATION_MSG.badEvidence });
}

function studentScoreMap(list: z.infer<typeof submitInput>['studentScores']): Map<string, Th | null> {
  return new Map((list ?? []).map((s) => [s.studentId, toTh(s.score, 'studentScores')]));
}

async function writeContent(tx: Tx, evaluationId: string, ctx: Context, content: NewContent, now: Date) {
  const current = await repo.listEvaluationEvidence(tx, evaluationId);
  const keep = new Set([...content.siteIds, ...(content.signatureId ? [content.signatureId] : [])]);
  await repo.markEvidenceRemoved(
    tx,
    current.filter((e) => !keep.has(e.id)).map((e) => e.id),
    now,
  );
  await repo.attachEvidence(tx, evaluationId, content.siteIds);
  if (content.signatureId) await repo.attachEvidence(tx, evaluationId, [content.signatureId]);
  if (ctx.individual) {
    await repo.replaceStudentScores(
      tx,
      evaluationId,
      [...content.studentScores].map(([studentId, s]) => ({ studentId, score: toDb(s!) })),
    );
  }
}

/** The number shown in notifications: the score, or the class mean in individual mode. */
function headline(ctx: Context, content: NewContent): Th | null {
  if (!ctx.individual) return content.score;
  return individualClassValue([...content.studentScores.values()].filter((v): v is Th => v !== null));
}

async function toDTO(tx: Tx | Db, id: string): Promise<EvaluationDTO> {
  const e = (await repo.findEvaluation(tx, id))!;
  const photos = await repo.listEvaluationEvidence(tx, id);
  return {
    id: e.id,
    roundId: e.roundId,
    componentId: e.componentId,
    target: targetOf(e),
    ownerId: e.ownerId,
    status: e.status,
    score: e.score,
    comment: e.comment,
    roomNumberAtEval: e.roomNumberAtEval,
    siteEvidenceIds: photos.filter((p) => p.kind === 'site').map((p) => p.id),
    signatureEvidenceId: photos.find((p) => p.kind === 'signature')?.id ?? null,
    firstSubmittedAt: e.firstSubmittedAt,
    selfEditUntil: e.selfEditUntil,
    version: e.version,
  };
}

const alreadyEvaluated = (name: string, at: Date) =>
  new AppError('ALREADY_EVALUATED', { params: { name, time: formatThaiDateTime(at) } });

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

// ───────────── submit (BR-P1..P5, BR-E1) ─────────────

export async function submitEvaluation(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof submitInput>,
  meta: ClientMeta,
  now: Date,
): Promise<EvaluationDTO> {
  const input = parseInput(submitInput, raw);
  const t: repo.TargetKey = input.target;
  try {
    return await withTransaction(db, async (tx) => {
      const ctx = await loadContext(tx, input.roundId, input.componentId);
      if (ctx.component.unit !== t.type)
        throw new AppError('VALIDATION', { field: 'target', message: EVALUATION_MSG.wrongTarget });

      // BR-P1 / BR-P4: only a duty matching the component's source counts, whatever the role (T41: area teachers)
      const hasDuty = await dutiesRepo.hasScoringDutyFor(
        tx,
        {
          termId: ctx.term.id,
          userId: actor.id,
          source: ctx.component.source,
          target: t.type === 'class' ? { classId: t.id } : { areaId: t.id },
          roundId: ctx.round.id,
        },
        now,
      );
      assertCan(actor, 'evaluation.create', { hasDuty });
      if (t.type === 'class' && !(await places.listTermClassIds(tx, ctx.term.id)).includes(t.id))
        throw new AppError('VALIDATION', { field: 'target', message: EVALUATION_MSG.targetNotInTerm });

      // BR-P2 / BR-T2: entry open, or an approved late-entry grant still running
      const open = ctx.round.status === 'open' && ctx.round.opensAt <= now && now < ctx.round.closesAt;
      if (!open) {
        const granted = await repo.hasLateEntryGrant(
          tx,
          { userId: actor.id, roundId: ctx.round.id, componentId: ctx.component.id, target: t },
          now,
        );
        if (!granted || ctx.round.status === 'scheduled' || ctx.round.status === 'finalized')
          throw new AppError('ENTRY_CLOSED');
      }

      // BR-P3: one live evaluation per (round, component, target)
      const live = await repo.findLiveEvaluation(tx, ctx.round.id, ctx.component.id, t);
      if (live) throw alreadyEvaluated(live.ownerName, live.evaluation.firstSubmittedAt);

      const content: NewContent = {
        score: ctx.individual ? null : toTh(input.score, 'score'),
        studentScores: studentScoreMap(input.studentScores),
        siteIds: input.siteEvidenceIds ?? [],
        signatureId: input.signatureEvidenceId ?? null,
        comment: (input.comment ?? '').trim(),
      };
      await validateContent(tx, ctx, t, actor.id, content, null);

      const id = newId();
      const selfEditUntil = new Date(now.getTime() + ctx.term.selfEditHours * 3600_000);
      await repo.insertEvaluation(tx, {
        id,
        roundId: ctx.round.id,
        componentId: ctx.component.id,
        targetType: t.type,
        targetClassId: t.type === 'class' ? t.id : null,
        targetAreaId: t.type === 'area' ? t.id : null,
        ownerId: actor.id,
        score: content.score === null ? null : toDb(content.score),
        comment: content.comment || null,
        roomNumberAtEval: t.type === 'class' ? await repo.frozenRoomNumber(tx, ctx.round.id, t.id) : null,
        status: 'submitted',
        firstSubmittedAt: now,
        selfEditUntil,
        lastEditedAt: now,
        version: 1,
        createdAt: now,
      });
      await writeContent(tx, id, ctx, content, now);
      // BR-TM2: the first evaluation of the term locks its configuration
      if (!ctx.term.configLockedAt) await termsRepo.updateTerm(tx, ctx.term.id, { configLockedAt: now });

      const label = await targetLabel(tx, t);
      const value = headline(ctx, content);
      await writeAudit(
        tx,
        {
          actorId: actor.id,
          action: 'evaluation.submit',
          entity: 'evaluation',
          entityId: id,
          after: {
            roundId: ctx.round.id,
            componentId: ctx.component.id,
            target: t,
            score: value,
            photos: content.siteIds.length,
          },
          ip: meta.ip,
        },
        now,
      );
      await send(
        tx,
        {
          userIds: await repo.listAdminIds(tx),
          type: 'evaluation_submitted',
          title: 'มีการใส่คะแนนใหม่',
          body: `${actor.displayName} ใส่คะแนน ${label} ได้ ${value === null ? '–' : showScore(value)}/${showScore(ctx.max)}`,
          link: '/monitor',
        },
        now,
      );
      return toDTO(tx, id);
    });
  } catch (err) {
    // BR-P5: a concurrent submit won the unique index; report the winner (read after our rollback)
    if (!isUniqueViolation(err)) throw err;
    const winner = await repo.findLiveEvaluation(db, input.roundId, input.componentId, t);
    if (!winner) throw err;
    throw alreadyEvaluated(winner.ownerName, winner.evaluation.firstSubmittedAt);
  }
}

// ───────────── owner changes (BR-E2..E5, BR-E8) ─────────────

async function lockOwned(tx: Tx, actor: SessionUser, id: string, expectedVersion: number, now: Date) {
  const e = await repo.lockEvaluation(tx, id);
  if (!e) throw notFound();
  // BR-E4: anyone else goes through a request (the UI offers "ขออนุมัติแก้ไข")
  if (e.ownerId !== actor.id) throw new AppError('FORBIDDEN');
  if (e.status === 'void') throw new AppError('VALIDATION', { message: EVALUATION_MSG.voided });
  if (e.status === 'approved') throw new AppError('VALIDATION', { message: EVALUATION_MSG.approvedUseRequest });
  if (e.version !== expectedVersion) throw new AppError('CONFLICT');
  // BR-E2/E3: the window, not the round, decides
  if (now >= e.selfEditUntil) throw new AppError('EDIT_WINDOW_PASSED');
  return e;
}

async function currentContent(tx: Tx, e: repo.EvaluationRow): Promise<NewContent> {
  const photos = await repo.listEvaluationEvidence(tx, e.id);
  const students = await repo.listStudentScores(tx, e.id);
  return {
    score: e.score === null ? null : parseScore(e.score),
    studentScores: new Map(students.map((s) => [s.studentId, parseScore(s.score)])),
    siteIds: photos.filter((p) => p.kind === 'site').map((p) => p.id),
    signatureId: photos.find((p) => p.kind === 'signature')?.id ?? null,
    comment: e.comment ?? '',
  };
}

function merge(ctx: Context, before: NewContent, input: z.infer<typeof updateInput>): NewContent {
  return {
    score: ctx.individual ? null : input.score !== undefined ? toTh(input.score, 'score') : before.score,
    studentScores: input.studentScores !== undefined ? studentScoreMap(input.studentScores) : before.studentScores,
    siteIds: input.siteEvidenceIds ?? before.siteIds,
    signatureId: input.signatureEvidenceId !== undefined ? input.signatureEvidenceId : before.signatureId,
    comment: input.comment !== undefined ? (input.comment ?? '').trim() : before.comment,
  };
}

/** "คะแนน 4 → 4.5 / รูปภาพ / ข้อติชม" for `evaluation_changed` (11-jobs §2). */
function describeChange(before: NewContent, after: NewContent, ctx: Context): string {
  const parts: string[] = [];
  const b = headline(ctx, before);
  const a = headline(ctx, after);
  if (b !== a) parts.push(`คะแนน ${b === null ? '–' : showScore(b)} → ${a === null ? '–' : showScore(a)}`);
  const photos = (c: NewContent) => [...c.siteIds].sort().join() + '|' + (c.signatureId ?? '');
  if (photos(before) !== photos(after)) parts.push('รูปภาพ');
  if (before.comment !== after.comment) parts.push('ข้อติชม');
  return parts.join(' / ') || 'ข้อมูล';
}

async function notifyChanged(tx: Tx, actor: SessionUser, e: repo.EvaluationRow, what: string, now: Date) {
  await send(
    tx,
    {
      userIds: await repo.listAdminIds(tx),
      type: 'evaluation_changed',
      title: 'มีการแก้ไขผลประเมิน',
      body: `${actor.displayName} แก้ไข${what} ${await targetLabel(tx, targetOf(e))}`,
      link: '/monitor',
    },
    now,
  );
}

async function applyOwnerChange(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof updateInput>,
  meta: ClientMeta,
  now: Date,
  mode: 'update' | 'resubmit',
): Promise<EvaluationDTO> {
  const input = parseInput(updateInput, raw);
  return withTransaction(db, async (tx) => {
    const e = await lockOwned(tx, actor, input.id, input.expectedVersion, now);
    if (mode === 'resubmit' && e.status !== 'returned')
      throw new AppError('VALIDATION', { message: EVALUATION_MSG.notReturned });
    const ctx = await loadContext(tx, e.roundId, e.componentId);
    const t = targetOf(e);
    const before = await currentContent(tx, e);
    const after = merge(ctx, before, input);
    await validateContent(tx, ctx, t, actor.id, after, e.id);
    await writeContent(tx, e.id, ctx, after, now);
    await repo.updateEvaluation(tx, e.id, {
      score: after.score === null ? null : toDb(after.score),
      comment: after.comment || null,
      lastEditedAt: now,
      version: e.version + 1,
      ...(mode === 'resubmit' ? { status: 'submitted' as const } : {}),
    });
    const what = describeChange(before, after, ctx);
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: `evaluation.${mode}`,
        entity: 'evaluation',
        entityId: e.id,
        before: {
          score: headline(ctx, before),
          photos: before.siteIds.length,
          comment: before.comment,
          version: e.version,
        },
        after: {
          score: headline(ctx, after),
          photos: after.siteIds.length,
          comment: after.comment,
          version: e.version + 1,
        },
        ip: meta.ip,
      },
      now,
    );
    await notifyChanged(tx, actor, e, mode === 'resubmit' ? `${what} แล้วส่งใหม่` : what, now);
    return toDTO(tx, e.id);
  });
}

/** BR-E2: owner edits score, photos or comment inside the self-edit window. */
export const updateEvaluation = (
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof updateInput>,
  meta: ClientMeta,
  now: Date,
) => applyOwnerChange(db, actor, raw, meta, now, 'update');

/** BR-E8: returned → submitted after the owner's fixes (same validation as submit). */
export const resubmitEvaluation = (
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof updateInput>,
  meta: ClientMeta,
  now: Date,
) => applyOwnerChange(db, actor, raw, meta, now, 'resubmit');

/** BR-E5: owner deletes within the window → void (row kept, the slot frees up). */
export async function deleteEvaluation(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof versionInput>,
  meta: ClientMeta,
  now: Date,
): Promise<void> {
  const input = parseInput(versionInput, raw);
  await withTransaction(db, async (tx) => {
    const e = await lockOwned(tx, actor, input.id, input.expectedVersion, now);
    await repo.updateEvaluation(tx, e.id, { status: 'void', lastEditedAt: now, version: e.version + 1 });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'evaluation.delete',
        entity: 'evaluation',
        entityId: e.id,
        before: { status: e.status, score: e.score, version: e.version },
        after: { status: 'void', version: e.version + 1 },
        ip: meta.ip,
      },
      now,
    );
    await notifyChanged(tx, actor, e, 'ลบผลประเมิน', now);
  });
}

// ───────────── admin decisions (BR-E6, BR-E7) ─────────────

async function lockForDecision(
  tx: Tx,
  actor: SessionUser,
  action: 'evaluation.approve' | 'evaluation.return',
  id: string,
  expectedVersion: number,
  now: Date,
) {
  const e = await repo.lockEvaluation(tx, id);
  if (!e) throw notFound();
  const round = (await termsRepo.findRound(tx, e.roundId))!;
  // BR-E6 / Q10: any admin, unless the target has an approver — then only that admin (or a super admin)
  const approvers = await repo.listApproverIds(tx, round.termId, targetOf(e), now);
  assertCan(actor, action, {
    approverAssigned: approvers.length > 0,
    isApprover: approvers.includes(actor.id),
  });
  if (e.version !== expectedVersion) throw new AppError('CONFLICT');
  if (e.status !== 'submitted') throw new AppError('VALIDATION', { message: EVALUATION_MSG.notWaiting });
  return e;
}

/**
 * BR-E6: status approved and the PDF queued (`pdf_status = queued`; the T22 worker renders queued rows).
 * Live results are computed on read until finalize (T21), so nothing else needs refreshing here.
 */
export async function approveEvaluation(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof versionInput>,
  meta: ClientMeta,
  now: Date,
): Promise<EvaluationDTO> {
  const input = parseInput(versionInput, raw);
  return withTransaction(db, async (tx) => {
    const e = await lockForDecision(tx, actor, 'evaluation.approve', input.id, input.expectedVersion, now);
    await repo.updateEvaluation(tx, e.id, {
      status: 'approved',
      approvedAt: now,
      approvedBy: actor.id,
      pdfStatus: 'queued',
      pdfError: null,
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'evaluation.approve',
        entity: 'evaluation',
        entityId: e.id,
        before: { status: e.status },
        after: { status: 'approved', version: e.version },
        ip: meta.ip,
      },
      now,
    );
    return toDTO(tx, e.id);
  });
}

/** BR-E7: back to the owner with a reason; the window reopens for at least `self_edit_hours`. */
export async function returnEvaluation(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof returnInput>,
  meta: ClientMeta,
  now: Date,
): Promise<EvaluationDTO> {
  const input = parseInput(returnInput, raw);
  if ([...input.reason].length < 5)
    throw new AppError('VALIDATION', { field: 'reason', message: EVALUATION_MSG.reasonRequired });
  return withTransaction(db, async (tx) => {
    const e = await lockForDecision(tx, actor, 'evaluation.return', input.id, input.expectedVersion, now);
    const term = (await places.findTerm(tx, (await termsRepo.findRound(tx, e.roundId))!.termId))!;
    const reopened = new Date(now.getTime() + term.selfEditHours * 3600_000);
    const selfEditUntil = e.selfEditUntil > reopened ? e.selfEditUntil : reopened;
    await repo.updateEvaluation(tx, e.id, {
      status: 'returned',
      returnedAt: now,
      returnedReason: input.reason,
      selfEditUntil,
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'evaluation.return',
        entity: 'evaluation',
        entityId: e.id,
        before: { status: e.status, selfEditUntil: e.selfEditUntil },
        after: { status: 'returned', reason: input.reason, selfEditUntil },
        ip: meta.ip,
      },
      now,
    );
    await send(
      tx,
      {
        userIds: [e.ownerId],
        type: 'evaluation_returned',
        title: 'ผลประเมินถูกส่งกลับให้แก้',
        body: `${await targetLabel(tx, targetOf(e))}: ${input.reason}`,
        link: `/evaluate/${e.id}`,
      },
      now,
    );
    return toDTO(tx, e.id);
  });
}

// ───────────── approved requests (BR-Q3, BR-E9) ─────────────

export type RequestedChange =
  | {
      type: 'edit_score';
      score?: string | number | null;
      studentScores?: { studentId: string; score?: string | number | null }[];
    }
  | { type: 'edit_photos'; add: string[]; remove: string[] }
  | { type: 'edit_comment'; comment: string }
  | { type: 'move_target'; target: repo.TargetKey }
  | { type: 'delete' };

export interface AppliedChange {
  /** "คะแนน 4.5 → 3" etc. for notices and the audit row */
  what: string;
  before: unknown;
  after: unknown;
}

/**
 * Apply an approved request to a locked evaluation inside the approver's transaction (BR-Q3): the result is
 * re-validated as if it were a submit, so an invalid change makes the whole approval fail. An approved
 * evaluation stays approved, gets version + 1 and a new PDF (old versions superseded, BR-E9).
 */
export async function applyRequestedChange(
  tx: Tx,
  e: repo.EvaluationRow,
  change: RequestedChange,
  requesterId: string,
  now: Date,
): Promise<AppliedChange> {
  if (e.status === 'void') throw new AppError('VALIDATION', { message: EVALUATION_MSG.voided });
  const ctx = await loadContext(tx, e.roundId, e.componentId);
  const bump = {
    lastEditedAt: now,
    version: e.version + 1,
    ...(e.status === 'approved' ? { pdfStatus: 'queued', pdfError: null } : {}),
  };
  const finish = async (what: string, before: unknown, after: unknown) => {
    if (e.status === 'approved') await repo.supersedePdfs(tx, e.id, now);
    return { what, before, after };
  };

  if (change.type === 'delete') {
    await repo.updateEvaluation(tx, e.id, { ...bump, status: 'void', pdfStatus: e.pdfStatus });
    return finish('ลบผลประเมิน', { status: e.status }, { status: 'void' });
  }

  if (change.type === 'move_target') {
    const to = change.target;
    if (to.type !== ctx.component.unit)
      throw new AppError('VALIDATION', { field: 'target', message: EVALUATION_MSG.wrongTarget });
    if (to.type === 'class' && !(await places.listTermClassIds(tx, ctx.term.id)).includes(to.id))
      throw new AppError('VALIDATION', { field: 'target', message: EVALUATION_MSG.targetNotInTerm });
    // the owner must be assigned to the new target too (§6 move_target)
    const ownerHasDuty = await dutiesRepo.hasScoringDutyFor(
      tx,
      {
        termId: ctx.term.id,
        userId: e.ownerId,
        source: ctx.component.source,
        target: to.type === 'class' ? { classId: to.id } : { areaId: to.id },
        roundId: e.roundId,
      },
      now,
    );
    if (!ownerHasDuty) throw new AppError('VALIDATION', { field: 'target', message: EVALUATION_MSG.ownerNotAssigned });
    const live = await repo.findLiveEvaluation(tx, e.roundId, e.componentId, to);
    if (live) throw alreadyEvaluated(live.ownerName, live.evaluation.firstSubmittedAt);
    const from = targetOf(e);
    await repo.updateEvaluation(tx, e.id, {
      ...bump,
      targetClassId: to.type === 'class' ? to.id : null,
      targetAreaId: to.type === 'area' ? to.id : null,
      roomNumberAtEval: to.type === 'class' ? await repo.frozenRoomNumber(tx, e.roundId, to.id) : null,
    });
    return finish(
      `ย้ายไป ${await targetLabel(tx, to)}`,
      { target: from, label: await targetLabel(tx, from) },
      { target: to, label: await targetLabel(tx, to) },
    );
  }

  const before = await currentContent(tx, e);
  const after: NewContent = { ...before, studentScores: new Map(before.studentScores) };
  if (change.type === 'edit_score') {
    if (ctx.individual) after.studentScores = studentScoreMap(change.studentScores);
    else after.score = toTh(change.score, 'score');
  } else if (change.type === 'edit_comment') {
    after.comment = change.comment.trim();
  } else {
    const removed = new Set(change.remove);
    const added = await repo.listEvidenceByIds(tx, change.add);
    const kindOf = new Map(added.map((a) => [a.id, a.kind]));
    after.siteIds = [
      ...before.siteIds.filter((id) => !removed.has(id)),
      ...change.add.filter((id) => kindOf.get(id) === 'site'),
    ];
    const newSignature = change.add.find((id) => kindOf.get(id) === 'signature');
    after.signatureId =
      newSignature ?? (before.signatureId && !removed.has(before.signatureId) ? before.signatureId : null);
    if (change.add.some((id) => !kindOf.has(id)))
      throw new AppError('VALIDATION', { field: 'sitePhotos', message: EVALUATION_MSG.badEvidence });
  }
  await validateContent(tx, ctx, targetOf(e), requesterId, after, e.id);
  await writeContent(tx, e.id, ctx, after, now);
  await repo.updateEvaluation(tx, e.id, {
    ...bump,
    score: after.score === null ? null : toDb(after.score),
    comment: after.comment || null,
  });
  return finish(
    describeChange(before, after, ctx),
    { score: headline(ctx, before), photos: before.siteIds.length, comment: before.comment, version: e.version },
    { score: headline(ctx, after), photos: after.siteIds.length, comment: after.comment, version: e.version + 1 },
  );
}

export { targetLabel as evaluationTargetLabel, targetOf as evaluationTarget };
