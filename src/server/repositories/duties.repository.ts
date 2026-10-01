import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { duties, terms, users } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

/** Any non-expired duty in the active term (gate for the committee area, 06-auth §4 rule 3). */
export async function hasDutyInActiveTerm(db: DbOrTx, userId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(duties)
    .innerJoin(terms, eq(terms.id, duties.termId))
    .where(
      and(
        eq(duties.userId, userId),
        eq(terms.status, 'active'),
        or(isNull(duties.validUntil), gt(duties.validUntil, now)),
      ),
    );
  return (row?.n ?? 0) > 0;
}

export type DutyRow = typeof duties.$inferSelect;

/** A duty counts until its freelance expiry passes (BR-P1). */
export const dutyInForce = (now: Date) => or(isNull(duties.validUntil), gt(duties.validUntil, now));

export const listTermDuties = (db: DbOrTx, termId: string) =>
  db.select().from(duties).where(eq(duties.termId, termId)).orderBy(asc(duties.createdAt));

export async function findDuty(db: DbOrTx, id: string) {
  const [row] = await db.select().from(duties).where(eq(duties.id, id));
  return row ?? null;
}

/** Same (term, user, duty, target) still in force — assigning it again would be a duplicate. */
export async function findSameDuty(
  db: DbOrTx,
  key: Pick<DutyRow, 'termId' | 'userId' | 'duty' | 'targetClassId' | 'targetAreaId'>,
  now: Date,
) {
  const [row] = await db
    .select()
    .from(duties)
    .where(
      and(
        eq(duties.termId, key.termId),
        eq(duties.userId, key.userId),
        eq(duties.duty, key.duty),
        key.targetClassId ? eq(duties.targetClassId, key.targetClassId) : isNull(duties.targetClassId),
        key.targetAreaId ? eq(duties.targetAreaId, key.targetAreaId) : isNull(duties.targetAreaId),
        dutyInForce(now),
      ),
    );
  return row ?? null;
}

export async function insertDuty(db: DbOrTx, row: typeof duties.$inferInsert) {
  await db.insert(duties).values(row);
}

export async function deleteDuty(db: DbOrTx, id: string) {
  await db.delete(duties).where(eq(duties.id, id));
}

export async function countUserDuties(db: DbOrTx, termId: string, userId: string, duty: DutyRow['duty'], now: Date) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(duties)
    .where(and(eq(duties.termId, termId), eq(duties.userId, userId), eq(duties.duty, duty), dutyInForce(now)));
  return row?.n ?? 0;
}

/** Active users holding a committee duty in force in the term (recipients of `round_opened`). */
export async function listCommitteeUserIds(db: DbOrTx, termId: string, now: Date): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: duties.userId })
    .from(duties)
    .innerJoin(users, eq(users.id, duties.userId))
    .where(and(eq(duties.termId, termId), eq(duties.duty, 'committee'), eq(users.isActive, true), dutyInForce(now)));
  return rows.map((r) => r.id);
}
