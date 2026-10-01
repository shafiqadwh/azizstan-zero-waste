import type { PgBoss } from 'pg-boss';
import type { Db } from '../../../db/client.ts';
import { log } from '../log.ts';
import {
  RETENTION_RUN_QUEUE,
  RETENTION_WARN_QUEUE,
  runRetention,
  warnRetention,
} from '../services/retention.service.ts';

/** `retention.run` 03:00 and `retention.warn` 08:00 Bangkok (11-jobs §1, BR-D1..D4), 1 retry each. */
export async function registerRetentionJobs(boss: PgBoss, db: Db) {
  await boss.createQueue(RETENTION_RUN_QUEUE, { policy: 'exclusive', retryLimit: 1 });
  await boss.work(RETENTION_RUN_QUEUE, async () => {
    const out = await runRetention(db, new Date());
    log.info('retention.run', {
      terms: out.purgedTerms.length,
      students: out.students,
      auditRows: out.oldAuditRows,
      sessions: out.sessions,
    });
  });
  await boss.schedule(RETENTION_RUN_QUEUE, '0 3 * * *', null, { tz: 'Asia/Bangkok' });

  await boss.createQueue(RETENTION_WARN_QUEUE, { policy: 'exclusive', retryLimit: 1 });
  await boss.work(RETENTION_WARN_QUEUE, async () => {
    const out = await warnRetention(db, new Date());
    if (out.warned.length) log.info('retention.warn', { terms: out.warned.length });
  });
  await boss.schedule(RETENTION_WARN_QUEUE, '0 8 * * *', null, { tz: 'Asia/Bangkok' });
}
