import { describe, expect, test } from 'vitest';
import { parseCsvRecords } from '../students/csv';
import { csvCell, toCsv } from './write';

describe('CSV writer', () => {
  test('quotes only when needed, empty for null, formula guard', () => {
    expect(csvCell('ม.1 Amanah')).toBe('ม.1 Amanah');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(13)).toBe('13');
    expect(csvCell(true)).toBe('true');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1.50')).toBe('-1.50');
  });

  test('BOM, CRLF, and it reads back with the RFC 4180 parser', () => {
    const text = toCsv([
      ['code', 'class'],
      ['65001', 'ม.1/1 Amanah'],
      ['65002', 'line\nbreak, comma'],
    ]);
    expect(text.startsWith('﻿code,class\r\n')).toBe(true);
    expect(parseCsvRecords(text)).toEqual([
      ['code', 'class'],
      ['65001', 'ม.1/1 Amanah'],
      ['65002', 'line\nbreak, comma'],
    ]);
  });
});
