import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { areas, classAliases, classes, classRoomLinks, physicalRooms, termClasses, terms } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type AreaRow = typeof areas.$inferSelect;
export type RoomRow = typeof physicalRooms.$inferSelect;
export type ClassRow = typeof classes.$inferSelect;
export type LinkRow = typeof classRoomLinks.$inferSelect;
export type TermRow = typeof terms.$inferSelect;

/** A link is in effect on `date` (ISO yyyy-mm-dd) when from ≤ date < to (to null = open). */
const linkOnDate = (date: string) =>
  and(
    lte(classRoomLinks.effectiveFrom, date),
    or(isNull(classRoomLinks.effectiveTo), gt(classRoomLinks.effectiveTo, date)),
  );

// ── areas ──
export const listAreas = (db: DbOrTx) =>
  db.select().from(areas).orderBy(asc(areas.type), asc(areas.sortOrder), asc(areas.code));

export async function findArea(db: DbOrTx, id: string) {
  const [row] = await db.select().from(areas).where(eq(areas.id, id));
  return row ?? null;
}

export async function findAreaByCode(db: DbOrTx, type: AreaRow['type'], code: string) {
  const [row] = await db
    .select()
    .from(areas)
    .where(and(eq(areas.type, type), eq(areas.code, code)));
  return row ?? null;
}

export async function insertArea(db: DbOrTx, row: typeof areas.$inferInsert) {
  await db.insert(areas).values(row);
}

export async function updateArea(db: DbOrTx, id: string, patch: Partial<typeof areas.$inferInsert>) {
  await db.update(areas).set(patch).where(eq(areas.id, id));
}

// ── physical rooms ──
export const listRooms = (db: DbOrTx) => db.select().from(physicalRooms).orderBy(asc(physicalRooms.roomNumber));

export async function findRoom(db: DbOrTx, id: string) {
  const [row] = await db.select().from(physicalRooms).where(eq(physicalRooms.id, id));
  return row ?? null;
}

export async function findRoomByNumber(db: DbOrTx, roomNumber: string) {
  const [row] = await db.select().from(physicalRooms).where(eq(physicalRooms.roomNumber, roomNumber));
  return row ?? null;
}

export async function insertRoom(db: DbOrTx, row: typeof physicalRooms.$inferInsert) {
  await db.insert(physicalRooms).values(row);
}

export async function updateRoom(db: DbOrTx, id: string, patch: Partial<typeof physicalRooms.$inferInsert>) {
  await db.update(physicalRooms).set(patch).where(eq(physicalRooms.id, id));
}

// ── classes and aliases ──
export const listClasses = (db: DbOrTx) =>
  db.select().from(classes).orderBy(asc(classes.track), asc(classes.gradeCode), asc(classes.roomNo), asc(classes.name));

export async function findClass(db: DbOrTx, id: string) {
  const [row] = await db.select().from(classes).where(eq(classes.id, id));
  return row ?? null;
}

export async function findClassByKey(db: DbOrTx, track: ClassRow['track'], gradeCode: string, name: string) {
  const [row] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.track, track), eq(classes.gradeCode, gradeCode), eq(classes.name, name)));
  return row ?? null;
}

export async function insertClass(db: DbOrTx, row: typeof classes.$inferInsert) {
  await db.insert(classes).values(row);
}

export async function updateClass(db: DbOrTx, id: string, patch: Partial<typeof classes.$inferInsert>) {
  await db.update(classes).set(patch).where(eq(classes.id, id));
}

export const listAliases = (db: DbOrTx) => db.select().from(classAliases).orderBy(asc(classAliases.alias));

export async function findAlias(db: DbOrTx, alias: string) {
  const [row] = await db.select().from(classAliases).where(eq(classAliases.alias, alias));
  return row ?? null;
}

export async function insertAlias(db: DbOrTx, row: typeof classAliases.$inferInsert) {
  await db.insert(classAliases).values(row);
}

export async function deleteAlias(db: DbOrTx, id: string) {
  const [row] = await db.delete(classAliases).where(eq(classAliases.id, id)).returning();
  return row ?? null;
}

