import { desc, eq, inArray, sql } from 'drizzle-orm';
import { classAliases, classes, classSkipRules, students, syncRuns } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type StudentRecord = typeof students.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;

/** Everything the diff needs. `full_name` is read only to detect renames (student sync is its only reader). */
export const listStudentsForSync = (db: DbOrTx) =>
  db
    .select({
      id: students.id,
      studentCode: students.studentCode,
      fullName: students.fullName,
      generalClassId: students.generalClassId,
      religiousClassId: students.religiousClassId,
      homeClassId: students.homeClassId,
      status: students.status,
      reviewReason: students.reviewReason,
    })
    .from(students);

export async function insertStudents(db: DbOrTx, rows: (typeof students.$inferInsert)[]) {
  for (let i = 0; i < rows.length; i += 500) await db.insert(students).values(rows.slice(i, i + 500));
}

export async function updateStudent(db: DbOrTx, id: string, patch: Partial<typeof students.$inferInsert>) {
  await db.update(students).set(patch).where(eq(students.id, id));
}

export async function setInactive(db: DbOrTx, ids: string[]) {
  for (let i = 0; i < ids.length; i += 500)
    await db
      .update(students)
      .set({ status: 'inactive' })
      .where(inArray(students.id, ids.slice(i, i + 500)));
}

export async function countActiveStudents(db: DbOrTx) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(students)
    .where(eq(students.status, 'active'));
  return row?.n ?? 0;
}

/** Review list (§6.15): codes and reasons only — never names. */
export const listReviewStudents = (db: DbOrTx) =>
  db
    .select({ id: students.id, studentCode: students.studentCode, reviewReason: students.reviewReason })
    .from(students)
    .where(eq(students.status, 'review'))
    .orderBy(students.studentCode);

export const listAliasMap = (db: DbOrTx) =>
  db.select({ alias: classAliases.alias, classId: classAliases.classId }).from(classAliases);

export const listClassesForSync = (db: DbOrTx) =>
  db
    .select({
      id: classes.id,
      gradeLabel: classes.gradeLabel,
      name: classes.name,
      displayName: classes.displayName,
      isActive: classes.isActive,
    })
    .from(classes);

export const listSkipRules = (db: DbOrTx) => db.select().from(classSkipRules).orderBy(classSkipRules.prefix);

export async function insertSkipRule(db: DbOrTx, row: typeof classSkipRules.$inferInsert) {
  await db.insert(classSkipRules).values(row);
}

export async function deleteSkipRule(db: DbOrTx, id: string) {
  const [row] = await db.delete(classSkipRules).where(eq(classSkipRules.id, id)).returning();
  return row ?? null;
}

export async function insertSyncRun(db: DbOrTx, row: typeof syncRuns.$inferInsert) {
  await db.insert(syncRuns).values(row);
}

export const listSyncRuns = (db: DbOrTx, limit = 30) =>
  db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt), syncRuns.source).limit(limit);

/** Serialises syncs (cron and the manual button) without a second table. */
export async function lockSync(db: DbOrTx) {
  const res = await db.execute(sql`select pg_try_advisory_xact_lock(hashtext('students.sync')) as ok`);
  return (res.rows[0] as { ok?: boolean } | undefined)?.ok === true;
}
