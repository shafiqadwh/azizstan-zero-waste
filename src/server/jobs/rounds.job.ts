import type { PgBoss } from 'pg-boss';
import type { Db } from '../../../db/client.ts';
import { closeRound, openRound, ROUND_CLOSE_QUEUE, ROUND_OPEN_QUEUE, sweepRounds } from '../services/round.service.ts';
import { log } from '../log.ts';

export const ROUND_SWEEP_INTERVAL_MS = 60_000;

interface RoundJob {
  roundId: string;
}

/**
 * `round.open` / `round.close` (11-jobs §1, 3 retries). `exclusive` + singletonKey = round id: at most one job
 * per round is queued or running, so the minute sweep never piles up duplicates. Handlers are idempotent.
 */
export async function registerRoundJobs(boss: PgBoss, db: Db) {
  for (const name of [ROUND_OPEN_QUEUE, ROUND_CLOSE_QUEUE]) {
    await boss.createQueue(name, { policy: 'exclusive', retryLimit: 3, retryBackoff: true });
  }
  await boss.work<RoundJob>(ROUND_OPEN_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const out = await openRound(db, job.data.roundId, new Date());
      if (out.changed) log.info('round.open', { roundId: job.data.roundId, out });
    }
  });
  await boss.work<RoundJob>(ROUND_CLOSE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const out = await closeRound(db, job.data.roundId, new Date());
      if (out.changed) log.info('round.close', { roundId: job.data.roundId });
    }
  });
  return () =>
    sweepRounds(db, new Date(), (queue, roundId) => boss.send(queue, { roundId }, { singletonKey: roundId })).catch(
      (err: unknown) => log.error('round sweep failed', err),
    );
}
