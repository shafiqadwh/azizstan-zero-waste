/**
 * Apply all pending migrations in db/migrations (schema, RAW_SQL constraints, reference data).
 * Usage: DATABASE_URL=… pnpm db:migrate   ·   in the container: node scripts/migrate.js
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.ts';

/** In the Docker image the bundled script lives in /app/scripts, so the image sets MIGRATIONS_DIR=/app/db/migrations. */
export const MIGRATIONS_FOLDER =
  process.env.MIGRATIONS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

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
