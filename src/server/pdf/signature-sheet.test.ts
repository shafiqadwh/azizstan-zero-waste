import { describe, expect, test } from 'vitest';
import { SIGNATURE_ROWS, signatureSheetHtml } from './template.ts';

const data = {
  termLabel: 'ภาคเรียนที่ 2/2569',
  target: '121 · ม.1 <Amanah>',
  place: 'อาคาร 1',
  roundNo: 2,
  roundDates: '14 ธ.ค. 2569 – 18 ธ.ค. 2569',
  generatedAt: '1 ต.ค. 2569 10:00 น.',
};

describe('signature sheet template (09-pdf §3)', () => {
  test('40 numbered lines in two columns, the footer note, escaped text, no student names', () => {
    const html = signatureSheetHtml(data, '');
    expect(SIGNATURE_ROWS).toBe(40);
    const numbers = [...html.matchAll(/<td class="no">(\d+)<\/td>/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(html.match(/<table class="sign">/g)).toHaveLength(2);
    expect(html).toContain('<th class="no">ลำดับ</th><th>ลงชื่อนักเรียน</th>');
    expect(html).toContain('โปรดถ่ายรูปแผ่นนี้แนบในระบบ');
    expect(html).toContain('121 · ม.1 &lt;Amanah&gt;');
    expect(html).toContain('รอบที่</th><td>2 (14 ธ.ค. 2569 – 18 ธ.ค. 2569)');
    expect(html).toContain('@page { size: A4; margin: 0; }');
  });
});
