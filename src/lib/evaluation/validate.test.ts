import { describe, expect, test } from 'vitest';
import { checkContent, type Content, type ContentRules } from './validate.ts';

const rules: ContentRules = {
  max: 5000,
  step: 500,
  photoMin: 3,
  photoMax: 5,
  requiresSignature: true,
  commentMax: 300,
  rosterIds: null,
};
const ok: Content = { score: 4500, studentScores: new Map(), siteCount: 3, hasSignature: true, comment: '' };

describe('checkContent (BR-E1)', () => {
  test('valid content', () => {
    expect(checkContent(ok, rules)).toBeNull();
    expect(checkContent({ ...ok, score: 0 }, rules)).toBeNull(); // T-E1: 0 is a score
  });

  test('score: required, range, step (BR-N2)', () => {
    expect(checkContent({ ...ok, score: null }, rules)).toEqual({
      field: 'score',
      message: 'กรุณาเลือกคะแนน (ถ้าไม่ให้คะแนน ให้เลือก 0)',
    });
    expect(checkContent({ ...ok, score: 5500 }, rules)?.message).toBe('คะแนนต้องอยู่ระหว่าง 0 ถึง 5');
    expect(checkContent({ ...ok, score: 4250 }, rules)?.message).toBe('คะแนนต้องเป็นทีละ 0.5');
    expect(checkContent({ ...ok, score: 4100 }, { ...rules, step: 100 })).toBeNull();
    expect(checkContent({ ...ok, score: 4150 }, { ...rules, step: 100 })?.message).toBe('คะแนนต้องเป็นทีละ 0.1');
  });

  test('photos, signature, comment', () => {
    expect(checkContent({ ...ok, siteCount: 2 }, rules)).toEqual({
      field: 'sitePhotos',
      message: 'ต้องถ่ายรูปอีก 1 รูป',
    });
    expect(checkContent({ ...ok, siteCount: 6 }, rules)?.message).toBe('ถ่ายได้สูงสุด 5 รูป');
    expect(checkContent({ ...ok, hasSignature: false }, rules)).toEqual({
      field: 'signature',
      message: 'กรุณาถ่ายรูปใบลงชื่อนักเรียน',
    });
    expect(checkContent(ok, { ...rules, requiresSignature: false })?.field).toBe('signature');
    expect(checkContent({ ...ok, hasSignature: false }, { ...rules, requiresSignature: false })).toBeNull();
    expect(checkContent({ ...ok, comment: 'ก'.repeat(301) }, rules)?.message).toBe('ข้อติชมยาวเกิน 300 ตัวอักษร');
    expect(checkContent({ ...ok, comment: 'ก'.repeat(300) }, rules)).toBeNull();
  });

  test('individual mode: every snapshot student needs a valid score', () => {
    const ind = { ...rules, rosterIds: ['s1', 's2'] };
    const scores = (m: [string, number | null][]) => ({ ...ok, score: null, studentScores: new Map(m) });
    expect(
      checkContent(
        scores([
          ['s1', 4000],
          ['s2', 0],
        ]),
        ind,
      ),
    ).toBeNull();
    expect(checkContent(scores([['s1', 4000]]), ind)?.message).toBe('ยังไม่ได้ให้คะแนนนักเรียนอีก 1 คน');
    expect(
      checkContent(
        scores([
          ['s1', 4000],
          ['s2', 4250],
        ]),
        ind,
      )?.message,
    ).toBe('คะแนนต้องเป็นทีละ 0.5');
    expect(
      checkContent(
        scores([
          ['s1', 4000],
          ['s2', 0],
          ['x', 0],
        ]),
        ind,
      )?.message,
    ).toBe('มีนักเรียนที่ไม่อยู่ในห้องนี้ในรอบนี้');
  });
});
