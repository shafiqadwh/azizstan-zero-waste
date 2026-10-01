import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { duties, roundComponentMax, rounds, scoreComponents, termClassZones, terms } from '../../../db/schema.ts';
import type { DbOrTx, Tx } from '../transaction.ts';

export type TermRow = typeof terms.$inferSelect;
export type RoundRow = typeof rounds.$inferSelect;
export type ComponentRow = typeof scoreComponents.$inferSelect;
export type RoundMaxRow = typeof roundComponentMax.$inferSelect;

export const listTerms = (db: DbOrTx) => db.select().from(terms).orderBy(desc(terms.academicYear), desc(terms.termNo));

export async function findTerm(db: DbOrTx, id: string) {
  const [row] = await db.select().from(terms).where(eq(terms.id, id));
  return row ?? null;
}

export async function findTermByYearNo(db: DbOrTx, academicYear: number, termNo: number) {
  const [row] = await db
    .select()
    .from(terms)
    .where(and(eq(terms.academicYear, academicYear), eq(terms.termNo, termNo)));
  return row ?? null;
}

export async function findActiveTerms(db: DbOrTx) {
  return db.select().from(terms).where(eq(terms.status, 'active'));
}

/** BR-TM4: transaction-scoped serialization for the single active term transition. */
export async function lockActivation(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('azizstan.term.activate'))`);
}

export async function insertTerm(db: DbOrTx, row: typeof terms.$inferInsert) {
  await db.insert(terms).values(row);
}

export async function updateTerm(db: DbOrTx, id: string, patch: Partial<typeof terms.$inferInsert>) {
  await db.update(terms).set(patch).where(eq(terms.id, id));
}

// ── rounds ──
export const listRounds = (db: DbOrTx, termId: string) =>
  db.select().from(rounds).where(eq(rounds.termId, termId)).orderBy(asc(rounds.roundNo));

export async function findRound(db: DbOrTx, id: string) {
  const [row] = await db.select().from(rounds).where(eq(rounds.id, id));
  return row ?? null;
}

export async function insertRounds(db: DbOrTx, rows: (typeof rounds.$inferInsert)[]) {
  if (rows.length > 0) await db.insert(rounds).values(rows);
}

export async function updateRound(db: DbOrTx, id: string, patch: Partial<typeof rounds.$inferInsert>) {
  await db.update(rounds).set(patch).where(eq(rounds.id, id));
}

export async function deleteRounds(db: DbOrTx, ids: string[]) {
  if (ids.length > 0) await db.delete(rounds).where(inArray(rounds.id, ids));
}

// ── components and per-round maxima ──
export const listComponents = (db: DbOrTx, termId: string) =>
  db.select().from(scoreComponents).where(eq(scoreComponents.termId, termId)).orderBy(asc(scoreComponents.sortOrder));

export async function insertComponents(db: DbOrTx, rows: (typeof scoreComponents.$inferInsert)[]) {
  if (rows.length > 0) await db.insert(scoreComponents).values(rows);
}

export async function updateComponent(db: DbOrTx, id: string, patch: Partial<typeof scoreComponents.$inferInsert>) {
  await db.update(scoreComponents).set(patch).where(eq(scoreComponents.id, id));
}

export async function deleteComponents(db: DbOrTx, ids: string[]) {
  if (ids.length > 0) await db.delete(scoreComponents).where(inArray(scoreComponents.id, ids));
}

export async function listRoundMax(db: DbOrTx, roundIds: string[]) {
  if (roundIds.length === 0) return [];
  return db.select().from(roundComponentMax).where(inArray(roundComponentMax.roundId, roundIds));
}

export async function replaceRoundMax(db: DbOrTx, roundIds: string[], rows: (typeof roundComponentMax.$inferInsert)[]) {
  if (roundIds.length > 0) await db.delete(roundComponentMax).where(inArray(roundComponentMax.roundId, roundIds));
  if (rows.length > 0) await db.insert(roundComponentMax).values(rows);
}

// ── things copied into a new term (BR-TM1 / BR-TM6) ──
export const listTermClassZones = (db: DbOrTx, termId: string) =>
  db.select().from(termClassZones).where(eq(termClassZones.termId, termId));

export async function insertTermClassZones(db: DbOrTx, rows: (typeof termClassZones.$inferInsert)[]) {
  if (rows.length > 0) await db.insert(termClassZones).values(rows);
}

export const listDuties = (db: DbOrTx, termId: string) => db.select().from(duties).where(eq(duties.termId, termId));

export async function insertDuties(db: DbOrTx, rows: (typeof duties.$inferInsert)[]) {
  if (rows.length > 0) await db.insert(duties).values(rows);
}
