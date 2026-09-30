import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'db/**/*.test.ts', 'worker/**/*.test.ts'],
    exclude: ['db/db.test.ts', '**/*.db.test.ts', '**/node_modules/**'],
    environment: 'node',
  },
});
