import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { auditLogs, evaluations, requests, users } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export const FEED_EVALUATION_ACTIONS = [
  'evaluation.submit',
  'evaluation.update',
  'evaluation.resubmit',
  'evaluation.delete',
  'evaluation.approve',
  'evaluation.return',
] as const;
export const FEED_REQUEST_ACTIONS = ['request.create', 'request.approve', 'request.reject'] as const;

/**
 * 11-jobs §2b: the latest events of a round from `audit_logs` — evaluation and request actions whose entity
 * belongs to the round — newest first, with the actor's name and the entity's target.
 */
export async function listRoundActivity(db: DbOrTx, roundId: string, opts: { since?: Date; limit: number }) {
  const evalIds = db
    .select({ id: sql<string>`${evaluations.id}::text` })
    .from(evaluations)
    .where(eq(evaluations.roundId, roundId));
  const requestIds = db
    .select({ id: sql<string>`${requests.id}::text` })
    .from(requests)
    .where(eq(requests.roundId, roundId));
  return db
    .select({
      id: auditLogs.id,
      at: auditLogs.at,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      after: auditLogs.after,
      actorName: users.displayName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(
      and(
        or(
          and(
            eq(auditLogs.entity, 'evaluation'),
            inArray(auditLogs.action, [...FEED_EVALUATION_ACTIONS]),
            inArray(auditLogs.entityId, evalIds),
          ),
          and(
            eq(auditLogs.entity, 'request'),
            inArray(auditLogs.action, [...FEED_REQUEST_ACTIONS]),
            inArray(auditLogs.entityId, requestIds),
          ),
        ),
        opts.since ? gt(auditLogs.at, opts.since) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(opts.limit);
}

/** Evaluations (any status, void included) and requests by id — to resolve the targets of feed rows. */
export async function findEvaluationsByIds(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(evaluations).where(inArray(evaluations.id, ids));
}

export async function findRequestsByIds(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(requests).where(inArray(requests.id, ids));
}
