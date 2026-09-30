import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.ts';
import { appSettings } from '../../../db/schema.ts';

/** app_settings key written by the worker's heartbeat job; read by /api/v1/health. Not a school setting. */
export const WORKER_HEARTBEAT_KEY = 'system.workerHeartbeat';

export async function pingDb(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function writeWorkerHeartbeat(db: Db, at: Date, pid: number): Promise<void> {
  const value = { at: at.toISOString(), pid };
  await db
    .insert(appSettings)
    .values({ key: WORKER_HEARTBEAT_KEY, value, updatedAt: at })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: at } });
}

export async function readWorkerHeartbeat(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, WORKER_HEARTBEAT_KEY));
  const at = (row?.value as { at?: string } | undefined)?.at;
  return at ? new Date(at) : null;
}
