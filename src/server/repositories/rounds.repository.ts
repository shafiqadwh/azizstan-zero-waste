import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { rosterSnapshots, roundClassAreas, rounds, students, terms } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type RoundClassAreaRow = typeof roundClassAreas.$inferSelect;

/** Rounds of the active term whose time has come (BR-R1 / BR-R2). Draft and closed terms never move. */
export async function listDueRounds(db: DbOrTx, status: 'scheduled' | 'open', now: Date) {
  const due = status === 'scheduled' ? rounds.opensAt : rounds.closesAt;
  return db
    .select({ id: rounds.id })
    .from(rounds)
    .innerJoin(terms, eq(terms.id, rounds.termId))
    .where(and(eq(terms.status, 'active'), eq(rounds.status, status), lte(due, now)))
    .orderBy(asc(rounds.opensAt));
}

/** Row lock so two workers (or a retry) never open or close the same round at once. */
export async function lockRound(db: DbOrTx, id: string) {
  const [row] = await db.select().from(rounds).where(eq(rounds.id, id)).for('update');
  return row ?? null;
}

export async function setRoundStatus(db: DbOrTx, id: string, status: 'open' | 'closed') {
  await db.update(rounds).set({ status }).where(eq(rounds.id, id));
}

export const listRoundClassAreas = (db: DbOrTx, roundId: string) =>
  db.select().from(roundClassAreas).where(eq(roundClassAreas.roundId, roundId));

/** Replace the frozen rows of a round (delete + insert keeps a re-run identical). */
export async function replaceRoundClassAreas(db: DbOrTx, roundId: string, rows: RoundClassAreaRow[]) {
  await db.delete(roundClassAreas).where(eq(roundClassAreas.roundId, roundId));
  if (rows.length > 0) await db.insert(roundClassAreas).values(rows);
}

export async function upsertRoundClassArea(db: DbOrTx, row: RoundClassAreaRow) {
  await db
    .insert(roundClassAreas)
    .values(row)
    .onConflictDoUpdate({
      target: [roundClassAreas.roundId, roundClassAreas.classId],
      set: { areaId: row.areaId, physicalRoomId: row.physicalRoomId },
    });
}

/** Active students whose home class takes part in the term (BR-R1 step 3). */
export async function listActiveStudentsIn(db: DbOrTx, classIds: string[]) {
  if (classIds.length === 0) return [];
  return db
    .select({ studentId: students.id, classId: students.homeClassId })
    .from(students)
    .where(and(eq(students.status, 'active'), inArray(students.homeClassId, classIds)));
}

export async function replaceRosterSnapshots(
  db: DbOrTx,
  roundId: string,
  rows: { studentId: string; classId: string }[],
) {
  await db.delete(rosterSnapshots).where(eq(rosterSnapshots.roundId, roundId));
  // chunked: a whole school is a few thousand rows
  for (let i = 0; i < rows.length; i += 1000) {
    await db.insert(rosterSnapshots).values(rows.slice(i, i + 1000).map((r) => ({ roundId, ...r })));
  }
}

export async function countRosterSnapshots(db: DbOrTx, roundId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rosterSnapshots)
    .where(eq(rosterSnapshots.roundId, roundId));
  return row?.n ?? 0;
}
