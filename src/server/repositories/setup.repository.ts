import { eq, sql } from 'drizzle-orm';
import {
  appointmentOrders,
  areas,
  classes,
  duties,
  physicalRooms,
  rounds,
  syncRuns,
  termClasses,
} from '../../../db/schema.ts';
import type { DbOrTx } from '../transaction.ts';

const n = sql<number>`count(*)::int`;

/** Row counts behind the admin's first-day setup checklist (14-deployment §2 step 7). */
export async function countSetup(db: DbOrTx, termId: string | null) {
  const one = async (q: PromiseLike<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const perTerm = async (q: () => PromiseLike<{ n: number }[]>) => (termId ? one(q()) : 0);
  return {
    areas: await one(db.select({ n }).from(areas).where(eq(areas.isActive, true))),
    rooms: await one(db.select({ n }).from(physicalRooms).where(eq(physicalRooms.isActive, true))),
    classes: await one(db.select({ n }).from(classes).where(eq(classes.isActive, true))),
    syncedOk: await one(db.select({ n }).from(syncRuns).where(eq(syncRuns.status, 'success'))),
    rounds: await perTerm(() => db.select({ n }).from(rounds).where(eq(rounds.termId, termId!))),
    termClasses: await perTerm(() => db.select({ n }).from(termClasses).where(eq(termClasses.termId, termId!))),
    duties: await perTerm(() => db.select({ n }).from(duties).where(eq(duties.termId, termId!))),
    orders: await perTerm(() => db.select({ n }).from(appointmentOrders).where(eq(appointmentOrders.termId, termId!))),
  };
}
