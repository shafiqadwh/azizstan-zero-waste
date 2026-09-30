/**
 * Apply all pending migrations in db/migrations (schema, RAW_SQL constraints, reference data).
 * Usage: DATABASE_URL=… pnpm db:migrate
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.ts';

export const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(url?: string) {
  const { db, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => console.log('migrations applied'))
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
