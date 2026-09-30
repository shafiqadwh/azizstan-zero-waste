import { getDb } from '@/server/db';
import { evaluateHealth } from '@/server/health';
import { pingDb, readWorkerHeartbeat } from '@/server/repositories/system.repository';

export const dynamic = 'force-dynamic';

/** GET /api/v1/health — 200 when the database answers and the worker heartbeat is fresh, else 503. */
export async function GET() {
  let dbOk = false;
  let heartbeatAt: Date | null = null;
  try {
    const db = getDb();
    await pingDb(db);
    dbOk = true;
    heartbeatAt = await readWorkerHeartbeat(db);
  } catch {
    // reported as db: 'error' / worker: 'missing'; details stay in the server log only
  }
  const report = evaluateHealth({ dbOk, heartbeatAt, now: new Date() });
  return Response.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
