/**
 * Database tests (T01). Need a PostgreSQL 16 server: DATABASE_URL must point at a role that may create
 * databases. Each run creates a throw-away database, migrates it from scratch, and drops it.
 * Run: DATABASE_URL=… pnpm test:db
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { newId } from '../src/lib/ids.ts';
import { createDb } from './client.ts';
import { runMigrations } from './migrate.ts';
import { seed } from './seed.ts';
import { readWorkerHeartbeat, writeWorkerHeartbeat } from '../src/server/repositories/system.repository.ts';
import { AppError } from '../src/server/errors.ts';
import { writeAudit } from '../src/server/services/audit.service.ts';
import { withTransaction } from '../src/server/transaction.ts';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('pnpm test:db needs DATABASE_URL (see .env.example)');

const dbName = `zw_test_${randomBytes(4).toString('hex')}`;
const withDb = (name: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  return u.toString();
};
const url = withDb(dbName);

async function admin<T>(fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: withDb('postgres') });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

let client: pg.Client;

beforeAll(async () => {
  await admin((c) => c.query(`CREATE DATABASE ${dbName}`));
  await runMigrations(url);
  client = new pg.Client({ connectionString: url });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
  await admin((c) => c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`));
});

const pgCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
};

describe('fresh database', () => {
  test('migrates every table', async () => {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(rows[0].n).toBe(35);
  });

  test('ships the มุตะวัซซิต skip rules as reference data (BR-Y step 4a)', async () => {
    const { rows } = await client.query('SELECT prefix FROM class_skip_rules ORDER BY prefix');
    expect(rows.map((r) => r.prefix).sort()).toEqual(['1M ', '2M ', '3M ', 'มุตะวัซซิต'].sort());
  });

  test('re-running migrations is a no-op', async () => {
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });
});

describe('class ↔ room links (FR-P3, invariant I2)', () => {
  let building: string, room1: string, room2: string, classA: string, classB: string;

  beforeAll(async () => {
    building = newId();
    [room1, room2, classA, classB] = [newId(), newId(), newId(), newId()];
    await client.query(`INSERT INTO areas (id, type, code, name) VALUES ($1, 'building', 'T', 'อาคารทดสอบ')`, [
      building,
    ]);
    await client.query(
      `INSERT INTO physical_rooms (id, building_id, room_number, qr_token) VALUES ($1, $3, 'T11', 'qr-t11'), ($2, $3, 'T12', 'qr-t12')`,
      [room1, room2, building],
    );
    await client.query(
      `INSERT INTO classes (id, track, grade_code, grade_label, rank_group, room_no, name, display_name) VALUES
        ($1, 'general', 'MT', 'ม.T', 'ม.T', 1, 'Alpha', 'ม.T Alpha'),
        ($2, 'general', 'MT', 'ม.T', 'ม.T', 2, 'Beta', 'ม.T Beta')`,
      [classA, classB],
    );
    await client.query(
      `INSERT INTO class_room_links (id, class_id, physical_room_id, effective_from, effective_to) VALUES ($1, $2, $3, '2026-11-01', '2026-12-01')`,
      [newId(), classA, room1],
    );
  });

  const link = (classId: string, roomId: string, from: string, to: string | null) =>
    client.query(
      `INSERT INTO class_room_links (id, class_id, physical_room_id, effective_from, effective_to) VALUES ($1, $2, $3, $4, $5)`,
      [newId(), classId, roomId, from, to],
    );

  test('rejects a class in two rooms at the same time', async () => {
    expect(await pgCode(link(classA, room2, '2026-11-15', null))).toBe('23P01');
  });

  test('rejects two classes in one room at the same time', async () => {
    expect(await pgCode(link(classB, room1, '2026-11-20', '2026-11-25'))).toBe('23P01');
  });

  test('allows a move on the day the previous link ends (end date is exclusive)', async () => {
    expect(await pgCode(link(classA, room2, '2026-12-01', null))).toBeNull();
    expect(await pgCode(link(classB, room1, '2026-12-01', null))).toBeNull();
  });
});

describe('audit_logs', () => {
  test('is append-only', async () => {
    await client.query(`INSERT INTO audit_logs (action, entity, entity_id) VALUES ('test.write', 'test', '1')`);
    expect(await pgCode(client.query(`UPDATE audit_logs SET action = 'x'`))).toBe('P0001');
    expect(await pgCode(client.query(`DELETE FROM audit_logs`))).toBe('P0001');
  });
});

describe('seed', () => {
  const tables = [
    'users',
    'terms',
    'rounds',
    'score_components',
    'areas',
    'physical_rooms',
    'classes',
    'class_aliases',
    'class_room_links',
    'term_classes',
    'students',
  ];
  const counts = async () => {
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = (await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
    return out;
  };

  test('is idempotent and creates the documented data', async () => {
    const before = await counts();
    const { db, close } = createDb(url);
    try {
      await seed(db);
      const once = await counts();
      await seed(db);
      expect(await counts()).toEqual(once);

      const added = Object.fromEntries(tables.map((t) => [t, once[t]! - before[t]!]));
      expect(added).toMatchObject({
        users: 6,
        terms: 1,
        rounds: 3,
        score_components: 2,
        areas: 8 + 25,
        physical_rooms: 96,
        classes: 77,
        class_room_links: 77,
        term_classes: 77,
        students: 200,
      });
    } finally {
      await close();
    }
  });

  test('never seeds มุตะวัซซิต classes', async () => {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM classes WHERE grade_label LIKE 'มุตะวัซซิต%'`);
    expect(rows[0].n).toBe(0);
  });
});

describe('worker heartbeat (T02)', () => {
  test('is written and read back through app_settings, last write wins', async () => {
    const { db, close } = createDb(url);
    try {
      expect(await readWorkerHeartbeat(db)).toBeNull();
      await writeWorkerHeartbeat(db, new Date('2026-11-16T01:00:00Z'), 1);
      await writeWorkerHeartbeat(db, new Date('2026-11-16T01:00:30Z'), 1);
      expect((await readWorkerHeartbeat(db))?.toISOString()).toBe('2026-11-16T01:00:30.000Z');
    } finally {
      await close();
    }
  });
});

describe('service conventions (T03)', () => {
  test('writeAudit inside withTransaction commits together with the change', async () => {
    const { db, close } = createDb(url);
    try {
      await withTransaction(db, async (tx) => {
        await writeAudit(tx, { actorId: null, action: 'test.commit', entity: 'test', entityId: 'c1', after: { v: 1 } });
      });
      const { rows } = await client.query(`SELECT actor_id, after FROM audit_logs WHERE action = 'test.commit'`);
      expect(rows).toEqual([{ actor_id: null, after: { v: 1 } }]);
    } finally {
      await close();
    }
  });

  test('an AppError thrown in the transaction rolls back the audit row', async () => {
    const { db, close } = createDb(url);
    try {
      await expect(
        withTransaction(db, async (tx) => {
          await writeAudit(tx, { actorId: null, action: 'test.rollback', entity: 'test', entityId: 'r1' });
          throw new AppError('CONFLICT');
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'test.rollback'`);
      expect(rows[0].n).toBe(0);
    } finally {
      await close();
    }
  });
});
