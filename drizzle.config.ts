import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://zw:zw@localhost:5432/zw' },
  strict: true,
  verbose: true,
});
