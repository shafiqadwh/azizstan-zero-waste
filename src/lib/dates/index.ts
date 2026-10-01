/**
 * Asia/Bangkok date helpers (BR-T1). Rules compare UTC instants; these only format for display and export.
 * Thai UI uses Buddhist-era years (พ.ศ. = ค.ศ. + 543) and abbreviated Thai months: `15 พ.ย. 2569 16:30 น.`
 */

export const TIME_ZONE = 'Asia/Bangkok';
export const BUDDHIST_ERA_OFFSET = 543;

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

export interface BangkokParts {
  year: number; // Gregorian
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
}

/** Calendar fields of an instant as seen in Bangkok. */
export function bangkokParts(date: Date): BangkokParts {
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `15 พ.ย. 2569` */
export function formatThaiDate(date: Date): string {
  const p = bangkokParts(date);
  return `${p.day} ${THAI_MONTHS_SHORT[p.month - 1]} ${p.year + BUDDHIST_ERA_OFFSET}`;
}

/** `16:30 น.` */
export function formatThaiTime(date: Date): string {
  const p = bangkokParts(date);
  return `${pad2(p.hour)}:${pad2(p.minute)} น.`;
}

/** `15 พ.ย. 2569 16:30 น.` — the standard Thai UI timestamp (BR-T1). */
export function formatThaiDateTime(date: Date): string {
  return `${formatThaiDate(date)} ${formatThaiTime(date)}`;
}

/** `15/11/2569 16:30` — the timestamp stamped on evidence photos (BR-V1). */
export function formatStampDateTime(date: Date): string {
  const p = bangkokParts(date);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year + BUDDHIST_ERA_OFFSET} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Bangkok calendar date as ISO `YYYY-MM-DD` (Gregorian), for `date` columns such as class–room effective dates. */
export function bangkokDateString(date: Date): string {
  const p = bangkokParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** `ภาคเรียนที่ 2/2569` */
export function formatTermLabel(termNo: number, academicYear: number): string {
  return `ภาคเรียนที่ ${termNo}/${academicYear}`;
}

/** Date → `<input type="datetime-local">` value in Bangkok wall-clock time, e.g. `2026-11-15T16:30`. */
export function bangkokLocalInput(date: Date): string {
  const p = bangkokParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}
