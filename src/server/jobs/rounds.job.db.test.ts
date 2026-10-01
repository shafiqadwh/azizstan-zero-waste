/** T16: the worker wiring — real pg-boss queues open and close a due round. */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createDb, type Db } from '../../../db/client.ts';
import { runMigrations } from '../../../db/migrate.ts';
import { rounds, terms } from '../../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { registerRoundJobs } from './rounds.job.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('needs DATABASE_URL');
const dbName = `zw_jobs_${randomBytes(4).toString('hex')}`;
const url = Object.assign(new URL(baseUrl), { pathname: `/${dbName}` }).toString();
const pgAdmin = async (sql: string) => {
  const c = new pg.Client({ connectionString: Object.assign(new URL(baseUrl), { pathname: '/postgres' }).toString() });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
};

let db: Db;
let close: () => Promise<void>;
let boss: PgBoss;

beforeAll(async () => {
  await pgAdmin(`CREATE DATABASE ${dbName}`);
  await runMigrations(url);
  ({ db, close } = createDb(url));
  boss = new PgBoss({ connectionString: url, schedule: false, supervise: false });
  boss.on('error', () => {});
  await boss.start();
});

afterAll(async () => {
  await boss?.stop({ graceful: false }).catch(() => {});
  await close?.();
  await pgAdmin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
});

async function statusOf(id: string) {
  const [r] = await db.select({ status: rounds.status }).from(rounds).where(eq(rounds.id, id));
  return r?.status;
}

async function waitFor(id: string, status: string) {
  for (let i = 0; i < 100; i++) {
    if ((await statusOf(id)) === status) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`round never became ${status} (is ${await statusOf(id)})`);
}

test('sweep → round.open → sweep → round.close', async () => {
  const termId = newId();
  const roundId = newId();
  const now = Date.now();
  await db
    .insert(terms)
    .values({ id: termId, academicYear: 2569, termNo: 2, status: 'active', areaType: 'building', finalMax: '15' });
  await db.insert(rounds).values({
    id: roundId,
    termId,
    roundNo: 1,
    opensAt: new Date(now - 60_000),
    closesAt: new Date(now + 1500),
  });
  const sweep = await registerRoundJobs(boss, db);
  await Promise.all([sweep(), sweep()]); // a duplicate sweep is absorbed by the singleton key
  await waitFor(roundId, 'open');
  await new Promise((r) => setTimeout(r, 1600));
  await sweep();
  await waitFor(roundId, 'closed');
  expect(await statusOf(roundId)).toBe('closed');
}, 30_000);
