# 09 — PDF Documents

## 1. Pipeline

```
approveEvaluation ──► enqueue job pdf.render {evaluationId, version}
worker: ─► sign token (HMAC, 5 min) ─► Playwright chromium.newPage()
        ─► goto http://app:3000/internal/pdf/evaluation/{id}?v={version}&t={token}
        ─► wait for fonts (document.fonts.ready) and all <img> loaded
        ─► page.pdf({ format: 'A4', printBackground: true, margin: 0, preferCSSPageSize: true })
        ─► write DATA_DIR/pdf/{yyyy}/{docNumber}-v{n}.pdf ─► insert pdf_documents, supersede previous
```
- One Chromium instance kept alive in the worker; concurrency 1; job timeout 60 s; 3 retries with backoff.
- `evaluations.pdf_status`: set `queued` when the job is enqueued, `ready` on success, `failed` (+ `pdf_error`)
  after the last retry. The monitor board (08-ux-ui §6.17) shows these and lets an admin re-enqueue.
- The internal route is excluded from middleware auth but requires a valid token and is blocked for
  requests not coming from the Docker network (check `x-forwarded-for` absent and remote address private).

## 2. Layout (A4 portrait, 210 × 297 mm, one page always)

```
┌──────────────────────────────────────────────── 15 mm margins ─┐
│ [ตราโรงเรียน]  แบบรายงานผลการประเมินความสะอาดห้องเรียน   [โลโก้] │  header, 1.5 pt rule under
│                โรงเรียนมูลนิธิอาซิซสถาน · โครงการ AZIZSTAN Zero Waste ภาคเรียนที่ 2/2569 │
├────────────────────────────────────────────────────────────────┤
│ ห้อง       121 · ม.1 Amanah         รอบที่        1               │  info table 2×3
│ อาคาร      อาคาร 1 ชั้น 2           วันที่ประเมิน  15 พ.ย. 2569 10:20 น.│
│ ผู้ประเมิน  {displayName}            ผู้อนุมัติ     {displayName}     │
├──────────────┬─────────────────────────────────────────────────┤
│  คะแนนที่ได้   │ คำแนะนำและข้อติชม                                  │
│     4.5      │ {comment, max 300 chars, 16 pt, line-height 1.6}  │
│ จากคะแนนเต็ม 5 │                                                 │
├──────────────┴─────────────────────────────────────────────────┤
│ ภาพหลักฐาน                                                       │
│ [site 1] [site 2] [site 3]                                      │  3 × 2 grid, 4:3 cells,
│ [site 4] [site 5] [ใบลงชื่อนักเรียน]                                │  object-fit: cover (site),
│                                                                  │  contain (signature)
├────────────────────────────────────────────────────────────────┤
│ เอกสารภายใน ห้ามเผยแพร่ · สร้างจากระบบ AZIZSTAN Zero Waste · {generatedAt}   เลขที่เอกสาร ZW-2569-2-R1-0007 · ฉบับที่ 1 │
└────────────────────────────────────────────────────────────────┘
          watermark "ฉบับร่าง" 96 pt, 8 % opacity, −30°, while round not finalized (FR-D2)
```
- Fewer than 5 site photos: empty cells are omitted and the grid reflows; the signature is always last.
- Area evaluation PDF: no signature cell (grid shows up to 5 site photos); same layout otherwise, title "แบบรายงานผลการประเมินความสะอาดอาคาร/โซน", info row "พื้นที่"
  instead of "ห้อง", plus zone description (1 line, truncated with "…").
- Deduction (T41): title "แบบบันทึกการหักคะแนนความสะอาด", score box "คะแนนที่หัก −n / หักได้สูงสุด {max}",
  "ผู้บันทึก" instead of "ผู้ประเมิน", comment heading "เหตุผลที่หักคะแนน", no signature cell.
- Individual mode (T40): page 1 as above, the score box reads "คะแนนเฉลี่ยห้อง" with the class mean; then one page
  per 100 students (4 columns × 25 rows: ที่ · รหัสนักเรียน · คะแนน), header repeated, title line "คะแนนรายคน ·
  {target} · รอบที่ n · {N} คน · เฉลี่ยห้อง …", note "แสดงเฉพาะรหัสนักเรียน ไม่แสดงชื่อ" (**codes only, no names**),
  footer adds "หน้า k/N". Group mode stays exactly one page.
- Fonts: Sarabun 400/600/700 bundled in the image (`/app/fonts`), `@font-face` local files only.
- Images: pass the 1600 px WebP; the PDF stays < 1.5 MB.

## 3. Blank signature sheet (P2)
Route `GET /api/v1/pdf/signature-sheet?classId=&roundId=` (T30; `&format=html` returns the printable page):
header as above, room + class + round with its dates, building/zone from the round's frozen mapping, table with
40 numbered rows × columns `ลำดับ | ลงชื่อนักเรียน` (two columns of 20 so each line is tall enough to sign),
note "โปรดถ่ายรูปแผ่นนี้แนบในระบบ". No student names are printed. Generated on demand in the web process
(`src/server/pdf/on-demand.ts`: one Chromium, started on first use, closed after a minute idle), not stored.
Staff, or a committee member with a duty on the class in that term. Linked from the evaluation form's
"ใบลงชื่อนักเรียน" card and the monitor popover.

## 4. Room QR sheet (P2, T34)
Route `GET /api/v1/pdf/room-qr[?buildingId=|roomId=]` (`&format=html` for the printable page); admins
(`place.manage`). A4 portrait, **12 cards per page** (3 × 4, dashed cut lines), active rooms ordered by building,
floor and number. Each card: QR of the door URL `{APP_URL}/r/{qrToken}` (error correction M), the room number
large, building and floor, the class using the room today (or "–"), and "สแกนเพื่อใส่คะแนน". Rendered on demand like
the signature sheet (`src/server/pdf/on-demand.ts`), not stored. Linked from `/admin/settings/classes`:
"พิมพ์ QR ทุกห้อง", "พิมพ์ QR อาคารนี้", and "QR" on each room.
