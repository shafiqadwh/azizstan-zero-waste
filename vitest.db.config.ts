import { defineConfig } from 'vitest/config';

/** Database tests (`*.db.test.ts` / db/db.test.ts). Need DATABASE_URL; run with `pnpm test:db`. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['db/db.test.ts', 'src/**/*.db.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
