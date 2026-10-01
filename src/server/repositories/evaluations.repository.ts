import { and, asc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import {
  auditLogs,
  duties,
  evaluationStudentScores,
  evaluations,
  evidence,
  requests,
  rosterSnapshots,
  roundClassAreas,
  physicalRooms,
  users,
} from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type EvaluationRow = typeof evaluations.$inferSelect;
export type EvidenceRow = typeof evidence.$inferSelect;

export interface TargetKey {
  type: 'class' | 'area';
  id: string;
}

const targetWhere = (t: TargetKey) =>
  t.type === 'class' ? eq(evaluations.targetClassId, t.id) : eq(evaluations.targetAreaId, t.id);

export async function findEvaluation(db: DbOrTx, id: string) {
  const [row] = await db.select().from(evaluations).where(eq(evaluations.id, id));
  return row ?? null;
}

export async function lockEvaluation(db: DbOrTx, id: string) {
  const [row] = await db.select().from(evaluations).where(eq(evaluations.id, id)).for('update');
  return row ?? null;
}

/** The live (not void) evaluation of (round, component, target) with its owner's name (BR-P3, I1). */
export async function findLiveEvaluation(db: DbOrTx, roundId: string, componentId: string, target: TargetKey) {
  const [row] = await db
    .select({ evaluation: evaluations, ownerName: users.displayName })
    .from(evaluations)
    .innerJoin(users, eq(users.id, evaluations.ownerId))
    .where(
      and(
        eq(evaluations.roundId, roundId),
        eq(evaluations.componentId, componentId),
        targetWhere(target),
        ne(evaluations.status, 'void'),
      ),
    );
  return row ?? null;
}

export async function insertEvaluation(db: DbOrTx, row: typeof evaluations.$inferInsert) {
  await db.insert(evaluations).values(row);
}

export async function updateEvaluation(db: DbOrTx, id: string, patch: Partial<typeof evaluations.$inferInsert>) {
  await db.update(evaluations).set(patch).where(eq(evaluations.id, id));
}

// ── evidence ──
export async function listEvidenceByIds(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(evidence).where(inArray(evidence.id, ids));
}

/** Photos currently part of an evaluation (not removed), in display order. */
export const listEvaluationEvidence = (db: DbOrTx, evaluationId: string) =>
  db
    .select()
    .from(evidence)
    .where(and(eq(evidence.evaluationId, evaluationId), isNull(evidence.removedAt)))
    .orderBy(asc(evidence.kind), asc(evidence.sortOrder));

export async function attachEvidence(db: DbOrTx, evaluationId: string, ids: string[]) {
  for (const [i, id] of ids.entries()) {
    await db.update(evidence).set({ evaluationId, sortOrder: i, removedAt: null }).where(eq(evidence.id, id));
  }
}

/** Soft delete: the file stays as evidence until the term's retention ends (FR-S2). */
export async function markEvidenceRemoved(db: DbOrTx, ids: string[], at: Date) {
  if (ids.length > 0) await db.update(evidence).set({ removedAt: at }).where(inArray(evidence.id, ids));
}

// ── individual mode ──
export const listStudentScores = (db: DbOrTx, evaluationId: string) =>
  db.select().from(evaluationStudentScores).where(eq(evaluationStudentScores.evaluationId, evaluationId));

export async function replaceStudentScores(
  db: DbOrTx,
  evaluationId: string,
  rows: { studentId: string; score: string }[],
) {
  await db.delete(evaluationStudentScores).where(eq(evaluationStudentScores.evaluationId, evaluationId));
  if (rows.length > 0) await db.insert(evaluationStudentScores).values(rows.map((r) => ({ evaluationId, ...r })));
}

export async function listRosterStudentIds(db: DbOrTx, roundId: string, classId: string): Promise<string[]> {
  const rows = await db
    .select({ id: rosterSnapshots.studentId })
    .from(rosterSnapshots)
    .where(and(eq(rosterSnapshots.roundId, roundId), eq(rosterSnapshots.classId, classId)));
  return rows.map((r) => r.id);
}

/** Room number frozen for the class when the round opened (printed on the PDF). */
export async function frozenRoomNumber(db: DbOrTx, roundId: string, classId: string): Promise<string | null> {
  const [row] = await db
    .select({ roomNumber: physicalRooms.roomNumber })
    .from(roundClassAreas)
    .innerJoin(physicalRooms, eq(physicalRooms.id, roundClassAreas.physicalRoomId))
    .where(and(eq(roundClassAreas.roundId, roundId), eq(roundClassAreas.classId, classId)));
  return row?.roomNumber ?? null;
}

// ── BR-P2 late entry ──
export async function hasLateEntryGrant(
  db: DbOrTx,
  q: { userId: string; roundId: string; componentId: string; target: TargetKey },
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: requests.id })
    .from(requests)
    .where(
      and(
        eq(requests.type, 'late_entry'),
        eq(requests.status, 'approved'),
        eq(requests.requesterId, q.userId),
        eq(requests.roundId, q.roundId),
        eq(requests.componentId, q.componentId),
        q.target.type === 'class' ? eq(requests.targetClassId, q.target.id) : eq(requests.targetAreaId, q.target.id),
        gt(requests.grantUntil, now),
      ),
    );
  return !!row;
}

// ── BR-E6 approvers ──
/** Admins holding an approver duty in force for this target, or for every target (target_type null). */
export async function listApproverIds(db: DbOrTx, termId: string, target: TargetKey, now: Date): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: duties.userId })
    .from(duties)
    .where(
      and(
        eq(duties.termId, termId),
        eq(duties.duty, 'approver'),
        or(isNull(duties.validUntil), gt(duties.validUntil, now)),
        or(
          isNull(duties.targetType),
          target.type === 'class' ? eq(duties.targetClassId, target.id) : eq(duties.targetAreaId, target.id),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

/** Every active admin and super admin (recipients of `evaluation_submitted` / `evaluation_changed`). */
export async function listAdminIds(db: DbOrTx): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, ['admin', 'super_admin'])));
  return rows.map((r) => r.id);
}

/** Every live evaluation of a round with its owner's name (task list, monitor). */
export const listLiveEvaluations = (db: DbOrTx, roundId: string) =>
  db
    .select({ evaluation: evaluations, ownerName: users.displayName })
    .from(evaluations)
    .innerJoin(users, eq(users.id, evaluations.ownerId))
    .where(and(eq(evaluations.roundId, roundId), ne(evaluations.status, 'void')));

/** The user's committee duties in force in a term (their targets). */
export const listMyCommitteeDuties = (db: DbOrTx, termId: string, userId: string, now: Date) =>
  db
    .select()
    .from(duties)
    .where(
      and(
        eq(duties.termId, termId),
        eq(duties.userId, userId),
        eq(duties.duty, 'committee'),
        or(isNull(duties.validUntil), gt(duties.validUntil, now)),
      ),
    );

/** Status timeline of one evaluation from the audit log (FR-E10), oldest first, with actor names. */
export const listEvaluationHistory = (db: DbOrTx, evaluationId: string) =>
  db
    .select({ action: auditLogs.action, at: auditLogs.at, actorName: users.displayName })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entity, 'evaluation'), eq(auditLogs.entityId, evaluationId)))
    .orderBy(asc(auditLogs.at));
