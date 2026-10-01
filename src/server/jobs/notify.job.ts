import type { Db } from '../../../db/client.ts';
import { sweepPush, webPushSender } from '../services/push.service.ts';
import { sweepReminders } from '../services/reminder.service.ts';
import { log } from '../log.ts';

/**
 * `push.send` and `round.remind` / `round.overdue` (11-jobs §1). Both are minute sweeps over the database —
 * idempotent, so the worker simply calls them next to the round and PDF sweeps.
 */
export function notificationSweeps(db: Db) {
  const sender = webPushSender();
  if (!sender) log.warn('VAPID keys not set — web push is off (the inbox still works)');
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      await sweepReminders(db, now);
      await sweepPush(db, sender, now);
    } catch (err) {
      log.error('notification sweep failed', err);
    } finally {
      running = false;
    }
  };
}
