import { asc, eq, inArray } from 'drizzle-orm';
import { appointmentOrders, guidePages } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type OrderRow = typeof appointmentOrders.$inferSelect;
export type GuideRow = typeof guidePages.$inferSelect;

export const listOrders = (db: DbOrTx, termId: string) =>
  db
    .select()
    .from(appointmentOrders)
    .where(eq(appointmentOrders.termId, termId))
    .orderBy(asc(appointmentOrders.sortOrder), asc(appointmentOrders.createdAt));

export async function findOrder(db: DbOrTx, id: string) {
  const [row] = await db.select().from(appointmentOrders).where(eq(appointmentOrders.id, id));
  return row ?? null;
}

export async function insertOrder(db: DbOrTx, row: typeof appointmentOrders.$inferInsert) {
  await db.insert(appointmentOrders).values(row);
}

export async function deleteOrder(db: DbOrTx, id: string) {
  await db.delete(appointmentOrders).where(eq(appointmentOrders.id, id));
}

export const listGuidePages = (db: DbOrTx, audiences?: string[]) =>
  db
    .select()
    .from(guidePages)
    .where(audiences ? inArray(guidePages.audience, audiences) : undefined)
    .orderBy(asc(guidePages.sortOrder), asc(guidePages.title));

export async function findGuidePage(db: DbOrTx, slug: string) {
  const [row] = await db.select().from(guidePages).where(eq(guidePages.slug, slug));
  return row ?? null;
}

export async function findGuidePageById(db: DbOrTx, id: string) {
  const [row] = await db.select().from(guidePages).where(eq(guidePages.id, id));
  return row ?? null;
}

export async function insertGuidePage(db: DbOrTx, row: typeof guidePages.$inferInsert) {
  await db.insert(guidePages).values(row);
}

export async function updateGuidePage(db: DbOrTx, id: string, patch: Partial<typeof guidePages.$inferInsert>) {
  await db.update(guidePages).set(patch).where(eq(guidePages.id, id));
}

export async function deleteGuidePage(db: DbOrTx, id: string) {
  await db.delete(guidePages).where(eq(guidePages.id, id));
}
