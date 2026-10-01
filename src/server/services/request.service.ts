/**
 * Requests (ขออนุมัติ, 04-business-rules §6, BR-Q1..Q5): late entry, edit score / photos / comment, move to the
 * right target, delete. Committee members create them; admins approve (the payload is applied and re-validated
 * in the same transaction — BR-Q3) or reject. Every call writes exactly one audit row.
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { formatThaiDateTime } from '../../lib/dates/index.ts';
import { checkScore } from '../../lib/scoring/index.ts';
import { parseScore, toDisplay } from '../../lib/scoring/decimal.ts';
import { scoreStepFor, trimScore } from '../../lib/term/config.ts';
import { newId } from '../../lib/ids.ts';
import { AppError, notFound, parseInput } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as evalRepo from '../repositories/evaluations.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as repo from '../repositories/requests.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import { withTransaction, type Tx } from '../transaction.ts';
import { writeAudit } from './audit.service.ts';
import type { ClientMeta } from './auth.service.ts';
import {
  applyRequestedChange,
  evaluationTarget,
  evaluationTargetLabel,
  type RequestedChange,
} from './evaluation.service.ts';
import { send } from './notify.service.ts';
import { refreezeRound } from './result.service.ts';

export const REQUEST_TYPES = [
  'late_entry',
  'edit_score',
  'edit_photos',
  'edit_comment',
  'move_target',
  'delete',
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** 08-ux-ui §6.9 labels */
export const REQUEST_LABEL: Record<RequestType, string> = {
  late_entry: 'ขอใส่คะแนนหลังกำหนด',
  edit_score: 'แก้คะแนน',
  edit_photos: 'แก้รูป',
  edit_comment: 'แก้ข้อติชม',
  move_target: 'ย้ายไปห้องที่ถูกต้อง',
  delete: 'ลบผลประเมิน',
};

/** late_entry grant choices (08-ux-ui §6.11) */
export const GRANT_HOURS = [12, 24, 48, 72] as const;

export const REQUEST_MSG = {
  reasonRequired: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร',
  finalizedSuperAdminOnly: 'รอบนี้ปิดรอบแล้ว แก้ไขได้เฉพาะผู้ดูแลระบบสูงสุด',
  entryStillOpen: 'ยังอยู่ในช่วงลงคะแนน ใส่คะแนนได้เลย',
  notOpenedYet: 'รอบนี้ยังไม่เปิด',
  alreadyGranted: 'ได้รับอนุมัติให้ใส่คะแนนแล้ว ใส่คะแนนได้เลย',
  waitingExists: 'มีคำขอประเภทนี้รออนุมัติอยู่แล้ว',
  ownWindow: 'ยังแก้ไขเองได้ ไม่ต้องขออนุมัติ',
  ownerOnly: 'เฉพาะผู้ประเมินเจ้าของผลนี้เท่านั้นที่ขอย้ายห้องได้',
  notWaiting: 'คำขอนี้ไม่ได้รออนุมัติแล้ว',
  noChange: 'ไม่มีการเปลี่ยนแปลง',
  badHours: 'เลือกระยะเวลา 12, 24, 48 หรือ 72 ชั่วโมง',
} as const;

const target = z.object({ type: z.enum(['class', 'area']), id: z.uuid() });
const scoreValue = z.union([z.string(), z.number()]).nullable().optional();

const payloads = {
  late_entry: z.object({ hours: z.number().int().optional() }).default({}),
  edit_score: z.object({
    score: scoreValue,
    studentScores: z
      .array(z.object({ studentId: z.uuid(), score: scoreValue }))
      .max(200)
      .optional(),
  }),
  edit_photos: z.object({ add: z.array(z.uuid()).max(10).default([]), remove: z.array(z.uuid()).max(10).default([]) }),
  edit_comment: z.object({ comment: z.string().max(5000) }),
  move_target: z.object({ target }),
  delete: z.object({}).default({}),
} as const;

