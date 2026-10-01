import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { apiKeys, roundStudentResults, students } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export const listApiKeys = (db: DbOrTx) => db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));

export async function insertApiKey(db: DbOrTx, row: typeof apiKeys.$inferInsert) {
  await db.insert(apiKeys).values(row);
}

export async function findActiveKeyByHash(db: DbOrTx, keyHash: string) {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));
  return row ?? null;
}

export async function touchApiKey(db: DbOrTx, id: string, at: Date) {
  await db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
}

export async function revokeApiKey(db: DbOrTx, id: string, at: Date) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: at })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning();
  return row ?? null;
}

/** Frozen per-student totals of finalized rounds, with codes (never names). */
export async function listStudentResults(db: DbOrTx, roundIds: string[]) {
  if (roundIds.length === 0) return [];
  return db
    .select({
      roundId: roundStudentResults.roundId,
      classId: roundStudentResults.classId,
      total: roundStudentResults.total,
      studentCode: students.studentCode,
      homeClassId: students.homeClassId,
    })
    .from(roundStudentResults)
    .innerJoin(students, eq(students.id, roundStudentResults.studentId))
    .where(inArray(roundStudentResults.roundId, roundIds));
}
