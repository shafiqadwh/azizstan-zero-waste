import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'dist/**', 'next-env.d.ts', 'test-results/**', 'playwright-report/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
];

export default config;
