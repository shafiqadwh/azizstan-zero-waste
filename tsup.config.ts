import { defineConfig, type Options } from 'tsup';

/**
 * Bundles the processes that run outside Next.js into self-contained ESM files for the Docker image:
 *   dist/worker/index.js   → /app/worker/index.js   (node worker/index.js)
 *   dist/scripts/migrate.js → /app/scripts/migrate.js (node scripts/migrate.js)
 *   dist/scripts/create-super-admin.js → /app/scripts/create-super-admin.js
 *   dist/scripts/preflight.js → /app/scripts/preflight.js (go-live checks, 14-deployment)
 */
const shared: Options = {
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  noExternal: [/^(?!@node-rs\/argon2|sharp|playwright-core)/],
  // Native addons: resolved at runtime from /app/node_modules (Next standalone output traces it for the app).
  external: ['pg-native', '@node-rs/argon2', 'sharp', 'playwright-core'],
  // Bundled CommonJS dependencies (pg) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  sourcemap: true,
  clean: true,
};

export default defineConfig([
  { ...shared, entry: { index: 'worker/index.ts' }, outDir: 'dist/worker' },
  {
    ...shared,
    entry: {
      migrate: 'db/migrate.ts',
      'create-super-admin': 'scripts/create-super-admin.ts',
      preflight: 'scripts/preflight.ts',
    },
    outDir: 'dist/scripts',
  },
]);