/** Resolve a class from a lookup key (alias) or an exact display name, e.g. "ม.1 Amanah". */
export async function findClassByAliasOrDisplay(db: DbOrTx, key: string | null, display: string) {
  if (key) {
    const [viaAlias] = await db
      .select({ c: classes })
      .from(classAliases)
      .innerJoin(classes, eq(classes.id, classAliases.classId))
      .where(eq(classAliases.alias, key));
    if (viaAlias) return viaAlias.c;
  }
  const [byDisplay] = await db
    .select()
    .from(classes)
    .where(sql`lower(${classes.displayName}) = ${display.trim().toLowerCase()}`);
  return byDisplay ?? null;
}

// ── class ↔ room links ──
export const listLinksOnDate = (db: DbOrTx, date: string) => db.select().from(classRoomLinks).where(linkOnDate(date));

export async function linkOfClassOnDate(db: DbOrTx, classId: string, date: string) {
  const [row] = await db
    .select()
    .from(classRoomLinks)
    .where(and(eq(classRoomLinks.classId, classId), linkOnDate(date)));
  return row ?? null;
}

export async function linkOfRoomOnDate(db: DbOrTx, roomId: string, date: string) {
  const [row] = await db
    .select()
    .from(classRoomLinks)
    .where(and(eq(classRoomLinks.physicalRoomId, roomId), linkOnDate(date)));
  return row ?? null;
}

/** Links of a class or room that start after `date` (a move already planned for later). */
export async function laterLinks(db: DbOrTx, by: { classId?: string; roomId?: string }, date: string) {
  const owner = by.classId ? eq(classRoomLinks.classId, by.classId) : eq(classRoomLinks.physicalRoomId, by.roomId!);
  return db
    .select()
    .from(classRoomLinks)
    .where(and(owner, gt(classRoomLinks.effectiveFrom, date)));
}

export async function insertLink(db: DbOrTx, row: typeof classRoomLinks.$inferInsert) {
  await db.insert(classRoomLinks).values(row);
}

export async function closeLink(db: DbOrTx, id: string, effectiveTo: string) {
  await db.update(classRoomLinks).set({ effectiveTo }).where(eq(classRoomLinks.id, id));
}

export async function deleteLink(db: DbOrTx, id: string) {
  await db.delete(classRoomLinks).where(eq(classRoomLinks.id, id));
}

export const linksOfClass = (db: DbOrTx, classId: string) =>
  db
    .select()
    .from(classRoomLinks)
    .where(eq(classRoomLinks.classId, classId))
    .orderBy(asc(classRoomLinks.effectiveFrom));

// ── terms and per-term class selection (FR-P7) ──
export async function findTerm(db: DbOrTx, id: string) {
  const [row] = await db.select().from(terms).where(eq(terms.id, id));
  return row ?? null;
}

export async function findActiveTerm(db: DbOrTx) {
  const [row] = await db.select().from(terms).where(eq(terms.status, 'active'));
  return row ?? null;
}

/**
 * The classes taking part in a term. Every later feature that lists targets, ranks classes or exports scores
 * must start from this set (FR-P7): an unselected class is not a target, not ranked and not exported.
 */
export async function listTermClassIds(db: DbOrTx, termId: string): Promise<string[]> {
  const rows = await db.select({ id: termClasses.classId }).from(termClasses).where(eq(termClasses.termId, termId));
  return rows.map((r) => r.id);
}

export async function replaceTermClasses(db: DbOrTx, termId: string, classIds: string[]) {
  await db.delete(termClasses).where(eq(termClasses.termId, termId));
  if (classIds.length > 0) await db.insert(termClasses).values(classIds.map((classId) => ({ termId, classId })));
}

export async function countExistingClasses(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(classes)
    .where(inArray(classes.id, ids));
  return row?.n ?? 0;
}

/** Links that start after `date` (planned moves), earliest first. */
export const upcomingLinks = (db: DbOrTx, date: string) =>
  db
    .select()
    .from(classRoomLinks)
    .where(gt(classRoomLinks.effectiveFrom, date))
    .orderBy(asc(classRoomLinks.effectiveFrom));

export async function findRoomByQrToken(db: DbOrTx, qrToken: string) {
  const [row] = await db.select().from(physicalRooms).where(eq(physicalRooms.qrToken, qrToken));
  return row ?? null;
}
