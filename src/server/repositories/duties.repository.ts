import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { duties, roundClassAreas, rounds, scoreComponents, terms, users } from '../../../db/schema.ts';
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

/** BR-P1: the user holds a committee duty in force in the term for exactly this target. */
export async function hasCommitteeDutyFor(
  db: DbOrTx,
  termId: string,
  userId: string,
  target: { classId?: string | null; areaId?: string | null },
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(duties)
    .where(
      and(
        eq(duties.termId, termId),
        eq(duties.userId, userId),
        eq(duties.duty, 'committee'),
        target.classId ? eq(duties.targetClassId, target.classId) : eq(duties.targetAreaId, target.areaId!),
        dutyInForce(now),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * BR-P1 for any component source (T41). `committee` → a committee duty on exactly this target. `area_teacher`
 * (FR-E12) → an area_teacher duty on the area itself, or, for a class, on the area the class belonged to in
 * `roundId` (frozen at round open, `round_class_areas`) — in any round of the term when `roundId` is null.
 */
export async function hasScoringDutyFor(
  db: DbOrTx,
  q: {
    termId: string;
    userId: string;
    source: 'committee' | 'area_teacher';
    target: { classId?: string | null; areaId?: string | null };
    roundId?: string | null;
  },
  now: Date,
): Promise<boolean> {
  if (q.source === 'committee') return hasCommitteeDutyFor(db, q.termId, q.userId, q.target, now);
  let areaIds: string[];
  if (q.target.areaId) areaIds = [q.target.areaId];
  else {
    const rows = await db
      .selectDistinct({ areaId: roundClassAreas.areaId })
      .from(roundClassAreas)
      .innerJoin(rounds, eq(rounds.id, roundClassAreas.roundId))
      .where(
        and(
          eq(roundClassAreas.classId, q.target.classId!),
          q.roundId ? eq(roundClassAreas.roundId, q.roundId) : eq(rounds.termId, q.termId),
        ),
      );
    areaIds = rows.map((r) => r.areaId);
  }
  if (areaIds.length === 0) return false;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(duties)
    .where(
      and(
        eq(duties.termId, q.termId),
        eq(duties.userId, q.userId),
        eq(duties.duty, 'area_teacher'),
        inArray(duties.targetAreaId, areaIds),
        dutyInForce(now),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/** Either kind of scoring duty on the target (uploads and photo access, where no component is known yet). */
export async function hasAnyScoringDutyFor(
  db: DbOrTx,
  termId: string,
  userId: string,
  target: { classId?: string | null; areaId?: string | null },
  now: Date,
): Promise<boolean> {
  return (
    (await hasCommitteeDutyFor(db, termId, userId, target, now)) ||
    (await hasScoringDutyFor(db, { termId, userId, source: 'area_teacher', target }, now))
  );
}

/** The user's area_teacher duties in force (T41 task list). */
export const listMyAreaTeacherDuties = (db: DbOrTx, termId: string, userId: string, now: Date) =>
  db
    .select()
    .from(duties)
    .where(
      and(eq(duties.termId, termId), eq(duties.userId, userId), eq(duties.duty, 'area_teacher'), dutyInForce(now)),
    );

/** {@link hasScoringDutyFor} for a component known by id (evaluation detail, requests, PDFs, T41). */
export async function hasDutyForComponent(
  db: DbOrTx,
  q: {
    termId: string;
    userId: string;
    componentId: string;
    target: { classId?: string | null; areaId?: string | null };
    roundId: string;
  },
  now: Date,
): Promise<boolean> {
  const [c] = await db
    .select({ source: scoreComponents.source })
    .from(scoreComponents)
    .where(eq(scoreComponents.id, q.componentId));
  return hasScoringDutyFor(db, { ...q, source: c?.source ?? 'committee' }, now);
}
