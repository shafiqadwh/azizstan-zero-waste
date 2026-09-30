import type { Db } from '../../../db/client.ts';
import { writeWorkerHeartbeat } from '../repositories/system.repository.ts';

export const HEARTBEAT_QUEUE = 'worker.heartbeat';
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Job `worker.heartbeat` (11-jobs §1): records that the worker is alive and consuming jobs. Idempotent. */
export async function heartbeatJob(db: Db, now: Date): Promise<void> {
  await writeWorkerHeartbeat(db, now, process.pid);
}
