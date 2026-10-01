import { notifications } from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

export async function insertNotifications(db: DbOrTx, rows: (typeof notifications.$inferInsert)[]) {
  if (rows.length > 0) await db.insert(notifications).values(rows);
}
