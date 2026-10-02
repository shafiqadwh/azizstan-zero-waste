import { and, asc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import {
  auditLogs,
  duties,
  evaluationStudentScores,
  evaluations,
  evidence,
  pdfDocuments,
  requests,
  rosterSnapshots,
  roundClassAreas,
  rounds,
  physicalRooms,
  students,
  users,
} from '../../../db/schema.ts';
import { mean, parseScore, type Th } from '../../lib/scoring/decimal.ts';
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

/** Individual mode (T40): the class's snapshot students for the round, by code. Codes only — never names (FR-S1). */
export const listRosterCodes = (db: DbOrTx, roundId: string, classId: string) =>
  db
    .select({ id: students.id, code: students.studentCode })
    .from(rosterSnapshots)
    .innerJoin(students, eq(students.id, rosterSnapshots.studentId))
    .where(and(eq(rosterSnapshots.roundId, roundId), eq(rosterSnapshots.classId, classId)))
    .orderBy(students.studentCode);

/** Per-student scores of an evaluation with their codes, by code (T40). */
export const listStudentScoresWithCodes = (db: DbOrTx, evaluationId: string) =>
  db
    .select({ studentId: students.id, code: students.studentCode, score: evaluationStudentScores.score })
    .from(evaluationStudentScores)
    .innerJoin(students, eq(students.id, evaluationStudentScores.studentId))
    .where(eq(evaluationStudentScores.evaluationId, evaluationId))
    .orderBy(students.studentCode);

/** Individual mode: the class mean of each evaluation's student scores (BR-S2); evaluations without any are absent. */
export async function studentMeans(db: DbOrTx, evaluationIds: string[]): Promise<Map<string, Th>> {
  if (evaluationIds.length === 0) return new Map();
  const rows = await db
    .select({ evaluationId: evaluationStudentScores.evaluationId, score: evaluationStudentScores.score })
    .from(evaluationStudentScores)
    .where(inArray(evaluationStudentScores.evaluationId, evaluationIds));
  const by = new Map<string, Th[]>();
  for (const r of rows) by.set(r.evaluationId, [...(by.get(r.evaluationId) ?? []), parseScore(r.score)]);
  return new Map([...by].map(([id, list]) => [id, mean(list)!]));
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

/** BR-E9 / T-Q3: a changed approved evaluation gets a new PDF version; earlier ones are marked superseded. */
export async function supersedePdfs(db: DbOrTx, evaluationId: string, at: Date) {
  await db
    .update(pdfDocuments)
    .set({ supersededAt: at })
    .where(and(eq(pdfDocuments.evaluationId, evaluationId), isNull(pdfDocuments.supersededAt)));
}

/** Evaluations waiting for approval in a term, oldest submission first, with the owner's name (§6.11). */
export const listSubmittedEvaluations = (db: DbOrTx, termId: string) =>
  db
    .select({ evaluation: evaluations, ownerName: users.displayName, roundNo: rounds.roundNo })
    .from(evaluations)
    .innerJoin(users, eq(users.id, evaluations.ownerId))
    .innerJoin(rounds, eq(rounds.id, evaluations.roundId))
    .where(and(eq(rounds.termId, termId), eq(evaluations.status, 'submitted')))
    .orderBy(asc(evaluations.lastEditedAt), asc(evaluations.id));
