import type { PgBoss } from 'pg-boss';
import type { Db } from '../../../db/client.ts';
import { checkDisk, DISK_QUEUE, formatPercent } from '../services/disk.service.ts';
import { log } from '../log.ts';

/** `disk.check` every hour at :15 (14-deployment §4), no retry: the next hour measures again. */
export async function registerDiskJobs(boss: PgBoss, db: Db) {
  await boss.createQueue(DISK_QUEUE, { policy: 'exclusive', retryLimit: 0 });
  await boss.work(DISK_QUEUE, async () => {
    const out = await checkDisk(db, new Date());
    if (out.alerted) log.warn('disk.check: low space', { used: formatPercent(out.usage.usedRatio) });
  });
  await boss.schedule(DISK_QUEUE, '15 * * * *', null, { tz: 'Asia/Bangkok' });
}
