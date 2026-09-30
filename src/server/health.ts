/** The worker beats every 30 s; two missed beats plus polling slack makes it stale. */
export const HEARTBEAT_STALE_AFTER_S = 90;

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  db: 'ok' | 'error';
  worker: { lastHeartbeatAt: string | null; ageSeconds: number | null; status: 'ok' | 'stale' | 'missing' };
}

/** Pure: turns probe results into the /api/v1/health body. `down` = no database; `degraded` = worker not beating. */
export function evaluateHealth(input: { dbOk: boolean; heartbeatAt: Date | null; now: Date }): HealthReport {
  const { dbOk, heartbeatAt, now } = input;
  const ageSeconds = heartbeatAt ? Math.max(0, Math.round((now.getTime() - heartbeatAt.getTime()) / 1000)) : null;
  const workerStatus = ageSeconds === null ? 'missing' : ageSeconds > HEARTBEAT_STALE_AFTER_S ? 'stale' : 'ok';
  return {
    status: !dbOk ? 'down' : workerStatus === 'ok' ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'error',
    worker: { lastHeartbeatAt: heartbeatAt?.toISOString() ?? null, ageSeconds, status: workerStatus },
  };
}
