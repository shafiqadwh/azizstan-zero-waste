import { describe, expect, test } from 'vitest';
import { evaluationHtml, STUDENTS_PER_PAGE, type EvaluationPdfData } from './template.ts';

const base: EvaluationPdfData = {
  kind: 'class',
  termLabel: 'ภาคเรียนที่ 2/2569',
  target: '121 · ม.1 Amanah',
  place: 'อาคาร 1 ชั้น 2',
  roundNo: 1,
  evaluatedAt: '15 พ.ย. 2569 10:20 น.',
  ownerName: 'ครูทดสอบ',
  approverName: null,
  score: '4.5',
  max: '5',
  comment: '',
  sitePhotos: [],
  signature: null,
  docNumber: 'ZW-2569-2-R1-0001',
  version: 1,
  generatedAt: '15 พ.ย. 2569 10:30 น.',
  draft: false,
};
const pages = (html: string) => html.split('data-pdf-page').length - 1;

describe('evaluation PDF (09-pdf §2, T40)', () => {
  test('group mode stays one page with "คะแนนที่ได้"', () => {
    const html = evaluationHtml(base, '');
    expect(pages(html)).toBe(1);
    expect(html).toContain('คะแนนที่ได้');
    expect(html).not.toContain('หน้า 1/');
  });

  test('individual mode: page 1 shows the class mean, then 100 student codes per page', () => {
    const students = Array.from({ length: 130 }, (_, i) => ({ code: `6${String(i).padStart(4, '0')}`, score: '4' }));
    const html = evaluationHtml({ ...base, score: '3.75', students }, '');
    expect(STUDENTS_PER_PAGE).toBe(100);
    expect(pages(html)).toBe(3);
    expect(html).toContain('คะแนนเฉลี่ยห้อง');
    expect(html).toContain('หน้า 1/3');
    expect(html).toContain('หน้า 3/3');
    expect(html).toContain('<td class="n">130</td><td>60129</td>');
    expect(html).toContain('แสดงเฉพาะรหัสนักเรียน ไม่แสดงชื่อ');
  });

  test('T41 deduction: own title, "คะแนนที่หัก −n", reason heading', () => {
    const html = evaluationHtml({ ...base, deduction: true, score: '2', comment: 'ขยะล้นถัง' }, '');
    expect(html).toContain('แบบบันทึกการหักคะแนนความสะอาด');
    expect(html).toContain('คะแนนที่หัก');
    expect(html).toContain('−2');
    expect(html).toContain('หักได้สูงสุด 5');
    expect(html).toContain('เหตุผลที่หักคะแนน');
    expect(pages(html)).toBe(1);
  });

  test('escapes codes', () => {
    const html = evaluationHtml({ ...base, students: [{ code: '<b>', score: '1' }] }, '');
    expect(html).toContain('&lt;b&gt;');
  });
});
