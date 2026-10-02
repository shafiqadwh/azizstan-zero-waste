/**
 * The evaluation report (09-pdf §2): A4 portrait, one page — plus, in individual mode (T40), pages listing every
 * student's score by code (never names, FR-S1), 100 per page. Pure — takes ready data (images already as
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
  /** individual mode: each student's score by code; `score` is then the class mean. Absent or [] in group mode. */
  students?: { code: string; score: string }[];
}

/** 4 columns × 25 rows of student codes per page. */
export const STUDENTS_PER_PAGE = 100;
const STUDENT_ROWS = 25;

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
  const students = d.students ?? [];
  const studentPages: (typeof students)[] = [];
  for (let i = 0; i < students.length; i += STUDENTS_PER_PAGE)
    studentPages.push(students.slice(i, i + STUDENTS_PER_PAGE));
  const totalPages = 1 + studentPages.length;
  const header = `<header>
  <div><h1>${title}</h1><p>โรงเรียนมูลนิธิอาซิซสถาน · โครงการ AZIZSTAN Zero Waste ${esc(d.termLabel)}</p></div>
  <div class="mark">AZIZSTAN<br>ZERO WASTE</div>
</header>`;
  const footer = (page: number) => `<footer>
  <span>เอกสารภายใน ห้ามเผยแพร่ · สร้างจากระบบ AZIZSTAN Zero Waste · ${esc(d.generatedAt)}</span>
  <span>เลขที่เอกสาร ${esc(d.docNumber)} · ฉบับที่ ${d.version}${totalPages > 1 ? ` · หน้า ${page}/${totalPages}` : ''}</span>
</footer>
${d.draft ? '<div class="watermark" aria-hidden="true">ฉบับร่าง</div>' : ''}`;
  const studentPage = (list: typeof students, i: number) => {
    const columns: (typeof students)[] = [];
    for (let c = 0; c < list.length; c += STUDENT_ROWS) columns.push(list.slice(c, c + STUDENT_ROWS));
    const first = i * STUDENTS_PER_PAGE;
    return `<div class="page" data-pdf-page>
${header}
<p class="students-title"><b>คะแนนรายคน</b> · ${esc(d.target)} · รอบที่ ${d.roundNo} · ${students.length} คน · เฉลี่ยห้อง ${esc(d.score)} จากคะแนนเต็ม ${esc(d.max)}</p>
<div class="students">${columns
      .map(
        (col, c) =>
          `<table class="codes"><thead><tr><th>ที่</th><th>รหัสนักเรียน</th><th>คะแนน</th></tr></thead><tbody>${col
            .map(
              (st, r) =>
                `<tr><td class="n">${first + c * STUDENT_ROWS + r + 1}</td><td>${esc(st.code)}</td><td class="v">${esc(st.score)}</td></tr>`,
            )
            .join('')}</tbody></table>`,
      )
      .join('')}</div>
<p class="students-note">แสดงเฉพาะรหัสนักเรียน ไม่แสดงชื่อ</p>
${footer(i + 2)}
</div>`;
  };
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
  display: flex; flex-direction: column; gap: 5mm; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.students-title { margin: 0; font-size: 13pt; }
