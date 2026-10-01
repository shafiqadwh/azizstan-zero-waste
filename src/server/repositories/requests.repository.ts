import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { requests, users } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type RequestRow = typeof requests.$inferSelect;

export async function insertRequest(db: DbOrTx, row: typeof requests.$inferInsert) {
  await db.insert(requests).values(row);
}

export async function lockRequest(db: DbOrTx, id: string) {
  const [row] = await db.select().from(requests).where(eq(requests.id, id)).for('update');
  return row ?? null;
}

export async function updateRequest(db: DbOrTx, id: string, patch: Partial<typeof requests.$inferInsert>) {
  await db.update(requests).set(patch).where(eq(requests.id, id));
}

/** A waiting late-entry request of this user for (round, component, target) — one at a time. */
export async function findWaitingLateEntry(
  db: DbOrTx,
  q: {
    requesterId: string;
    roundId: string;
    componentId: string;
    targetClassId: string | null;
    targetAreaId: string | null;
  },
) {
  const rows = await db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.type, 'late_entry'),
        eq(requests.status, 'waiting'),
        eq(requests.requesterId, q.requesterId),
        eq(requests.roundId, q.roundId),
        eq(requests.componentId, q.componentId),
      ),
    );
  return rows.find((r) => r.targetClassId === q.targetClassId && r.targetAreaId === q.targetAreaId) ?? null;
}

/** Requests with the requester's name, newest first (approvals page, evaluation detail). */
export const listRequests = (
  db: DbOrTx,
  where: {
    statuses?: RequestRow['status'][];
    evaluationId?: string;
    roundId?: string;
    roundIds?: string[];
    types?: RequestRow['type'][];
    requesterId?: string;
  },
) =>
  db
    .select({ request: requests, requesterName: users.displayName })
    .from(requests)
    .innerJoin(users, eq(users.id, requests.requesterId))
    .where(
      and(
        where.statuses ? inArray(requests.status, where.statuses) : undefined,
        where.evaluationId ? eq(requests.evaluationId, where.evaluationId) : undefined,
        where.roundId ? eq(requests.roundId, where.roundId) : undefined,
        where.roundIds ? (where.roundIds.length ? inArray(requests.roundId, where.roundIds) : sql`false`) : undefined,
        where.types ? inArray(requests.type, where.types) : undefined,
        where.requesterId ? eq(requests.requesterId, where.requesterId) : undefined,
      ),
    )
    .orderBy(where.statuses?.includes('waiting') ? asc(requests.createdAt) : desc(requests.createdAt));
