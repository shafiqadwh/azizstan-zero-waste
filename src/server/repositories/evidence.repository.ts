import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { evaluations, evidence, rounds } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type EvidenceRow = typeof evidence.$inferSelect;

export async function insertEvidence(db: DbOrTx, row: typeof evidence.$inferInsert) {
  await db.insert(evidence).values(row);
}

export async function findEvidence(db: DbOrTx, id: string) {
  const [row] = await db.select().from(evidence).where(eq(evidence.id, id));
  return row ?? null;
}

/** The evaluation an evidence row belongs to, with the term (for the committee-duty check). */
export async function findEvaluationTarget(db: DbOrTx, evaluationId: string) {
  const [row] = await db
    .select({
      termId: rounds.termId,
      targetClassId: evaluations.targetClassId,
      targetAreaId: evaluations.targetAreaId,
      ownerId: evaluations.ownerId,
    })
    .from(evaluations)
    .innerJoin(rounds, eq(rounds.id, evaluations.roundId))
    .where(eq(evaluations.id, evaluationId));
  return row ?? null;
}

/** BR-V4: uploads never attached to an evaluation. */
export const listOrphansBefore = (db: DbOrTx, cutoff: Date) =>
  db
    .select()
    .from(evidence)
    .where(and(isNull(evidence.evaluationId), lt(evidence.capturedAt, cutoff)));

export async function deleteEvidence(db: DbOrTx, ids: string[]) {
  if (ids.length > 0) await db.delete(evidence).where(inArray(evidence.id, ids));
}

export async function countBySha(db: DbOrTx, sha256: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(evidence)
    .where(eq(evidence.sha256, sha256));
  return row?.n ?? 0;
}
