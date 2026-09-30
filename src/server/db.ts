import { createDb } from '../../db/client.ts';

type Handle = ReturnType<typeof createDb>;
const g = globalThis as typeof globalThis & { __zwDb?: Handle };

/** Process-wide database handle for the Next.js server (one pool, reused across hot reloads in dev). */
export function getDb() {
  g.__zwDb ??= createDb();
  return g.__zwDb.db;
}
