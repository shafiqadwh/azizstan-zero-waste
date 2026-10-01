import { and, count, eq, inArray, ne } from 'drizzle-orm';
import {
  evaluationStudentScores,
  evaluations,
  requests,
  rosterSnapshots,
  roundAreaResults,
  roundClassResults,
  roundStudentResults,
} from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type ClassResultRow = typeof roundClassResults.$inferSelect;
export type AreaResultRow = typeof roundAreaResults.$inferSelect;

/** Approved evaluations of a round (only approved data counts — 03-database §4 query 4). */
export const listApprovedEvaluations = (db: DbOrTx, roundId: string) =>
  db
    .select()
    .from(evaluations)
    .where(and(eq(evaluations.roundId, roundId), eq(evaluations.status, 'approved')));

export async function listStudentScoresOf(db: DbOrTx, evaluationIds: string[]) {
  if (evaluationIds.length === 0) return [];
  return db.select().from(evaluationStudentScores).where(inArray(evaluationStudentScores.evaluationId, evaluationIds));
}

export const listRoster = (db: DbOrTx, roundId: string) =>
  db.select().from(rosterSnapshots).where(eq(rosterSnapshots.roundId, roundId));

/** Waiting change requests (everything except late entry) block finalize (BR-R3). */
export async function countBlockingRequests(db: DbOrTx, roundId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(requests)
    .where(and(eq(requests.roundId, roundId), eq(requests.status, 'waiting'), ne(requests.type, 'late_entry')));
  return row?.n ?? 0;
}

/** BR-Q4 / job request.expire: late-entry requests still waiting when the round is finalized lapse. */
export async function expireWaitingRequests(db: DbOrTx, roundId: string, at: Date): Promise<number> {
  const rows = await db
    .update(requests)
    .set({ status: 'expired', decidedAt: at })
    .where(and(eq(requests.roundId, roundId), eq(requests.status, 'waiting')))
    .returning({ id: requests.id });
  return rows.length;
}

export const listFrozenClassResults = (db: DbOrTx, roundId: string) =>
  db
    .select()
    .from(roundClassResults)
    .where(and(eq(roundClassResults.roundId, roundId), eq(roundClassResults.frozen, true)));

export const listFrozenAreaResults = (db: DbOrTx, roundId: string) =>
  db
    .select()
    .from(roundAreaResults)
    .where(and(eq(roundAreaResults.roundId, roundId), eq(roundAreaResults.frozen, true)));

/** Replace a round's stored results (delete + insert keeps refreezes identical). */
export async function replaceResults(
  db: DbOrTx,
  roundId: string,
  rows: {
    classes: (typeof roundClassResults.$inferInsert)[];
    areas: (typeof roundAreaResults.$inferInsert)[];
    students: (typeof roundStudentResults.$inferInsert)[];
  },
) {
  await db.delete(roundClassResults).where(eq(roundClassResults.roundId, roundId));
  await db.delete(roundAreaResults).where(eq(roundAreaResults.roundId, roundId));
  await db.delete(roundStudentResults).where(eq(roundStudentResults.roundId, roundId));
  if (rows.classes.length) await db.insert(roundClassResults).values(rows.classes);
  if (rows.areas.length) await db.insert(roundAreaResults).values(rows.areas);
  for (let i = 0; i < rows.students.length; i += 1000) {
    await db.insert(roundStudentResults).values(rows.students.slice(i, i + 1000));
  }
}

/** Approved evaluations of a round get their final PDF (no watermark) at finalize — T22 renders queued rows. */
export async function queueRoundPdfs(db: DbOrTx, roundId: string) {
  await db
    .update(evaluations)
    .set({ pdfStatus: 'queued', pdfError: null })
    .where(and(eq(evaluations.roundId, roundId), eq(evaluations.status, 'approved')));
}
