import { describe, expect, it } from 'vitest';
import { classDraftFrom } from './classKey.ts';

describe('classDraftFrom (BR-Y step 4b)', () => {
  it('general: grade, room and name from "ม.1/1 Amanah", spacing tolerated', () => {
    expect(classDraftFrom('ม .1/1  Amanah')).toEqual({
      track: 'general',
      gradeCode: 'M1',
      gradeLabel: 'ม.1',
      rankGroup: 'ม.1',
      roomNo: 1,
      name: 'Amanah',
      displayName: 'ม.1 Amanah',
    });
  });
  it('known misspellings become the register name', () => {
    expect(classDraftFrom('ม.1/6 Iklas')?.name).toBe('Ikhlas');
    expect(classDraftFrom('ม.4/5 Al-khawarizmi')?.name).toBe('Al-Khawarizmi');
    expect(classDraftFrom('ม.4/7 Biruni')?.displayName).toBe('ม.4 Al-Biruni');
  });
  it('vocational "ปวช.2/1"', () => {
    expect(classDraftFrom('ปวช. 2 / 1')).toMatchObject({
      track: 'vocational',
      gradeCode: 'VOC2',
      rankGroup: 'ปวช.',
      roomNo: 1,
      name: 'ปวช.2/1',
      displayName: 'ปวช.2/1',
    });
  });
  it('religious, unknown grades and anything else are never created', () => {
    for (const s of ['PR 1/1 Amanah', 'อก.1/3 Cergas', '2S Muslim', 'ม.7/1 X', 'ปวช.4/1', '', null, 'ห้องสมุด'])
      expect(classDraftFrom(s)).toBeNull();
  });
});
