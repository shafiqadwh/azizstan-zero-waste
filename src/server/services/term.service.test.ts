import { describe, expect, test } from 'vitest';
import { parseInput } from '../errors.ts';
import { DEFAULT_COMPONENTS, scoringInput } from './term.service.ts';

const input = {
  termId: '019a0000-0000-7000-8000-000000000001',
  equalMax: true,
  components: DEFAULT_COMPONENTS.map((c) => ({ ...c })),
};

describe('term score validation', () => {
  test.each(['1x', '1.2345', '1e2', '999999999999999999999', '', '-1', '0', '1000'])(
    'rejects %s with a field error instead of a parser or database exception',
    (value) => {
      for (const [raw, field] of [
        [{ ...input, finalMax: value }, 'finalMax'],
        [{ ...input, components: [{ ...input.components[0], maxValue: value }] }, 'components.0.maxValue'],
        [{ ...input, roundMax: [{ roundNo: 1, key: 'room', maxValue: value }] }, 'roundMax.0.maxValue'],
      ] as const) {
        expect(() => parseInput(scoringInput, raw)).toThrowError(
          expect.objectContaining({ code: 'VALIDATION', field }),
        );
      }
    },
  );

  test.each(['0.001', '15', '999.999'])('accepts database-representable full marks %s', (value) => {
    expect(scoringInput.safeParse({ ...input, finalMax: value }).success).toBe(true);
  });
});
