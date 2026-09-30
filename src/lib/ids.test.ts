import { expect, test } from 'vitest';
import { newId } from './ids.ts';

test('newId is a UUID v7 with the RFC 9562 variant', () => {
  expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('newId sorts by creation time', () => {
  const a = newId(1_700_000_000_000);
  const b = newId(1_700_000_000_001);
  expect(a < b).toBe(true);
});
