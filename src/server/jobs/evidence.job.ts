import type { PgBoss } from 'pg-boss';
import type { Db } from '../../../db/client.ts';
import { EVIDENCE_GC_QUEUE, gcOrphanEvidence } from '../services/evidence-gc.service.ts';

/** `evidence.gc` daily at 04:00 Bangkok (11-jobs §1, BR-V4), 1 retry. */
export async function registerEvidenceJobs(boss: PgBoss, db: Db) {
  await boss.createQueue(EVIDENCE_GC_QUEUE, { policy: 'exclusive', retryLimit: 1 });
  await boss.work(EVIDENCE_GC_QUEUE, async () => {
    const out = await gcOrphanEvidence(db, new Date());
    if (out.deleted > 0) console.log(`[worker] evidence.gc deleted ${out.deleted}`);
  });
  await boss.schedule(EVIDENCE_GC_QUEUE, '0 4 * * *', null, { tz: 'Asia/Bangkok' });
}
