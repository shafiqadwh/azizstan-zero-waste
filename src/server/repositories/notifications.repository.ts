import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { notifications, pushSubscriptions } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export async function insertNotifications(db: DbOrTx, rows: (typeof notifications.$inferInsert)[]) {
  if (rows.length > 0) await db.insert(notifications).values(rows);
}

// ── inbox ──
export const listInbox = (db: DbOrTx, userId: string, limit = 50) =>
  db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

export async function countUnread(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function markRead(db: DbOrTx, userId: string, at: Date, ids?: string[]) {
  await db
    .update(notifications)
    .set({ readAt: at })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined,
      ),
    );
}

// ── push fan-out ──
/** Notifications not handled by push.send yet (only recent ones — older ones are inbox-only). */
export const listUnpushed = (db: DbOrTx, since: Date) =>
  db
    .select()
    .from(notifications)
    .where(and(isNull(notifications.pushedAt), gt(notifications.createdAt, since)))
    .orderBy(asc(notifications.createdAt));

/** When the last push of this type went to this user (the 10-minute batching window). */
export async function lastPushedAt(db: DbOrTx, userId: string, type: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(${notifications.pushedAt})` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));
  return row?.at ? new Date(row.at) : null;
}

export async function markPushed(db: DbOrTx, ids: string[], at: Date) {
  if (ids.length) await db.update(notifications).set({ pushedAt: at }).where(inArray(notifications.id, ids));
}

/** Old rows that will never be pushed (created before the push window) — inbox only. */
export async function markStaleAsPushed(db: DbOrTx, before: Date, at: Date) {
  await db
    .update(notifications)
    .set({ pushedAt: at })
    .where(and(isNull(notifications.pushedAt), lt(notifications.createdAt, before)));
}

// ── subscriptions ──
export const listSubscriptions = (db: DbOrTx, userId: string) =>
  db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));

export async function upsertSubscription(db: DbOrTx, row: typeof pushSubscriptions.$inferInsert) {
  await db
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: row.userId, p256dh: row.p256dh, auth: row.auth, userAgent: row.userAgent },
    });
}

export async function deleteSubscription(db: DbOrTx, endpoint: string, userId?: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), userId ? eq(pushSubscriptions.userId, userId) : undefined));
}

export async function markSubscriptionOk(db: DbOrTx, id: string, at: Date) {
  await db.update(pushSubscriptions).set({ lastSuccessAt: at }).where(eq(pushSubscriptions.id, id));
}
