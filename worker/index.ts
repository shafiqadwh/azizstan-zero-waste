/**
 * Worker process (02-architecture §1): consumes pg-boss jobs stored in PostgreSQL.
 * Dev: pnpm worker:dev · Container: node worker/index.js
 */
import { PgBoss } from 'pg-boss';
import { createDb } from '../db/client.ts';
import { registerEvidenceJobs } from '../src/server/jobs/evidence.job.ts';
import { registerPdfJobs } from '../src/server/jobs/pdf.job.ts';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_QUEUE, heartbeatJob } from '../src/server/jobs/heartbeat.job.ts';
import { registerRoundJobs, ROUND_SWEEP_INTERVAL_MS } from '../src/server/jobs/rounds.job.ts';
import { notificationSweeps } from '../src/server/jobs/notify.job.ts';
import { registerRetentionJobs } from '../src/server/jobs/retention.job.ts';
import { registerStudentJobs } from '../src/server/jobs/students.job.ts';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');

  const { db, close } = createDb(url);
  const boss = new PgBoss(url);
  boss.on('error', (err) => console.error('[worker] pg-boss error', err));
  await boss.start();

  // The heartbeat goes through the queue on purpose: a fresh heartbeat proves jobs are actually consumed.
  await boss.createQueue(HEARTBEAT_QUEUE);
  await boss.work(HEARTBEAT_QUEUE, async () => {
    await heartbeatJob(db, new Date());
  });
  const beat = () =>
    boss.send(HEARTBEAT_QUEUE, {}, { retryLimit: 0 }).catch((err: unknown) => {
      console.error('[worker] heartbeat enqueue failed', err);
    });
  await beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

  // Rounds open and close on their dates (BR-R1, BR-R2); the sweep reads the dates every minute.
  const sweep = await registerRoundJobs(boss, db);
  await sweep();
  // PDFs of approved evaluations (09-pdf): queued rows become pdf.render jobs
  const pdf = await registerPdfJobs(boss, db);
  await pdf.sweep();
  // Student sync (BR-Y): nightly cron, plus the admin's manual request picked up by the sweep
  const studentSweep = await registerStudentJobs(boss, db);
  await studentSweep();
  // Reminders before/after the close and web push fan-out with batching (11-jobs §1–3)
  const notifySweep = notificationSweeps(db);
  await notifySweep();
  const sweepTimer = setInterval(() => {
    void sweep();
    void pdf.sweep();
    void studentSweep();
    void notifySweep();
  }, ROUND_SWEEP_INTERVAL_MS);

  // Orphan uploads are removed after 24 h (BR-V4).
  await registerEvidenceJobs(boss, db);
  // Term data one year after closing, expired students, old audit rows, sessions (BR-D1..D4)
  await registerRetentionJobs(boss, db);

  console.log('[worker] started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal}, stopping`);
    clearInterval(timer);
    clearInterval(sweepTimer);
    await boss.stop({ graceful: true });
    await pdf.close();
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