export const createRequestInput = z.object({
  type: z.enum(REQUEST_TYPES),
  reason: z.string().trim(),
  /** late_entry only */
  roundId: z.uuid().optional(),
  componentId: z.uuid().optional(),
  target: target.optional(),
  /** every other type */
  evaluationId: z.uuid().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const decideInput = z.object({
  id: z.uuid(),
  note: z.string().trim().max(500).optional(),
  grantHours: z.number().int().optional(),
});

const reasonOk = (reason: string) => [...reason].length >= 5;

async function adminsAndNotice(tx: Tx, type: RequestType, label: string, now: Date) {
  await send(
    tx,
    {
      userIds: await evalRepo.listAdminIds(tx),
      type: 'request_created',
      title: 'มีคำขออนุมัติใหม่',
      body: `${REQUEST_LABEL[type]} · ${label}`,
      link: '/admin/approvals?tab=requests',
    },
    now,
  );
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

// ───────────── create (committee) ─────────────

export async function createRequest(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof createRequestInput>,
  meta: ClientMeta,
  now: Date,
): Promise<{ id: string }> {
  const input = parseInput(createRequestInput, raw);
  if (!reasonOk(input.reason))
    throw new AppError('VALIDATION', { field: 'reason', message: REQUEST_MSG.reasonRequired });
  const payload = parseInput(payloads[input.type] as z.ZodType<Record<string, unknown>>, input.payload);
  try {
    return await withTransaction(db, async (tx) => {
      const id = newId();
      let row: Parameters<typeof repo.insertRequest>[1];
      let label: string;

      if (input.type === 'late_entry') {
        if (!input.roundId || !input.componentId || !input.target)
          throw new AppError('VALIDATION', { field: 'target', message: 'ข้อมูลคำขอไม่ครบ' });
        const t = input.target;
        const round = await termsRepo.findRound(tx, input.roundId);
        if (!round) throw notFound();
        const hasDuty = await dutiesRepo.hasCommitteeDutyFor(
          tx,
          round.termId,
          actor.id,
          t.type === 'class' ? { classId: t.id } : { areaId: t.id },
          now,
        );
        assertCan(actor, 'request.create', { hasDuty });
        if (round.status === 'finalized' && actor.role !== 'super_admin')
          throw new AppError('FORBIDDEN', { message: REQUEST_MSG.finalizedSuperAdminOnly });
        if (round.status === 'scheduled' || now < round.opensAt)
          throw new AppError('VALIDATION', { message: REQUEST_MSG.notOpenedYet });
        if (round.status === 'open' && now < round.closesAt)
          throw new AppError('VALIDATION', { message: REQUEST_MSG.entryStillOpen });
        const live = await evalRepo.findLiveEvaluation(tx, round.id, input.componentId, t);
        if (live)
          throw new AppError('ALREADY_EVALUATED', {
            params: { name: live.ownerName, time: formatThaiDateTime(live.evaluation.firstSubmittedAt) },
          });
        const key = {
          requesterId: actor.id,
          roundId: round.id,
          componentId: input.componentId,
          targetClassId: t.type === 'class' ? t.id : null,
          targetAreaId: t.type === 'area' ? t.id : null,
        };
        if (
          await evalRepo.hasLateEntryGrant(
            tx,
            { userId: actor.id, roundId: round.id, componentId: input.componentId, target: t },
            now,
          )
        )
          throw new AppError('VALIDATION', { message: REQUEST_MSG.alreadyGranted });
        if (await repo.findWaitingLateEntry(tx, key))
          throw new AppError('VALIDATION', { message: REQUEST_MSG.waitingExists });
        label = await evaluationTargetLabel(tx, t);
        row = {
          id,
          type: 'late_entry',
          ...key,
          targetType: t.type,
          reason: input.reason,
          payload,
          createdAt: now,
        };
      } else {
        if (!input.evaluationId) throw new AppError('VALIDATION', { message: 'ข้อมูลคำขอไม่ครบ' });
        const e = await evalRepo.findEvaluation(tx, input.evaluationId);
        if (!e || e.status === 'void') throw notFound();
        const round = (await termsRepo.findRound(tx, e.roundId))!;
        const t = evaluationTarget(e);
        const isOwner = e.ownerId === actor.id;
        const hasDuty =
          isOwner ||
          (await dutiesRepo.hasCommitteeDutyFor(
            tx,
            round.termId,
            actor.id,
            t.type === 'class' ? { classId: t.id } : { areaId: t.id },
            now,
          ));
        assertCan(actor, 'request.create', { hasDuty });
        if (input.type === 'move_target' && !isOwner)
          throw new AppError('FORBIDDEN', { message: REQUEST_MSG.ownerOnly });
        // BR-Q5: after finalize only the super admin may ask (and decide)
        if (round.status === 'finalized' && actor.role !== 'super_admin')
          throw new AppError('FORBIDDEN', { message: REQUEST_MSG.finalizedSuperAdminOnly });
        // BR-E4: inside the window the owner just edits
        if (isOwner && e.status !== 'approved' && now < e.selfEditUntil)
          throw new AppError('VALIDATION', { message: REQUEST_MSG.ownWindow });
        if (input.type === 'edit_score' && !('studentScores' in payload && payload.studentScores)) {
          // reject obviously wrong scores early; the approval re-validates everything (BR-Q3)
          const term = (await places.findTerm(tx, round.termId))!;
          const comp = (await termsRepo.listComponents(tx, term.id)).find((c) => c.id === e.componentId)!;
          const override = (await termsRepo.listRoundMax(tx, [round.id])).find((m) => m.componentId === comp.id);
          const max = parseScore(override?.maxValue ?? comp.maxValue);
          const step = scoreStepFor(term);
          let value: number | null = null;
          try {
            value = payload.score === null || payload.score === undefined ? null : parseScore(payload.score as string);
          } catch {
            value = -1;
          }
          const check = checkScore(value, max, step);
          if (!check.ok)
            throw new AppError('VALIDATION', {
              field: 'score',
              message:
                check.code === 'required'
                  ? 'กรุณาเลือกคะแนน (ถ้าไม่ให้คะแนน ให้เลือก 0)'
                  : check.code === 'step'
                    ? `คะแนนต้องเป็นทีละ ${trimScore(toDisplay(step))}`
                    : `คะแนนต้องอยู่ระหว่าง 0 ถึง ${trimScore(toDisplay(max))}`,
            });
        }
        label = await evaluationTargetLabel(tx, t);
        row = {
          id,
          type: input.type,
          requesterId: actor.id,
          roundId: e.roundId,
          componentId: e.componentId,
          evaluationId: e.id,
          targetType: t.type,
          targetClassId: t.type === 'class' ? t.id : null,
          targetAreaId: t.type === 'area' ? t.id : null,
          reason: input.reason,
          payload,
          createdAt: now,
        };
      }

      await repo.insertRequest(tx, row);
      await writeAudit(
        tx,
        {
          actorId: actor.id,
          action: 'request.create',
          entity: 'request',
          entityId: id,
          after: { type: input.type, evaluationId: row.evaluationId ?? null, reason: input.reason, payload },
          ip: meta.ip,
        },
        now,
      );
      await adminsAndNotice(tx, input.type, label, now);
      return { id };
    });
  } catch (err) {
    // one waiting request per (evaluation, type) — partial unique index
    if (isUniqueViolation(err)) throw new AppError('VALIDATION', { message: REQUEST_MSG.waitingExists });
    throw err;
  }
}

export async function cancelRequest(db: Db, actor: SessionUser, raw: { id: string }, meta: ClientMeta, now: Date) {
  const { id } = parseInput(z.object({ id: z.uuid() }), raw);
  await withTransaction(db, async (tx) => {
    const r = await repo.lockRequest(tx, id);
    if (!r) throw notFound();
    if (r.requesterId !== actor.id) throw new AppError('FORBIDDEN');
    if (r.status !== 'waiting') throw new AppError('VALIDATION', { message: REQUEST_MSG.notWaiting });
    await repo.updateRequest(tx, id, { status: 'cancelled', decidedAt: now });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'request.cancel',
        entity: 'request',
        entityId: id,
        before: { status: 'waiting' },
        after: { status: 'cancelled' },
        ip: meta.ip,
      },
      now,
    );
  });
}

// ───────────── decide (admin) ─────────────

async function lockForDecision(tx: Tx, actor: SessionUser, id: string) {
  assertCan(actor, 'request.decide');
  const r = await repo.lockRequest(tx, id);
  if (!r) throw notFound();
  if (r.status !== 'waiting') throw new AppError('VALIDATION', { message: REQUEST_MSG.notWaiting });
  const round = (await termsRepo.findRound(tx, r.roundId))!;
  if (round.status === 'finalized' && actor.role !== 'super_admin')
    throw new AppError('FORBIDDEN', { message: REQUEST_MSG.finalizedSuperAdminOnly });
  return { r, round };
}

const requestTarget = (r: repo.RequestRow) =>
  r.targetClassId ? { type: 'class' as const, id: r.targetClassId } : { type: 'area' as const, id: r.targetAreaId! };

/**
 * BR-Q2/Q3: approve and apply in one transaction. When the applied result is invalid (off the step grid, a
 * target that is already scored, too few photos …) the error is returned and the request stays waiting.
 * BR-Q5 on a finalized round (super admin only): the change is applied and the round's results are
 * recomputed and frozen again in the same transaction.
 */
export async function approveRequest(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof decideInput>,
  meta: ClientMeta,
  now: Date,
): Promise<{ grantUntil: Date | null }> {
  const input = parseInput(decideInput, raw);
  return withTransaction(db, async (tx) => {
    const { r, round } = await lockForDecision(tx, actor, input.id);
    let grantUntil: Date | null = null;
    let applied: { what: string; before: unknown; after: unknown };
    const t = requestTarget(r);
    const label = await evaluationTargetLabel(tx, t);

    if (r.type === 'late_entry') {
      const term = (await places.findTerm(tx, round.termId))!;
      const hours = input.grantHours ?? term.lateEntryDefaultHours;
      if (!GRANT_HOURS.includes(hours as (typeof GRANT_HOURS)[number]) && hours !== term.lateEntryDefaultHours)
        throw new AppError('VALIDATION', { field: 'grantHours', message: REQUEST_MSG.badHours });
      grantUntil = new Date(now.getTime() + hours * 3600_000);
      applied = { what: `ใส่คะแนนได้ ${hours} ชั่วโมง`, before: null, after: { grantUntil } };
    } else {
      const e = await evalRepo.lockEvaluation(tx, r.evaluationId!);
      if (!e) throw notFound();
      const p = r.payload as Record<string, unknown>;
      const change: RequestedChange =
        r.type === 'edit_score'
          ? { type: 'edit_score', score: p.score as string, studentScores: p.studentScores as never }
          : r.type === 'edit_photos'
            ? { type: 'edit_photos', add: (p.add as string[]) ?? [], remove: (p.remove as string[]) ?? [] }
            : r.type === 'edit_comment'
              ? { type: 'edit_comment', comment: String(p.comment ?? '') }
              : r.type === 'move_target'
                ? { type: 'move_target', target: p.target as { type: 'class' | 'area'; id: string } }
                : { type: 'delete' };
      applied = await applyRequestedChange(tx, e, change, r.requesterId, now);
      await send(
        tx,
        {
          userIds: await evalRepo.listAdminIds(tx),
          type: 'evaluation_changed',
          title: 'มีการแก้ไขผลประเมิน',
          body: `${REQUEST_LABEL[r.type]} (อนุมัติคำขอ) ${label}: ${applied.what}`,
          link: '/monitor',
        },
        now,
      );
    }

    // BR-Q5: a finalized round is recomputed and frozen again with the change
    if (round.status === 'finalized' && r.type !== 'late_entry') await refreezeRound(tx, round.id, now);

    await repo.updateRequest(tx, r.id, {
      status: 'approved',
      decidedBy: actor.id,
      decidedAt: now,
      decisionNote: input.note || null,
      grantUntil,
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'request.approve',
        entity: 'request',
        entityId: r.id,
        before: applied.before,
        after: { type: r.type, evaluationId: r.evaluationId, applied: applied.after, note: input.note ?? null },
        ip: meta.ip,
      },
      now,
    );
    await send(
      tx,
      {
        userIds: [r.requesterId],
        type: 'request_decided',
        title: 'คำขออนุมัติแล้ว',
        body: [label, applied.what, input.note].filter(Boolean).join(' · '),
        link: r.evaluationId && r.type !== 'delete' ? `/evaluate/${r.evaluationId}` : '/tasks',
      },
      now,
    );
    return { grantUntil };
  });
}

export async function rejectRequest(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof decideInput>,
  meta: ClientMeta,
  now: Date,
): Promise<void> {
  const input = parseInput(decideInput, raw);
  await withTransaction(db, async (tx) => {
    const { r } = await lockForDecision(tx, actor, input.id);
    await repo.updateRequest(tx, r.id, {
      status: 'rejected',
      decidedBy: actor.id,
      decidedAt: now,
      decisionNote: input.note || null,
    });
    await writeAudit(
      tx,
      {
        actorId: actor.id,
        action: 'request.reject',
        entity: 'request',
        entityId: r.id,
        before: { status: 'waiting' },
        after: { status: 'rejected', note: input.note ?? null },
        ip: meta.ip,
      },
      now,
    );
    await send(
      tx,
      {
        userIds: [r.requesterId],
        type: 'request_decided',
        title: 'คำขอถูกปฏิเสธ',
        body: [await evaluationTargetLabel(tx, requestTarget(r)), input.note].filter(Boolean).join(' · '),
        link: '/tasks',
      },
      now,
    );
  });
}

// ───────────── read models ─────────────

export interface RequestCard {
  id: string;
  type: RequestType;
  typeLabel: string;
  status: repo.RequestRow['status'];
  requesterName: string;
  target: { roomNumber: string | null; label: string };
  roundId: string;
  evaluationId: string | null;
  reason: string;
  createdAt: Date;
  /** Old → new, already formatted for the card (BR-Q2). */
  oldValue: string | null;
  newValue: string;
  /** edit_photos: thumbnails added / removed */
  addedPhotos: string[];
  removedPhotos: string[];
  decisionNote: string | null;
  grantUntil: Date | null;
}

const fmt = (s: string | null | undefined) => (s == null ? '–' : trimScore(toDisplay(parseScore(s))));
const thumb = (id: string) => `/api/v1/files/${id}?w=320`;

async function toCard(db: Db | Tx, r: repo.RequestRow, requesterName: string): Promise<RequestCard> {
  const t = requestTarget(r);
  const label = await evaluationTargetLabel(db, t);
  const e = r.evaluationId ? await evalRepo.findEvaluation(db, r.evaluationId) : null;
  const p = r.payload as Record<string, unknown>;
  let oldValue: string | null = null;
  let newValue = '';
  if (r.type === 'late_entry') newValue = p.hours ? `ขอเวลา ${p.hours} ชั่วโมง` : 'ขอใส่คะแนน';
  else if (r.type === 'edit_score') {
    oldValue = fmt(e?.score);
    newValue = fmt(p.score as string);
  } else if (r.type === 'edit_comment') {
    oldValue = e?.comment ?? '–';
    newValue = String(p.comment ?? '') || '–';
  } else if (r.type === 'move_target') {
    oldValue = label;
    newValue = await evaluationTargetLabel(db, p.target as { type: 'class' | 'area'; id: string });
  } else if (r.type === 'delete') newValue = 'ลบผลประเมินนี้';
  else newValue = `เพิ่ม ${((p.add as string[]) ?? []).length} รูป · ลบ ${((p.remove as string[]) ?? []).length} รูป`;
  return {
    id: r.id,
    type: r.type,
    typeLabel: REQUEST_LABEL[r.type],
    status: r.status,
    requesterName,
    target: { roomNumber: e?.roomNumberAtEval ?? null, label },
    roundId: r.roundId,
    evaluationId: r.evaluationId,
    reason: r.reason,
    createdAt: r.createdAt,
    oldValue,
    newValue,
    addedPhotos: r.type === 'edit_photos' ? ((p.add as string[]) ?? []).map(thumb) : [],
    removedPhotos: r.type === 'edit_photos' ? ((p.remove as string[]) ?? []).map(thumb) : [],
    decisionNote: r.decisionNote,
    grantUntil: r.grantUntil,
  };
}

/** /admin/approvals?tab=requests — waiting requests, oldest first (staff; executives read-only). */
export async function listWaitingRequests(db: Db, actor: SessionUser): Promise<RequestCard[]> {
  assertCan(actor, 'staff.read');
  const rows = await repo.listRequests(db, { statuses: ['waiting'] });
  return Promise.all(rows.map((r) => toCard(db, r.request, r.requesterName)));
}

/** Requests on one evaluation, newest first (evaluation detail). The caller has already checked access. */
export async function listEvaluationRequests(db: Db, evaluationId: string): Promise<RequestCard[]> {
  const rows = await repo.listRequests(db, { evaluationId });
  return Promise.all(rows.map((r) => toCard(db, r.request, r.requesterName)));
}
