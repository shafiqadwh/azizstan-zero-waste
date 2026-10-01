import { describe, expect, test } from 'vitest';
import { calendarMonths, foldIcsLine, roundsIcs, spanDays, type CalendarRound } from './index.ts';

const rounds: CalendarRound[] = [
  // 16 Nov 08:00 → 20 Nov 16:30 Bangkok
  { roundNo: 1, status: 'finalized', opensAt: '2026-11-16T01:00:00Z', closesAt: '2026-11-20T09:30:00Z' },
  // 28 Nov 08:00 → 2 Dec 16:30 Bangkok (crosses a month)
  { roundNo: 2, status: 'open', opensAt: '2026-11-28T01:00:00Z', closesAt: '2026-12-02T09:30:00Z' },
];

describe('calendarMonths', () => {
  const months = calendarMonths(rounds, new Date('2026-11-29T03:00:00Z'));
  const days = months.flatMap((m) => m.weeks.flat()).filter((d) => d !== null);
  const on = (date: string) => days.find((d) => d.date === date)!;

  test('covers the months from the first opening to the last closing, Sunday-first weeks', () => {
    expect(months.map((m) => [m.key, m.label])).toEqual([
      ['2026-11', 'พฤศจิกายน 2569'],
      ['2026-12', 'ธันวาคม 2569'],
    ]);
    // 1 Nov 2026 is a Sunday: no padding; 1 Dec 2026 is a Tuesday: two empty cells
    expect(months[0]!.weeks[0]![0]!.date).toBe('2026-11-01');
    expect(months[1]!.weeks[0]!.slice(0, 3).map((d) => d?.day ?? null)).toEqual([null, null, 1]);
    for (const m of months) for (const w of m.weeks) expect(w).toHaveLength(7);
  });

  test('days carry the rounds taking scores, the opening and closing days, and today (Bangkok dates)', () => {
    expect(on('2026-11-15').rounds).toEqual([]);
    expect(on('2026-11-16')).toMatchObject({ rounds: [1], opens: [1], closes: [] });
    expect(on('2026-11-20')).toMatchObject({ rounds: [1], closes: [1] });
    expect(on('2026-11-29')).toMatchObject({ rounds: [2], today: true });
    expect(on('2026-12-02')).toMatchObject({ rounds: [2], closes: [2] });
    expect(on('2026-12-03').rounds).toEqual([]);
    expect(calendarMonths([], new Date())).toEqual([]);
    expect(spanDays(rounds[0]!.opensAt, rounds[0]!.closesAt)).toBe(5);
  });
});

describe('roundsIcs', () => {
  const ics = roundsIcs({ id: 't1', termNo: 2, academicYear: 2569 }, rounds, {
    url: 'https://zerowaste.azizstan.net/calendar',
    now: new Date('2026-10-01T00:00:00Z'),
  });

  test('one VEVENT per round in UTC with a 24 h reminder before the close; CRLF line ends', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART:20261116T010000Z\r\nDTEND:20261120T093000Z');
    expect(ics).toContain('UID:round-2-t1@azizstan-zero-waste');
    expect(ics).toContain('TRIGGER;RELATED=END:-PT24H');
    expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:ZERO WASTE รอบที่ 1 เปิดลงคะแนน (ภาคเรียนที่ 2/2569)');
  });

  test('every physical line is at most 75 octets and folding never splits a Thai character', () => {
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const long = `SUMMARY:${'ก'.repeat(60)}`;
    const folded = foldIcsLine(long);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(folded).not.toContain('\uFFFD');
  });
});
