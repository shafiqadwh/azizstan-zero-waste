import { inArray, and, asc, eq, ne, sql } from 'drizzle-orm';
import { sessions, users } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export type UserRow = typeof users.$inferSelect;

export async function findUserByUsername(db: DbOrTx, username: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username.trim().toLowerCase()}`);
  return row ?? null;
}

export async function findUserById(db: DbOrTx, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function setLastLogin(db: DbOrTx, userId: string, at: Date): Promise<void> {
  await db.update(users).set({ lastLoginAt: at }).where(eq(users.id, userId));
}

export async function setPassword(
  db: DbOrTx,
  userId: string,
  passwordHash: string,
  mustChangePassword: boolean,
  at: Date,
): Promise<void> {
  await db.update(users).set({ passwordHash, mustChangePassword, updatedAt: at }).where(eq(users.id, userId));
}

// ── sessions ──
export type SessionRow = typeof sessions.$inferSelect;

export async function insertSession(db: DbOrTx, row: typeof sessions.$inferInsert): Promise<void> {
  await db.insert(sessions).values(row);
}

export async function findSessionWithUser(db: DbOrTx, sessionId: string) {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId));
  return row ?? null;
}

export async function touchSession(db: DbOrTx, sessionId: string, at: Date): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, sessionId));
}

export async function setStepUp(db: DbOrTx, sessionId: string, at: Date): Promise<void> {
  await db.update(sessions).set({ stepUpAt: at }).where(eq(sessions.id, sessionId));
}

export async function deleteSession(db: DbOrTx, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Sign the user out everywhere else (after a password change). */
export async function deleteOtherSessions(db: DbOrTx, userId: string, keepSessionId: string): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
}

export async function insertUser(db: DbOrTx, row: typeof users.$inferInsert): Promise<void> {
  await db.insert(users).values(row);
}

export async function updateUser(db: DbOrTx, id: string, patch: Partial<typeof users.$inferInsert>): Promise<void> {
  await db.update(users).set(patch).where(eq(users.id, id));
}

/** Admin list: explicit columns, so password hashes never leave this layer. */
export async function listUsers(db: DbOrTx) {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      authSource: users.authSource,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(asc(users.role), asc(sql`lower(${users.username})`));
}

export async function countActiveSuperAdmins(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true)));
  return row?.n ?? 0;
}

export async function deleteUserSessions(db: DbOrTx, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function listActiveUserIdsByRole(db: DbOrTx, roles: UserRow['role'][]): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, roles)));
  return rows.map((r) => r.id);
}
