import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { RAW_SQL } from './schema.ts';

test('the RAW_SQL migration matches RAW_SQL in db/schema.ts', () => {
  const file = readFileSync(new URL('./migrations/0001_raw_constraints.sql', import.meta.url), 'utf8');
  const body = file
    .split('\n')
    .filter((l) => !l.startsWith('-- RAW_SQL from'))
    .join('\n');
  expect(body.trim()).toBe(RAW_SQL.trim());
});
