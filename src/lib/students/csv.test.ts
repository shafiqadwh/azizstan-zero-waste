import { describe, expect, test } from 'vitest';
import { parseCsvRecords, parseStudentCsv } from './csv';

const HEADER =
  'รหัสนักเรียน,ชื่อ-สกุลนักเรียน,ชั้นสามัญ,ชั้นศาสนา,เพศ,เลขประจำตัวประชาชน,วันเดือนปีเกิด,จังหวัด,ชื่อ-สกุลผู้ปกครอง,เบอร์ติดต่อผู้ปกครอง,ชื่อ-สกุลผู้ประสานงาน';

describe('RFC 4180 records', () => {
  test('quotes, escaped quotes, CRLF and a BOM', () => {
    expect(parseCsvRecords('﻿a,"b,c","d ""e"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('T-Y1: the messy student file', () => {
  const csv = [
    HEADER,
    // (a) line break inside the province field
    '65001,ด.ช.ทดสอบ หนึ่ง,ม.1/1 Amanah,PR 1/1 Amanah,ชาย,1234567890123,01/01/2555,ปัตตา',
    'นี,ผู้ปกครองหนึ่ง,0811111111,ผู้ประสานงาน',
    // (b) unquoted comma between two phone numbers
    '65002,ด.ญ.ทดสอบ สอง,ม.1/2 Berdikari,,หญิง,2234567890123,02/02/2555,ยะลา,ผู้ปกครองสอง,0812222222,0813333333,ผู้ประสานงาน',
    // (c) empty cells everywhere except code, name and class
    '65003,ด.ช.ทดสอบ สาม,,อก.1/3 Cergas,,,,,,,',
    // text instead of a phone
    '65004,ด.ญ.ทดสอบ สี่,ปวช.2/1,,หญิง,4234567890123,,นราธิวาส,ผู้ปกครองสี่,ไม่มีเบอร์,ผู้ประสานงาน',
    // hopeless: too few columns and no continuation
    '65005,ด.ช.ทดสอบ ห้า',
  ].join('\n');

  test('every student is parsed with the right code and classes; the broken row is reported by code', () => {
    const out = parseStudentCsv(csv);
    expect(out.students).toEqual([
      { code: '65001', fullName: 'ด.ช.ทดสอบ หนึ่ง', general: 'ม.1/1 Amanah', religious: 'PR 1/1 Amanah' },
      { code: '65002', fullName: 'ด.ญ.ทดสอบ สอง', general: 'ม.1/2 Berdikari', religious: '' },
      { code: '65003', fullName: 'ด.ช.ทดสอบ สาม', general: '', religious: 'อก.1/3 Cergas' },
      { code: '65004', fullName: 'ด.ญ.ทดสอบ สี่', general: 'ปวช.2/1', religious: '' },
    ]);
    expect(out.malformed).toEqual(['65005']);
    expect(out.rows).toBe(5);
  });

  test('nothing beyond the 4 imported columns survives parsing (no national ID)', () => {
    expect(JSON.stringify(parseStudentCsv(csv))).not.toMatch(/\d{13}/);
  });
});
