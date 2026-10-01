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
