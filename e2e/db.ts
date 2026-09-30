import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

/** Test users are created straight in the database (same argon2id parameters as the app). */
export async function createTestUser(opts: {
  role: 'admin' | 'executive' | 'teacher';
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
