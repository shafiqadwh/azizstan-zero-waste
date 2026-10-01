/**
 * In-app notifications (11-jobs-notifications §2). The inbox row is the source of truth; web push (`push.send`)
 * is added with the jobs ticket and stays optional.
 */
import { newId } from '../../lib/ids.ts';
import { insertNotifications } from '../repositories/notifications.repository.ts';
import type { DbOrTx } from '../transaction.ts';

export interface Notice {
  userIds: readonly string[];
  type: string;
  title: string;
  body: string;
  link?: string | null;
}

/** Call inside the mutation's transaction so the notice only exists if the change committed. */
export async function send(db: DbOrTx, notice: Notice, now: Date): Promise<void> {
  await insertNotifications(
    db,
    [...new Set(notice.userIds)].map((userId) => ({
      id: newId(),
      userId,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      link: notice.link ?? null,
      createdAt: now,
    })),
  );
}
