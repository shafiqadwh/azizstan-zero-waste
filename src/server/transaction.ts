import type { Db } from '../../db/client.ts';

/** A Drizzle transaction handle. Repositories accept `DbOrTx` so they work inside and outside a transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/**
 * Run `fn` in one database transaction (AGENTS §5 rule 2: every mutation runs in a transaction and writes its
 * audit row inside it). Any thrown error, including an AppError, rolls the whole transaction back.
 */
export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
