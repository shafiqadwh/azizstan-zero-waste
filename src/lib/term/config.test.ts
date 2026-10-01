import { describe, expect, test } from 'vitest';
import { parseScore as p } from '../scoring/decimal.ts';
import { termScoreByRound } from '../scoring/index.ts';
import {
  checkRoundDateChange,
  componentsInUse,
  perRoundMax,
  roundMaxima,
  scalingNote,
  scoreStepFor,
} from './config.ts';

const room = { id: 'room', kind: 'score' as const, maxValue: '5.000', enabled: true };
const area = { id: 'area', kind: 'score' as const, maxValue: '10.000', enabled: true };
const teacher = { id: 'teacher', kind: 'score' as const, maxValue: '5.000', enabled: false };
const deduct = { id: 'deduct', kind: 'deduct' as const, maxValue: '3.000', enabled: true };

describe('score format (FR-C4)', () => {
  test('integer means step 1 whatever step is stored; decimal uses the step', () => {
    expect(scoreStepFor({ scoreFormat: 'integer', scoreStep: '0.500' })).toBe(1000);
    expect(scoreStepFor({ scoreFormat: 'decimal', scoreStep: '0.500' })).toBe(500);
    expect(scoreStepFor({ scoreFormat: 'decimal', scoreStep: '0.250' })).toBe(250);
  });
});

describe('components', () => {
  test('a disabled component is filtered out everywhere', () => {
    expect(componentsInUse([room, area, teacher]).map((c) => c.id)).toEqual(['room', 'area']);
    expect(perRoundMax([room, area, teacher])).toBe(p(15)); // teacher score off: not in full marks
  });
  test('deductions do not add to full marks', () => {
    expect(perRoundMax([room, area, deduct])).toBe(p(15));
  });
});

describe('BR-TM3 scaling note', () => {
  test('shown only when the term max differs from the per-round sum', () => {
    expect(scalingNote([room, area], '15.000')).toBeNull();
    expect(scalingNote([room, area], '20.000')).toBe('คะแนนจะถูกแปลงเป็นเต็ม 20');
    expect(scalingNote([room, area], '12.500')).toBe('คะแนนจะถูกแปลงเป็นเต็ม 12.5');
  });
});

describe('BR-S4b per-round full marks', () => {
  test('overrides apply to their round only, and feed termScoreByRound', () => {
    const maxima = roundMaxima(
      ['r1', 'r2'],
      [room, area, teacher],
      [{ roundId: 'r2', componentId: 'area', maxValue: '15.000' }],
    );
    expect(maxima.get('r1')).toBe(p(15));
    expect(maxima.get('r2')).toBe(p(20));
    // 12/15 = 80 %, 10/20 = 50 % → mean 65 % of 15 = 9.75
    const term = termScoreByRound(
      [
        { total: p(12), max: maxima.get('r1')! },
        { total: p(10), max: maxima.get('r2')! },
      ],
      p(15),
    );
    expect(term).toBe(p('9.75'));
  });
});

describe('BR-R5 round dates', () => {
  const d = (s: string) => new Date(s);
  const base = { opensAt: d('2026-11-16T01:00:00Z'), closesAt: d('2026-11-20T09:30:00Z') };
  const now = d('2026-11-18T00:00:00Z');

  test('scheduled: anything goes, as long as close is after open', () => {
    expect(
      checkRoundDateChange(
        { ...base, status: 'scheduled' },
        { opensAt: d('2026-11-10T01:00:00Z'), closesAt: d('2026-11-12T01:00:00Z') },
        now,
      ),
    ).toBeNull();
    expect(
      checkRoundDateChange({ ...base, status: 'scheduled' }, { opensAt: base.closesAt, closesAt: base.opensAt }, now),
    ).toBe('วันปิดรับคะแนนต้องหลังวันเปิด');
  });

  test('open/closed: only extend closes_at, never before now', () => {
    const open = { ...base, status: 'open' as const };
    expect(checkRoundDateChange(open, { ...base, closesAt: d('2026-11-25T09:30:00Z') }, now)).toBeNull();
    expect(checkRoundDateChange(open, { ...base, opensAt: d('2026-11-17T01:00:00Z') }, now)).toBe(
      'รอบนี้เปิดแล้ว แก้ได้เฉพาะวันปิดรับคะแนน',
    );
    expect(checkRoundDateChange(open, { ...base, closesAt: d('2026-11-19T09:30:00Z') }, now)).toBe(
      'ขยายวันปิดรับคะแนนได้ แต่เลื่อนให้เร็วขึ้นไม่ได้',
    );
    const closed = { ...base, status: 'closed' as const };
    expect(
      checkRoundDateChange(closed, { ...base, closesAt: d('2026-11-21T00:00:00Z') }, d('2026-11-22T00:00:00Z')),
    ).toBe('วันปิดรับคะแนนต้องไม่อยู่ในอดีต');
  });

  test('finalized rounds are fixed', () => {
    expect(
      checkRoundDateChange({ ...base, status: 'finalized' }, { ...base, closesAt: d('2026-12-01T00:00:00Z') }, now),
    ).toBe('รอบนี้ปิดรอบแล้ว แก้วันที่ไม่ได้');
  });
});
