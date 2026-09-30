import { expect, test } from 'vitest';
import {
  bangkokDateString,
  formatStampDateTime,
  formatThaiDate,
  formatThaiDateTime,
  formatThaiTime,
  formatTermLabel,
} from './index.ts';

test('formats the BR-T1 example in Bangkok time with a Buddhist-era year', () => {
  // 09:30 UTC = 16:30 in Bangkok (UTC+7)
  expect(formatThaiDateTime(new Date('2026-11-15T09:30:00Z'))).toBe('15 พ.ย. 2569 16:30 น.');
});

test('uses the Bangkok calendar day, not the UTC one', () => {
  // 18:00 UTC on 14 Nov is already 01:00 on 15 Nov in Bangkok
  expect(formatThaiDate(new Date('2026-11-14T18:00:00Z'))).toBe('15 พ.ย. 2569');
  expect(bangkokDateString(new Date('2026-11-14T18:00:00Z'))).toBe('2026-11-15');
  // 16:59 UTC is still the same day in Bangkok (23:59)
  expect(bangkokDateString(new Date('2026-11-14T16:59:00Z'))).toBe('2026-11-14');
});

test('rolls the Buddhist year at Bangkok midnight on 1 January', () => {
  expect(formatThaiDateTime(new Date('2026-12-31T17:00:00Z'))).toBe('1 ม.ค. 2570 00:00 น.');
});

test('pads hours and minutes; midnight is 00:00', () => {
  expect(formatThaiTime(new Date('2027-01-18T01:05:00Z'))).toBe('08:05 น.');
  expect(formatThaiTime(new Date('2027-01-17T17:00:00Z'))).toBe('00:00 น.');
});

test('photo stamp format dd/MM/yyyy HH:mm (BR-V1)', () => {
  expect(formatStampDateTime(new Date('2026-11-16T01:07:00Z'))).toBe('16/11/2569 08:07');
});

test('every Thai month abbreviation', () => {
  const months = Array.from({ length: 12 }, (_, m) => formatThaiDate(new Date(Date.UTC(2027, m, 10, 5))).split(' ')[1]);
  expect(months).toEqual([
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
  ]);
});

test('term label', () => {
  expect(formatTermLabel(2, 2569)).toBe('ภาคเรียนที่ 2/2569');
});
