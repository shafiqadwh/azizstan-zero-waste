/**
 * Scoring calendar (FR-W6, T31): month grids and an iCalendar file generated from the term's round dates.
 * Pure: takes ISO instants, works in Bangkok calendar days, no I/O.
 */
import { bangkokDateString, BUDDHIST_ERA_OFFSET } from '../dates/index.ts';

export interface CalendarRound {
  roundNo: number;
  status: 'scheduled' | 'open' | 'closed' | 'finalized';
  opensAt: string; // ISO instant
  closesAt: string;
}

export interface CalendarDay {
  date: string; // YYYY-MM-DD (Bangkok)
  day: number;
  /** rounds taking scores on this day (any part of it) */
  rounds: number[];
  opens: number[]; // rounds opening this day
  closes: number[]; // rounds closing this day
  today: boolean;
}

export interface CalendarMonth {
  key: string; // YYYY-MM
  label: string; // "พฤศจิกายน 2569"
  /** weeks Sunday → Saturday; null pads the first and last week */
  weeks: (CalendarDay | null)[][];
}

export const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;
export const THAI_WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'] as const;

const dateParts = (d: string) => d.split('-').map(Number) as [number, number, number];
const utcDay = (d: string) => {
  const [y, m, day] = dateParts(d);
  return Date.UTC(y, m - 1, day);
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Every month from the first round's opening to the last round's closing, with the rounds marked per day. */
export function calendarMonths(rounds: CalendarRound[], now: Date): CalendarMonth[] {
  if (rounds.length === 0) return [];
  const spans = rounds.map((r) => ({
    roundNo: r.roundNo,
    from: bangkokDateString(new Date(r.opensAt)),
    to: bangkokDateString(new Date(r.closesAt)),
  }));
  const first = spans.reduce((a, s) => (s.from < a ? s.from : a), spans[0]!.from);
  const last = spans.reduce((a, s) => (s.to > a ? s.to : a), spans[0]!.to);
  const today = bangkokDateString(now);
  const months: CalendarMonth[] = [];
  let [y, m] = dateParts(first);
  const [ly, lm] = dateParts(last);
  while (y < ly || (y === ly && m <= lm)) {
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const cells: (CalendarDay | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) {
      const date = iso(Date.UTC(y, m - 1, d));
      cells.push({
        date,
        day: d,
        rounds: spans.filter((s) => s.from <= date && date <= s.to).map((s) => s.roundNo),
        opens: spans.filter((s) => s.from === date).map((s) => s.roundNo),
        closes: spans.filter((s) => s.to === date).map((s) => s.roundNo),
        today: date === today,
      });
    }
    while (cells.length % 7) cells.push(null);
    const weeks: (CalendarDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    months.push({
      key: `${y}-${String(m).padStart(2, '0')}`,
      label: `${THAI_MONTHS[m - 1]} ${y + BUDDHIST_ERA_OFFSET}`,
      weeks,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/** Whole days between two Bangkok dates (inclusive count of days a round takes scores). */
export function spanDays(opensAt: string, closesAt: string): number {
  const from = bangkokDateString(new Date(opensAt));
  const to = bangkokDateString(new Date(closesAt));
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000) + 1;
}

// ───────────── iCalendar (RFC 5545) ─────────────

const icsTime = (isoInstant: string) =>
  new Date(isoInstant)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const icsText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 §3.1: lines longer than 75 octets continue on the next line after CRLF + space (never split a char). */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function roundsIcs(
  term: { id: string; termNo: number; academicYear: number },
  rounds: CalendarRound[],
  opts: { url: string; now: Date },
): string {
  const label = `${term.termNo}/${term.academicYear}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AZIZSTAN ZERO WASTE//Scoring calendar//TH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`AZIZSTAN ZERO WASTE ภาคเรียนที่ ${label}`)}`,
    'X-WR-TIMEZONE:Asia/Bangkok',
    ...rounds.flatMap((r) => [
      'BEGIN:VEVENT',
      `UID:round-${r.roundNo}-${term.id}@azizstan-zero-waste`,
      `DTSTAMP:${icsTime(opts.now.toISOString())}`,
      `DTSTART:${icsTime(r.opensAt)}`,
      `DTEND:${icsTime(r.closesAt)}`,
      `SUMMARY:${icsText(`ZERO WASTE รอบที่ ${r.roundNo} เปิดลงคะแนน (ภาคเรียนที่ ${label})`)}`,
      `DESCRIPTION:${icsText(`กรรมการใส่คะแนนได้จนถึงเวลาปิดรับคะแนนของรอบที่ ${r.roundNo}`)}`,
      `URL:${opts.url}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER;RELATED=END:-PT24H',
      `DESCRIPTION:${icsText(`อีก 24 ชั่วโมงปิดรับคะแนนรอบที่ ${r.roundNo}`)}`,
      'END:VALARM',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