.students { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; align-content: start; }
table.codes { width: 100%; border-collapse: collapse; font-size: 12pt; font-variant-numeric: tabular-nums; }
table.codes th { font-size: 10.5pt; font-weight: 600; color: #3D4641; text-align: left; border-bottom: 1pt solid #1D6A4E; padding: .5mm 1mm; }
table.codes td { border-bottom: .5pt solid #C9CFC8; padding: .9mm 1mm; height: 8mm; }
table.codes td.n { color: #6B746E; font-size: 10pt; width: 7mm; }
table.codes td.v, table.codes th:last-child { text-align: right; font-weight: 700; }
.students-note { margin: 0; font-size: 10.5pt; color: #6B746E; }
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
${header}
<table class="info"><tbody>
  <tr><th>${d.kind === 'class' ? 'ห้อง' : 'พื้นที่'}</th><td>${esc(d.target)}</td><th>รอบที่</th><td>${d.roundNo}</td></tr>
  <tr><th>${d.kind === 'class' ? 'อาคาร' : 'รายละเอียด'}</th><td>${esc(truncate(d.place ?? '–', 70))}</td><th>วันที่ประเมิน</th><td>${esc(d.evaluatedAt)}</td></tr>
  <tr><th>ผู้ประเมิน</th><td>${esc(d.ownerName)}</td><th>ผู้อนุมัติ</th><td>${esc(d.approverName ?? '–')}</td></tr>
</tbody></table>
<section class="result">
  <div class="score"><span class="label">${students.length ? 'คะแนนเฉลี่ยห้อง' : 'คะแนนที่ได้'}</span><span class="value">${esc(d.score)}</span><span class="max">จากคะแนนเต็ม ${esc(d.max)}</span></div>
  <div class="comment"><h2>คำแนะนำและข้อติชม</h2><p>${esc(truncate(d.comment || '–', 300))}</p></div>
</section>
<section class="photos"><h2>ภาพหลักฐาน</h2>
  ${cells.length ? `<div class="grid">${cells.join('')}</div>` : '<p class="empty">ไม่มีภาพหลักฐาน</p>'}
</section>
${footer(1)}
</div>${studentPages.map(studentPage).join('')}</body></html>`;
}

export interface SignatureSheetData {
  termLabel: string; // ภาคเรียนที่ 2/2569
  target: string; // "121 · ม.1 Amanah"
  place: string | null; // building / zone of the class in this round
  roundNo: number;
  roundDates: string; // "16–20 พ.ย. 2569"
  generatedAt: string;
}

export const SIGNATURE_ROWS = 40;

/**
 * Blank signature sheet (09-pdf §3): one A4 page, rows 1–40 as two columns of 20 (`ลำดับ | ลงชื่อนักเรียน`), so
 * each line is tall enough to sign. No names are printed: students write their own.
 */
export function signatureSheetHtml(d: SignatureSheetData, fontCss: string): string {
  const half = SIGNATURE_ROWS / 2;
  const column = (from: number) =>
    `<table class="sign"><thead><tr><th class="no">ลำดับ</th><th>ลงชื่อนักเรียน</th></tr></thead><tbody>${Array.from(
      { length: half },
      (_, i) => `<tr><td class="no">${from + i}</td><td></td></tr>`,
    ).join('')}</tbody></table>`;
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>ใบลงชื่อ ${esc(d.target)} รอบที่ ${d.roundNo}</title>
<style>
${fontCss}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Sarabun', sans-serif; color: #17201B; font-size: 13pt; line-height: 1.4;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; padding: 14mm 15mm; overflow: hidden; display: flex; flex-direction: column; gap: 4mm; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm;
  border-bottom: 1.5pt solid #1D6A4E; padding-bottom: 3mm; }
header h1 { font-size: 17pt; font-weight: 700; margin: 0; line-height: 1.3; }
header p { margin: 1mm 0 0; font-size: 11.5pt; color: #3D4641; }
.mark { font-weight: 700; color: #1D6A4E; font-size: 12pt; text-align: right; line-height: 1.2; }
table.info { width: 100%; border-collapse: collapse; font-size: 12.5pt; }
table.info th { text-align: left; font-weight: 600; color: #3D4641; width: 22mm; white-space: nowrap; padding: .5mm 2mm .5mm 0; }
table.info td { padding: .5mm 4mm .5mm 0; }
.columns { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
table.sign { width: 100%; border-collapse: collapse; font-size: 12pt; }
table.sign th { background: #E7F1EC; font-weight: 600; padding: 1mm 2mm; border: .75pt solid #9AA49E; text-align: left; }
table.sign td { border: .75pt solid #9AA49E; height: 10.3mm; padding: 0 2mm; }
.no { width: 14mm; text-align: center !important; color: #3D4641; }
.note { margin: 0; font-size: 13pt; font-weight: 600; text-align: center; }
footer { display: flex; justify-content: space-between; gap: 4mm; border-top: .75pt solid #C9CFC8; padding-top: 2mm;
  font-size: 9pt; color: #3D4641; }
</style></head>
<body><div class="page" data-pdf-page>
<header>
  <div><h1>ใบลงชื่อนักเรียน · การประเมินความสะอาดห้องเรียน</h1><p>โรงเรียนมูลนิธิอาซิซสถาน · โครงการ AZIZSTAN Zero Waste ${esc(d.termLabel)}</p></div>
  <div class="mark">AZIZSTAN<br>ZERO WASTE</div>
</header>
<table class="info"><tbody>
  <tr><th>ห้อง</th><td>${esc(d.target)}</td><th>รอบที่</th><td>${d.roundNo} (${esc(d.roundDates)})</td></tr>
  <tr><th>อาคาร/โซน</th><td colspan="3">${esc(truncate(d.place ?? '–', 80))}</td></tr>
</tbody></table>
<div class="columns">${column(1)}${column(half + 1)}</div>
<p class="note">โปรดถ่ายรูปแผ่นนี้แนบในระบบ</p>
<footer>
  <span>เอกสารภายใน ห้ามเผยแพร่ · สร้างจากระบบ AZIZSTAN Zero Waste · ${esc(d.generatedAt)}</span>
  <span>ใบลงชื่อ รอบที่ ${d.roundNo}</span>
</footer>
</div></body></html>`;
}

export interface RoomQrTile {
  roomNumber: string;
  building: string;
  floor: number | null;
  classLabel: string | null; // class using the room today
  qrSvg: string; // inline <svg> of the URL /r/{qrToken}
}

export const QR_PER_PAGE = 12;

/**
 * T34 QR sheet: A4 portrait, 12 cards per page (3 × 4), one per room — the QR of `/r/{qrToken}`, the room number
 * large, building/floor and the class using it. Cut along the dashed lines and stick on the door.
 */
export function roomQrSheetHtml(
  tiles: RoomQrTile[],
  d: { termLabel: string; generatedAt: string },
  fontCss: string,
): string {
  const pages: RoomQrTile[][] = [];
  for (let i = 0; i < tiles.length; i += QR_PER_PAGE) pages.push(tiles.slice(i, i + QR_PER_PAGE));
  if (pages.length === 0) pages.push([]);
  const card = (t: RoomQrTile) => `<div class="card">
  <div class="qr">${t.qrSvg}</div>
  <div class="no">${esc(t.roomNumber)}</div>
  <div class="where">${esc(t.building)}${t.floor !== null ? ` · ชั้น ${t.floor}` : ''}</div>
  <div class="cls">${esc(t.classLabel ?? '–')}</div>
  <div class="hint">สแกนเพื่อใส่คะแนน · AZIZSTAN ZERO WASTE</div>
</div>`;
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>QR ห้องเรียน</title>
<style>
${fontCss}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Sarabun', sans-serif; color: #17201B; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; padding: 10mm; display: flex; flex-direction: column; gap: 3mm;
  page-break-after: always; break-after: page; overflow: hidden; }
.page:last-child { page-break-after: auto; break-after: auto; }
.head { display: flex; justify-content: space-between; font-size: 9pt; color: #3D4641; }
.grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr)); }
.card { border: .6pt dashed #9AA49E; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 2mm; text-align: center; min-height: 0; overflow: hidden; }
.qr { width: 36mm; height: 36mm; flex: none; }
.qr svg { width: 100%; height: 100%; display: block; }
.no { font-size: 22pt; font-weight: 700; line-height: 1.1; margin-top: 1.5mm; }
.where { font-size: 10pt; color: #3D4641; line-height: 1.3; }
.cls { font-size: 11pt; line-height: 1.3; font-weight: 600; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hint { font-size: 7.5pt; color: #6B746E; margin-top: .5mm; }
</style></head>
<body>${pages
    .map(
      (p, i) => `<div class="page" data-pdf-page>
<div class="head"><span>QR ประจำห้อง · ${esc(d.termLabel)}</span><span>หน้า ${i + 1}/${pages.length} · ${esc(d.generatedAt)}</span></div>
<div class="grid">${p.map(card).join('')}</div>
</div>`,
    )
    .join('')}</body></html>`;
}
