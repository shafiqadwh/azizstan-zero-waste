import type { PgBoss } from 'pg-boss';
import type { Db } from '../../../db/client.ts';
import { httpFetcher, runStudentSync, STUDENT_SYNC_QUEUE, takeSyncRequest } from '../services/student.service.ts';

/**
 * `students.sync` daily at 02:00 Bangkok and on the admin's "sync ตอนนี้" (11-jobs §1, BR-Y). Failures are
 * recorded in `sync_runs` and reported to admins by the service, so the job itself never throws and retries.
 * Returns the sweep that turns a pending manual request into a job.
 */
export async function registerStudentJobs(boss: PgBoss, db: Db) {
  await boss.createQueue(STUDENT_SYNC_QUEUE, { policy: 'exclusive', retryLimit: 0, expireInSeconds: 600 });
  await boss.work<{ triggeredBy?: string | null }>(STUDENT_SYNC_QUEUE, async ([job]) => {
    const out = await runStudentSync(db, {
      fetcher: httpFetcher(),
      now: new Date(),
      triggeredBy: job?.data?.triggeredBy ?? null,
    });
    // counts only — never codes, names or the request URL
    console.log(`[worker] students.sync ${out.status}`, JSON.stringify(out.counts));
  });
  await boss.schedule(STUDENT_SYNC_QUEUE, '0 2 * * *', {}, { tz: 'Asia/Bangkok' });
  return async () => {
    try {
      const req = await takeSyncRequest(db);
      if (req) await boss.send(STUDENT_SYNC_QUEUE, { triggeredBy: req.by }, { singletonKey: 'students.sync' });
    } catch (err) {
      console.error('[worker] students.sync request sweep failed', err);
    }
  };
}
