import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { sarabunCss } from '../src/server/pdf/fonts';
import { evaluationHtml, type EvaluationPdfData } from '../src/server/pdf/template';

/** 09-pdf §2 / T22 AC: always one A4 page for 0–5 photos and a 300-character comment, Thai text in Sarabun. */
const img = async (color: string, w = 1600, h = 1200) =>
  `data:image/webp;base64,${(
    await sharp({ create: { width: w, height: h, channels: 3, background: color } })
      .webp()
      .toBuffer()
  ).toString('base64')}`;

const base = (overrides: Partial<EvaluationPdfData>): EvaluationPdfData => ({
  kind: 'class',
  termLabel: 'ภาคเรียนที่ 2/2569',
  target: '121 · ม.1 Amanah',
  place: 'อาคาร 1 ชั้น 2',
  roundNo: 1,
  evaluatedAt: '15 พ.ย. 2569 10:20 น.',
  ownerName: 'ครูกามัล สุไลมาน',
  approverName: 'ผู้ดูแลระบบ',
  score: '4.5',
  max: '5',
  comment: 'ห้องเรียนสะอาด จัดโต๊ะเรียบร้อย ขยะคัดแยกถูกต้อง '.repeat(10).slice(0, 300),
  sitePhotos: [],
  signature: null,
  docNumber: 'ZW-2569-2-R1-0007',
  version: 1,
  generatedAt: '15 พ.ย. 2569 11:00 น.',
  draft: true,
  ...overrides,
});

test.describe('evaluation PDF layout', () => {
  test('one page for 0–5 photos with a 300-char comment; Sarabun embedded; nothing cut off', async ({ page }, info) => {
    test.skip(info.project.name.includes('mobile'), 'printed once, on the desktop project');
    const css = await sarabunCss();
    const photos = await Promise.all(['#4a7', '#7a4', '#47a', '#a47', '#aa4'].map((c) => img(c)));
    const signature = await img('#ffffff', 1200, 1600);
    const cases: EvaluationPdfData[] = [
      ...[0, 1, 2, 3, 4, 5].map((n) => base({ sitePhotos: photos.slice(0, n), signature })),
      base({
        kind: 'area',
        target: 'โซน A',
        place: 'ประตูใหญ่ ลานจอดรถ และทางเดินหน้าอาคาร 1 '.repeat(5),
        sitePhotos: photos,
      }),
      base({ draft: false, sitePhotos: photos, signature }),
    ];
    for (const data of cases) {
      await page.setContent(evaluationHtml(data, css), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // every block stays inside the A4 page (the page clips, so overflow would silently lose content)
      const fit = await page.evaluate(() => {
        const pageBox = document.querySelector('[data-pdf-page]')!.getBoundingClientRect();
        const footer = document.querySelector('footer')!.getBoundingClientRect();
        return {
          pageBottom: pageBox.bottom,
          footerBottom: footer.bottom,
          sarabun: document.fonts.check('16px Sarabun', 'ห้อง'),
        };
      });
      expect(fit.footerBottom).toBeLessThanOrEqual(fit.pageBottom);
      expect(fit.sarabun).toBe(true);
      const pdf = (await page.pdf({ printBackground: true, preferCSSPageSize: true })).toString('latin1');
      expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);
      expect(pdf).toContain('Sarabun');
      expect(pdf.length).toBeLessThan(1.5 * 1024 * 1024);
    }
  });
});
