import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { duties, terms } from '../../../db/schema.ts';
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
