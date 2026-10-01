import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

/** Test users are created straight in the database (same argon2id parameters as the app). */
export async function createTestUser(opts: {
  role: 'super_admin' | 'admin' | 'executive' | 'teacher';
  password: string;
  mustChange?: boolean;
}) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('e2e needs DATABASE_URL (migrated database)');
  const username = `e2e_${opts.role}_${randomBytes(4).toString('hex')}`;
  const passwordHash = await hash(opts.password, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, username, display_name, role, auth_source, password_hash, must_change_password)
       VALUES (gen_random_uuid(), $1, $2, $3, 'local', $4, $5)`,
      [username, `ผู้ทดสอบ ${opts.role}`, opts.role, passwordHash, opts.mustChange ?? false],
    );
  } finally {
    await client.end();
  }
  return username;
}

/** An active term for pages that need one (idempotent; e2e projects run in parallel on one database). */
export async function ensureActiveTerm() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('e2e needs DATABASE_URL (migrated database)');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO terms (id, academic_year, term_no, status, area_type, final_max)
       VALUES (gen_random_uuid(), 2569, 2, 'active', 'building', 15) ON CONFLICT DO NOTHING`,
    );
  } finally {
    await client.end();
  }
}

/** A (year, term) pair not used yet. Parity keeps the two viewport projects (run in parallel) apart. */
export async function freeTermSlot(parity: 0 | 1) {
  const url = process.env.DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ academic_year: number; term_no: number }>(
      'SELECT academic_year, term_no FROM terms',
    );
    const used = new Set(rows.map((r) => `${r.academic_year}/${r.term_no}`));
    for (let year = 2600 + parity; year <= 2700; year += 2) {
      for (const termNo of [1, 2, 3]) if (!used.has(`${year}/${termNo}`)) return { academicYear: year, termNo };
    }
    throw new Error('no free term slot');
  } finally {
    await client.end();
  }
}

/**
 * A draft building-mode term of its own (random high year, retried on conflict) with one new building and one
 * selected class, so coverage assertions never collide with other specs running in parallel.
 */
export async function seedCommitteeFixture() {
  const url = process.env.DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const tag = randomBytes(3).toString('hex').toUpperCase();
  try {
    let termId: string | undefined;
    for (let i = 0; !termId && i < 50; i++) {
      const year = 2650 + Math.floor(Math.random() * 50);
      const termNo = 1 + Math.floor(Math.random() * 3);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO terms (id, academic_year, term_no, status, area_type, final_max)
         VALUES (gen_random_uuid(), $1, $2, 'draft', 'building', 15) ON CONFLICT DO NOTHING RETURNING id`,
        [year, termNo],
      );
      termId = rows[0]?.id;
    }
    if (!termId) throw new Error('no free term slot');
    const building = `อาคาร E2E ${tag}`;
    await client.query(
      `INSERT INTO areas (id, type, code, name, sort_order) VALUES (gen_random_uuid(), 'building', $1, $2, 900)`,
      [`Z${tag}`, building],
    );
    const className = `ม.C C${tag}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO classes (id, track, grade_code, grade_label, rank_group, room_no, name, display_name)
       VALUES (gen_random_uuid(), 'general', 'E2E-C', 'ม.C', 'ม.C', 0, $1, $2) RETURNING id`,
      [`C${tag}`, className],
    );
    await client.query('INSERT INTO term_classes (term_id, class_id) VALUES ($1, $2)', [termId, rows[0]!.id]);
    return { termId, building, className };
  } finally {
    await client.end();
  }
}

/** An open round in the fixture's term (status set directly; round_class_areas left empty → "ไม่มีพื้นที่"). */
export async function seedOpenRound(termId: string) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO rounds (id, term_id, round_no, opens_at, closes_at, status)
       VALUES (gen_random_uuid(), $1, 1, now() - interval '1 day', now() + interval '3 days', 'open') RETURNING id`,
      [termId],
    );
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}
