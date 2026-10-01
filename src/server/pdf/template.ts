/**
 * The evaluation report (09-pdf §2): A4 portrait, always one page. Pure — takes ready data (images already as
 * data URIs) and returns a complete HTML document, so the worker can print it with page.setContent and the
 * internal route can show the very same markup.
 */

export interface EvaluationPdfData {
  kind: 'class' | 'area';
  termLabel: string; // ภาคเรียนที่ 2/2569
  target: string; // "121 · ม.1 Amanah" or "อาคาร 1"
  place: string | null; // "อาคาร 1 ชั้น 2", or the zone description for an area
  roundNo: number;
  evaluatedAt: string; // "15 พ.ย. 2569 10:20 น."
  ownerName: string;
  approverName: string | null;
  score: string; // "4.5"
  max: string; // "5"
  comment: string;
  sitePhotos: string[]; // data: URIs, at most 5
  signature: string | null; // data: URI; class evaluations only
  docNumber: string; // ZW-2569-2-R1-0007
  version: number;
  generatedAt: string;
  /** FR-D2: watermark "ฉบับร่าง" until the round is finalized */
  draft: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const truncate = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);

export function evaluationHtml(d: EvaluationPdfData, fontCss: string): string {
  const title =
    d.kind === 'class' ? 'แบบรายงานผลการประเมินความสะอาดห้องเรียน' : 'แบบรายงานผลการประเมินความสะอาดอาคาร/โซน';
  const cells = [
    ...d.sitePhotos.slice(0, 5).map((src) => `<figure class="cell"><img class="site" src="${src}" alt=""></figure>`),
    ...(d.kind === 'class' && d.signature
      ? [
          `<figure class="cell sig"><img class="signature" src="${d.signature}" alt=""><figcaption>ใบลงชื่อนักเรียน</figcaption></figure>`,
        ]
      : []),
  ];
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>${esc(d.docNumber)}</title>
<style>
${fontCss}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Sarabun', sans-serif; color: #17201B; font-size: 14pt; line-height: 1.45;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: 210mm; height: 297mm; padding: 15mm; overflow: hidden;
  display: flex; flex-direction: column; gap: 5mm; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm;
  border-bottom: 1.5pt solid #1D6A4E; padding-bottom: 3mm; }
header h1 { font-size: 17pt; font-weight: 700; margin: 0; line-height: 1.3; }
header p { margin: 1mm 0 0; font-size: 11.5pt; color: #3D4641; }
.mark { font-weight: 700; color: #1D6A4E; font-size: 12pt; text-align: right; line-height: 1.2; letter-spacing: .3pt; }
table.info { width: 100%; border-collapse: collapse; font-size: 12.5pt; }
table.info th { text-align: left; font-weight: 600; color: #3D4641; width: 27mm; white-space: nowrap; padding: 1mm 2mm 1mm 0; vertical-align: top; }
table.info td { padding: 1mm 4mm 1mm 0; vertical-align: top; }
.result { display: grid; grid-template-columns: 45mm 1fr; border: 1pt solid #C9CFC8; border-radius: 3mm; overflow: hidden; }
.score { background: #E7F1EC; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4mm; }
.score .label { font-size: 12pt; font-weight: 600; }
.score .value { font-size: 40pt; font-weight: 700; line-height: 1.1; color: #1D6A4E; }
.score .max { font-size: 11.5pt; color: #3D4641; }
.comment { padding: 3mm 5mm; min-height: 44mm; }
.comment h2, .photos h2 { font-size: 12.5pt; font-weight: 600; margin: 0 0 1.5mm; }
.comment p { margin: 0; font-size: 16pt; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.photos { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
.cell { margin: 0; aspect-ratio: 4 / 3; background: #F1F0EB; border-radius: 2mm; overflow: hidden; position: relative; }
.cell img { width: 100%; height: 100%; display: block; }
img.site { object-fit: cover; }
img.signature { object-fit: contain; background: #fff; }
.cell figcaption { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(23,32,27,.75); color: #fff;
  font-size: 10.5pt; text-align: center; padding: .5mm 0; }
.empty { color: #6B746E; font-size: 12pt; }
footer { display: flex; justify-content: space-between; gap: 4mm; border-top: .75pt solid #C9CFC8; padding-top: 2mm;
  font-size: 9pt; color: #3D4641; }
footer span:last-child { white-space: nowrap; }
.watermark { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(-30deg);
  font-size: 96pt; font-weight: 700; color: #17201B; opacity: .08; white-space: nowrap; pointer-events: none; }
</style></head>
<body><div class="page" data-pdf-page>
<header>
  <div><h1>${title}</h1><p>โรงเรียนมูลนิธิอาซิซสถาน · โครงการ AZIZSTAN Zero Waste ${esc(d.termLabel)}</p></div>
  <div class="mark">AZIZSTAN<br>ZERO WASTE</div>
</header>
<table class="info"><tbody>
  <tr><th>${d.kind === 'class' ? 'ห้อง' : 'พื้นที่'}</th><td>${esc(d.target)}</td><th>รอบที่</th><td>${d.roundNo}</td></tr>
  <tr><th>${d.kind === 'class' ? 'อาคาร' : 'รายละเอียด'}</th><td>${esc(truncate(d.place ?? '–', 70))}</td><th>วันที่ประเมิน</th><td>${esc(d.evaluatedAt)}</td></tr>
  <tr><th>ผู้ประเมิน</th><td>${esc(d.ownerName)}</td><th>ผู้อนุมัติ</th><td>${esc(d.approverName ?? '–')}</td></tr>
</tbody></table>
<section class="result">
  <div class="score"><span class="label">คะแนนที่ได้</span><span class="value">${esc(d.score)}</span><span class="max">จากคะแนนเต็ม ${esc(d.max)}</span></div>
  <div class="comment"><h2>คำแนะนำและข้อติชม</h2><p>${esc(truncate(d.comment || '–', 300))}</p></div>
</section>
<section class="photos"><h2>ภาพหลักฐาน</h2>
  ${cells.length ? `<div class="grid">${cells.join('')}</div>` : '<p class="empty">ไม่มีภาพหลักฐาน</p>'}
</section>
<footer>
  <span>เอกสารภายใน ห้ามเผยแพร่ · สร้างจากระบบ AZIZSTAN Zero Waste · ${esc(d.generatedAt)}</span>
  <span>เลขที่เอกสาร ${esc(d.docNumber)} · ฉบับที่ ${d.version}</span>
</footer>
${d.draft ? '<div class="watermark" aria-hidden="true">ฉบับร่าง</div>' : ''}
</div></body></html>`;
}
