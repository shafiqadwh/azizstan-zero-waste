# 08 — UX/UI Specification

Visual reference: the design canvas "AZIZSTAN Zero Waste UX/UI" (8 artboards: home mobile/desktop, rankings,
my tasks, evaluation form, dashboard, term settings, PDF). This document is the normative version: where the
canvas differs (for example its lighter input borders), follow this document.

## 1. Principles

1. **One screen, one job.** Committee: find target → score → submit, all on one scrolling page. No wizards.
2. **Fewest taps.** Target list opens the form in one tap; QR on the door opens it in zero taps after scanning.
   The most likely action is the biggest button and sits within thumb reach (bottom of the screen on mobile).
3. **Always show where you are.** Every staff screen about a target shows `121 · ม.1 Amanah` (room number +
   class) so nobody scores the wrong room.
4. **Say what is missing, not just "invalid".** Disabled buttons carry the reason next to them.
5. **Calm by default, loud when late.** Neutral surfaces; amber only for "soon/waiting", red only for "late/returned".
6. **Same look on every device.** Mobile-first layouts that widen, not separate designs.
7. **Thai first.** All UI text in Thai; numbers in Arabic digits; dates in Buddhist era.

## 2. Brand and logo

- Logo: the school has **no logo file** (Q9). Until one is provided, use a text wordmark
  "AZIZSTAN Zero Waste" (IBM Plex Sans Thai 700, `brand` colour) in headers, and generate the app icon, favicon and
  notification icons from the letters "ZW" in white on a `brand` square (maskable-safe padding). Keep the logo
  behind one `<Logo>` component so a real file can be swapped in later without touching screens.
- Product and project name everywhere: **AZIZSTAN Zero Waste** (short form "Zero Waste" only where space is too small, e.g. the PWA icon label); subtitle **ภาคเรียนที่ 2/2569**. The old names "โครงการลดขยะ" and "Aziz Clean Zone" are not used anywhere.
- The logo's saturated colours are for the logo only; the UI uses the calmer tokens below so status colours
  stay meaningful.

## 3. Design tokens

### 3.1 Colour (all text pairs ≥ 4.5:1, verified)
| Token | Hex | Use | Contrast |
|---|---|---|---|
| `bg` | `#F5F4EF` | page background (warm off-white) | – |
| `surface` | `#FFFFFF` | cards, sheets | – |
| `surface-muted` | `#F0EEE8` | neutral pill, table header | – |
| `ink` | `#17201B` | primary text | 16.7:1 on surface |
| `ink-muted` | `#56615A` | secondary text | 6.5:1 surface · 5.9:1 bg |
| `line` | `#E3E1D9` | card borders, dividers (decorative) | – |
| `line-strong` | `#7D847F` | input borders, unselected control outlines | 3.8:1 (non-text ≥ 3:1) |
| `brand` | `#1D6A4E` | primary buttons, selected state, progress | white on it 6.5:1 |
| `brand-ink` | `#134A36` | text on `brand-soft` | 8.8:1 |
| `brand-soft` | `#E7F1EC` | selected chips, rank 2–3 badges | – |
| `warn-ink` / `warn-soft` | `#6B3A00` / `#FDF3E1` | waiting, deadline soon | 8.6:1 |
| `danger-ink` / `danger-soft` | `#8F1B12` / `#FDECEA` | late, returned, destructive | 7.9:1 |
| `danger` | `#B42318` | destructive button fill, unread dot | white 6.6:1 |

Dark mode: not in phase 1 (outdoor daytime use); tokens are CSS variables so it can be added.

### 3.2 Typography — IBM Plex Sans Thai (UI), Sarabun (PDF only)
| Token | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 34 / 40 | 700 | big numbers (progress, score) |
| `score` | 52 / 56 | 700 | score value in the form |
| `h1` | 20–26 / 1.3 | 700 | page title (20 mobile, 26 desktop) |
| `h2` | 17–18 / 1.35 | 700 | card titles |
| `body` | 15–16 / 1.5 | 400–500 | default (16 for inputs to stop iOS zoom) |
| `label` | 14 / 1.4 | 500–600 | buttons, chips |
| `caption` | 13 / 1.4 | 400 | hints, meta |
Never below 13 px. Thai needs generous line-height: body ≥ 1.5.

### 3.3 Space, radius, elevation
- Spacing scale (px): 4, 8, 12, 16, 20, 24, 32, 40. Mobile page gutter 20; desktop 40–48.
- Radius: controls 12, cards 18–20, pills 999, photos 14.
- Elevation: none by default (borders instead); only sheets/menus get `0 8px 24px rgba(23,32,27,.12)`.
- Touch targets ≥ 44 × 44; primary mobile buttons 56 high.

### 3.4 Breakpoints
`sm` 360–639 (phone, single column) · `md` 640–1023 (tablet, 2 columns) · `lg` ≥ 1024 (sidebar layout) ·
`xl` ≥ 1280 (4-column grade grid on public home).

### 3.5 Icons
lucide-react, 1.75–2 px stroke, 20–26 px. Icon-only buttons need `aria-label`.

## 4. Core components (visual spec)

### 4.1 Buttons
| Variant | Style | Use |
|---|---|---|
| Primary | `brand` fill, white 15–17/700, radius 12–16, h 44 (desktop) / 56 (mobile bottom bar) | one per screen |
| Secondary | white, 1 px `line-strong`, ink text | cancel, return, secondary actions |
| Ghost | no border, `brand` text | "ดูทั้งหมด", links |
| Destructive | `danger` fill | delete, reject (always with confirm sheet) |
Disabled: `surface-muted` fill, `ink-muted` text, plus the reason in a caption beside/below it.

### 4.2 Segmented control
Track `#E9E7DF`, radius 14, padding 4; selected segment white with 1 px shadow, 600 weight. Used for
ห้องเรียน/อาคาร and รอบที่ n/สะสมทั้งเทอม. Keyboard: arrow keys move selection (`role="tablist"`).

### 4.3 Chips
Height 40, radius 20, 1 px `line-strong`; selected = `brand-soft` fill, `brand` border, `brand-ink` 600.

### 4.4 Status pills (icon + text, never colour alone)
| Status | Icon | Label | Colours |
|---|---|---|---|
| not evaluated | ○ circle | ยังไม่ประเมิน | `surface-muted` / `#3D4641` |
| submitted | clock | รออนุมัติ | `warn-soft` / `warn-ink` |
| returned | undo arrow | ส่งกลับให้แก้ | `danger-soft` / `danger-ink` |
| approved | check | อนุมัติแล้ว | `brand-soft` / `brand-ink` |
| late | alert triangle | เลยกำหนด | `danger-soft` / `danger-ink` |
| request waiting | clock | รอพิจารณาคำขอ | `warn-soft` / `warn-ink` |

### 4.5 Target header (committee form)
Full-width `brand` card, radius 20: left square 60 × 60 with the room number (22/700), right: class display
(20/700) and `อาคาร 1 ชั้น 2 · รอบที่ 1` (14, 86 % white). This is the "am I in the right room" check.

### 4.6 Score input
Label row: "คะแนนห้อง" + "เต็ม 5 · ทีละ 0.5" (or "จำนวนเต็ม"). Row: − (56 round, outline) · value (52/700,
"–" when empty) · + (56 round, brand). Chips 0…max below (6-column grid when max = 5). Long-press ± repeats.

### 4.7 Photo grid
3 columns, square cells, radius 14. Filled cell: thumbnail + remove button (28 round, dark 70 %) bottom-right.
Add cell: dashed 2 px `brand`, `brand-soft`-tinted, camera icon + "ถ่ายรูป". Counter at the card title right:
"2 / 5 · ต้องอีก 1 รูป" (warn-ink when below min, ink-muted when ok). Uploading cell: progress ring.

### 4.8 Rank row
Badge 32 round: rank 1 = `brand` fill + white; 2–3 = `brand-soft` + `brand-ink`; others = no fill, ink-muted.
Name 15/600, room number caption, score right-aligned 17/700 + "/15" caption.

### 4.9 KPI tile (dashboard)
Label caption, value `display`, optional "/ total" and a 6 px progress bar. Status tiles (waiting, late) use the
soft background + icon + label. Max 4 per row.

## 5. Layout patterns

- **Mobile app shell (committee)**: top bar (avatar initial, name, bell with unread dot), content, fixed bottom bar
  only on the form. No hamburger menus for committee — they only need tasks and inbox.
- **Public mobile**: header (logo, name, "เข้าสู่ระบบ" pill), status card, full-width primary tile "จัดอันดับ",
  2-column tile grid, list row for guide, footer with school name.
- **Desktop admin**: 256 px sidebar (logo, nav, sync status card at bottom), content max 1180 px, page header with
  title + subtitle + actions on the right.

## 6. Screen specifications

Each screen lists: purpose · content (top→bottom) · interactions · states.

### 6.1 Public home `/`
Purpose: anyone sees progress and reaches rankings in one tap.
Content: header · round status card (dot + "รอบที่ 1 เปิดลงคะแนน", "ถึง {date}", big "46 จาก 79 ห้องประเมินแล้ว",
progress bar) · primary tile "จัดอันดับ — อันดับ 1–3 ของทุกชั้นเรียน" · tiles: ห้องเรียน, {อาคาร|โซน}, กราฟพัฒนาการ,
คำสั่งแต่งตั้ง · row "วิธีการใช้งานเบื้องต้น" · footer.
Desktop: top nav with the same items, status strip with round/term toggle, and the top-3 of all 8 rank groups in a
4-column grid directly on the home page (no extra click).
States: no active term → "ยังไม่เปิดภาคเรียนใหม่" + last term's results link; round scheduled → "รอบที่ n เริ่ม {date}";
all rounds finalized → "สรุปผลภาคเรียน" with term ranking.

### 6.2 Rankings `/rankings`
Controls: segmented ห้องเรียน/อาคาร; chips per round + "สะสมทั้งเทอม" (default = term-to-date).
Classes: one card per rank group (ม.1…ม.6, ปวช., มุตะวัซซิต, ซานาวี) with top 3 and "ดูทั้งหมด {n} ห้อง" expanding in place.
Areas: one full list. Ties show the same badge number. Unscored rows: "รอผล".
Empty: "ยังไม่มีคะแนนที่อนุมัติ" with the round's close date.

### 6.3 Class scores `/classes`
Two selects side by side: ชั้น (ม.1…, ปวช., มุตะวัซซิต, ซานาวี) and ห้อง (filtered). Result card: `121 · ม.1 Amanah`,
table rounds × (คะแนนห้อง, คะแนน{อาคาร/โซน}, รวม), term average row, small sparkline linking to /charts.
No student names anywhere.

### 6.4 Areas `/areas`
List of zones/buildings: name, description (zones, 1 line), per-round chips, term total. Tap → detail with the
classes responsible for that area.

### 6.5 Charts `/charts`
Picker (ห้องเรียน/โซน/อาคาร → item). Line chart of totals per round of the current term (x: "รอบที่ 1…"), y from 0 to
term max, points labelled on hover/tap, table view toggle for accessibility. One series per chart.

### 6.6 Login and PWA install
Login card: logo, "เข้าสู่ระบบ", ชื่อผู้ใช้, รหัสผ่าน (show/hide), primary "เข้าสู่ระบบ", note "ใช้บัญชีเดียวกับระบบ
ของโรงเรียน". After first login on mobile: sheet "ติดตั้งแอปเพื่อรับการแจ้งเตือน" — Android: install button; iOS: 3
illustrated steps (แตะปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม → เปิดจากไอคอน) + "ไว้ทีหลัง".

### 6.7 My tasks `/tasks`
Content: top bar · deadline banner (amber: "รอบที่ 1 · เหลือเวลาลงคะแนน 3 วัน"; red after close: "เลยกำหนดแล้ว ·
ต้องขออนุมัติก่อนใส่คะแนน") · search field (numeric keyboard, "เลขห้อง เช่น 121") + QR button · status tabs
"ต้องทำ n · รออนุมัติ n · เสร็จ n" · list of target rows (title `TargetBadge`, subtitle building/floor or area
name, status pill, chevron). Order: returned first, then not evaluated (by room number), then others.
Tap a row: not evaluated → form; others → detail.
Empty (no duties): illustration-free message "คุณยังไม่ได้รับมอบหมายให้ประเมินในเทอมนี้".
All done: "ครบทุกรายการแล้ว ขอบคุณครับ/ค่ะ" with a check icon (no emoji anywhere in the UI).

### 6.8 Evaluation form `/evaluate/new`
Content: back + "ประเมินห้องเรียน" · target header (§4.5) · card คะแนน (§4.6) · card รูปสถานที่ (§4.7) with hint
"ถ่ายจากกล้องเท่านั้น ระบบประทับวันเวลาลงรูปอัตโนมัติ" · card ใบลงชื่อนักเรียน (one dashed tile "ถ่ายรูปใบลงชื่อ
1 รูป" + link "พิมพ์ใบลงชื่อของห้องนี้") · card คำแนะนำและข้อติชม (textarea, counter 0/300) · fixed bottom bar:
primary "บันทึกและส่งให้ Admin อนุมัติ" + caption "แก้ไขเองได้ภายใน 24 ชั่วโมงหลังบันทึก".
Validation messages (inline, under each card): §9.
Leaving with unsaved changes → confirm sheet "ยังไม่ได้ส่ง ต้องการออกหรือไม่ (ร่างจะถูกเก็บไว้ในเครื่อง)".
Area evaluation: same form **without the signature card**; header shows area name and "{n} ห้องรับผิดชอบ".

### 6.9 Evaluation detail `/evaluate/[id]`
Read view of score, photos (tap → full screen swipe viewer), comment, status timeline (ส่ง → ส่งกลับ → อนุมัติ, with
names and times). Owner within window: "แก้ไข" / "ลบ" + countdown. Otherwise: "ขออนุมัติแก้ไข" opening a bottom sheet
with request type radio list (แก้คะแนน, แก้รูป, แก้ข้อติชม, ย้ายไปห้องที่ถูกต้อง, ลบผลประเมิน), the new value input
for that type, reason (required) and "ส่งคำขอ". Approved: "ดู PDF".

### 6.10 Dashboard `/admin`
Header: "ภาพรวม" + "ภาคเรียนที่ 2/2569 · รอบที่ 1 · ปิดรับคะแนน {date}" + actions "แจ้งเตือนกรรมการที่ค้าง",
"ปิดรอบ" (disabled with reason "ปุ่มปิดรอบจะกดได้เมื่อทุกห้องและทุกอาคารมีคะแนนครบ"). KPI row: ห้องที่มีคะแนนแล้ว
46/79 · อาคารที่มีคะแนนแล้ว 5/8 · รออนุมัติ 6 (ผล 5 · คำขอ 1) · เลยกำหนด 3. Two columns: "ยังไม่มีคะแนน" table
(target, committee, status; late first) and "รออนุมัติ" cards (§6.11 compact). Sidebar card: last sync status.
Executive: same page, all action buttons hidden, banner "โหมดดูอย่างเดียว".

### 6.11 Approvals `/admin/approvals`
Tabs ผลประเมิน / คำขอ. Result card: target, owner, submitted time, score big, 6 thumbnails (signature last with
document icon), comment excerpt, buttons "อนุมัติและออก PDF" (primary) and "ส่งกลับ" (secondary → sheet with reason).
Keyboard on desktop: J/K next/prev, A approve, R return. Request card: type pill, requester, target, old → new
(strikethrough old, bold new), reason, "อนุมัติการแก้ไข" / "ปฏิเสธ"; late_entry adds a duration select
(12/24/48/72 ชม., default 24).

### 6.12 Evaluation mode, scoring and rounds `/admin/settings/mode` · `/admin/settings/scoring`
Cards: รูปแบบคะแนน (radio cards จำนวนเต็ม / ทศนิยม; step select 0.5/0.25/0.1 when decimal; note on rounding) ·
วิธีประเมิน (segmented โซน/อาคาร; เหมารวม/รายคน for room and area) · **คะแนน** (see below) · รอบการประเมิน
(rows with dates, status) · evidence counts and self-edit hours. Locked term: every control disabled + banner
"เทอมนี้มีผลประเมินแล้ว การตั้งค่าถูกล็อก". Save = one primary button; unsaved changes indicator in the header.

**Scoring card "คะแนน" (canvas artboard "ตั้งค่าเทอม · Admin")**
1. **จำนวนรอบต่อภาคเรียน** — number stepper (1–10); changing it adds/removes round rows below.
2. **ส่วนคะแนน** table, one row per component, each with an on/off switch, label, who scores, kind, full marks:
   | Row | Default 2/2569 |
   |---|---|
   | คะแนนห้องเรียน · กรรมการ · ให้คะแนน | on · 5 |
   | คะแนนอาคาร (or โซน, follows the mode) · กรรมการ · ให้คะแนน | on · 10 |
   | คะแนนจากครูผู้รับผิดชอบโซน/อาคาร · ครู · ให้คะแนน or หักคะแนน | **off** · e.g. 5 (kept, greyed, "ไม่ใช้ในเทอมนี้") |
   "+ เพิ่มส่วนคะแนน" adds a custom row.
3. **คะแนนเต็มต่อรอบ** — live sum of enabled score rows ("รวมต่อรอบ 15 คะแนน").
4. **ใช้คะแนนเต็มเท่ากันทุกรอบ** — switch, on by default. Off → a small grid rounds × components to set each round's
   full marks (BR-S4b); the sum per round is shown at the row end.
5. **คะแนนเต็มปลายภาคเรียน** — number; when it differs from the per-round sum, the note
   "คะแนนจะถูกแปลงเป็นเต็ม {n}" appears (BR-TM3).

### 6.13 Committee & coverage `/admin/settings/committee`
Left: user list with duty counts; right: coverage matrix by rank group/area — each target shows assigned
committee names; red "ยังไม่มีผู้ประเมิน" and amber "มีผู้ประเมินซ้ำ". Actions: assign (combobox search by name),
remove, "มอบหมายชั่วคราว (Freelance)" with expiry, "นำเข้าจาก Excel" (download template → upload → dry-run
report → ยืนยันนำเข้า).

### 6.14 Classes `/admin/settings/classes` (rooms §6.21, zones §6.22)
Areas (type, code, name, description) · Rooms (building, number, floor, current class, QR download) ·
Classes (track, grade, name, aliases, current room with "ย้ายห้อง" action that asks for the effective date).

### 6.15 Students `/admin/settings/students`
Sync runs table (time, source, status, counts); review list showing **student codes and class strings only** with
action "จับคู่กับห้อง…" (creates an alias); retention notice. No names.

### 6.16 PDF (09-pdf)
Matches the A4 artboard: formal, black on white, Sarabun, school crest left, project logo right.

### 6.17 Monitor board `/monitor`
Purpose: one place to see the state of every target in a round, from "not scored" to "PDF ready".

**Who sees what (scope is enforced on the server, not only hidden in the UI)**

| User | Scope |
|---|---|
| super admin, admin, executive | every class and area of the term |
| same users when they also hold committee duty | still everything; plus a toggle "เฉพาะที่ฉันรับผิดชอบ" (default off) |
| committee member with no admin/executive role (e.g. teacher) | only the classes/zones/buildings assigned to them |
| anyone else | no access (link hidden, server returns 403) |

Committee members reach it from the bottom nav item "ติดตามสถานะ" on mobile; admins/executives from the sidebar.

**Layout (desktop, canvas artboard "ติดตามสถานะ · Admin")**: page header (title, "อัปเดตอัตโนมัติทุก 30 วินาที",
round select, "ส่งออก Excel") → 6 status counters (tap = filter) → filter bar (ชั้นเรียน · อาคาร/โซน · กรรมการ ·
ช่องค้นหาห้อง · ผังห้อง/ตาราง toggle) → body: room map on the left, "ความเคลื่อนไหวล่าสุด" feed (300 px) on the right.
Filters live in the URL; "ล้างตัวกรอง" appears when any is set.

**Room map view**: one section per rank group (ม.1 … ซานาวี), then the areas section. Each target is a 70 px tile
(6 per row on desktop, 3 on mobile): room number (15/700), class name (13), status by fill **and** icon:
dashed outline + ○ = ยังไม่ประเมิน; red 2 px border + ⚠ + "เลยกำหนด"; amber + clock + score = รออนุมัติ;
red soft + undo = ส่งกลับให้แก้; solid brand green + ✓ + score = อนุมัติแล้ว (PDF ready); a small PDF badge marks
"กำลังสร้าง PDF" / "PDF ล้มเหลว". Section subtitle summarises counts ("อนุมัติ 5 · รออนุมัติ 2 · …").
**Table view**: the columns listed below, sortable, for printing/exporting.
Mobile: counters scroll horizontally, filters collapse into a "ตัวกรอง" sheet, the feed moves to its own tab.

Header: round selector + counters that double as filters (tap to filter; counts respect the user's scope):

| Counter | Meaning |
|---|---|
| ยังไม่ประเมิน {n} | no live evaluation (red "เลยกำหนด" badge after close) |
| รออนุมัติ {n} | status submitted |
| ส่งกลับให้แก้ {n} | status returned |
| อนุมัติแล้ว {n} | approved |
| กำลังสร้าง PDF {n} | approved, `pdf_status = queued` |
| PDF ล้มเหลว {n} | `pdf_status = failed` — row shows the error and a "สร้างใหม่" button (admin) |
| มีคำขอค้าง {n} | target has a waiting request |

Table (desktop) / cards (mobile), one row per target and component: `TargetBadge` · component (ห้อง/อาคาร/โซน) ·
committee assigned · owner + submitted time · status pill · PDF (link / queued / failed) · waiting request pill.
Filters: status, rank group (ม.1…), area, committee member; search by room number. Export visible rows to Excel.
Row tap → evaluation detail (§6.9) with the full timeline. Executive: same view, no action buttons.

**Target popover (who is responsible)** — hovering a room/zone/building name (desktop, after 300 ms, also on
keyboard focus) or tapping it (mobile, opens a bottom sheet) shows:
- `121 · ม.1 Amanah` · อาคาร 1 ชั้น 2 (zones: the area description)
- **กรรมการผู้รับผิดชอบ**: every committee member assigned to this target (freelance marked "ชั่วคราว ถึง {date}")
- **ผู้ประเมิน**: owner name + submitted time, or "ยังไม่มีผู้ประเมิน"
- **สถานะ**: status pill; approved → "อนุมัติโดย {name} เมื่อ {time}" + PDF link; returned → reason
- **คำขอ**: waiting request type + requester, if any
- Button "ดูรายละเอียด" → §6.9
The popover is a real `button` trigger with `aria-haspopup="dialog"`; content loads from
`GET /api/v1/monitor/targets/{type}/{id}?round=` (same scope check as the board). Names shown are staff names only;
never student names.

### 6.18 Requests log `/admin/requests`
All requests of the term, newest first. Filters: status (รอพิจารณา · อนุมัติแล้ว · ปฏิเสธ · หมดอายุ · ยกเลิก),
type (ใส่คะแนนเลยกำหนด · แก้คะแนน · แก้รูป · แก้ข้อติชม · ย้ายห้อง · ลบผลประเมิน), requester, round.
Row: type pill · target · requester · reason · old → new (score as numbers; photos as removed/added thumbnails;
comment as a short diff) · status · decided by / at / note. Waiting rows have the approve/reject buttons (admin).

### 6.19 "คำขอของฉัน" (committee, tab on `/tasks`)
The committee member's own requests with status pills (รอพิจารณา / อนุมัติแล้ว / ปฏิเสธ + note), and for approved
late-entry requests a countdown "ใส่คะแนนได้อีก 18 ชม." with a button to open the form.

### 6.20 Settings menu `/admin/settings` (canvas: "ตั้งค่า · ภาพรวมและขั้นตอนเตรียมเทอม")
Main sidebar item "ตั้งค่า" (admin, super admin; executives see it read-only). Second-level menu, grouped:

| Group | Page | What the admin sets |
|---|---|---|
| เริ่มต้นภาคเรียน | ภาคเรียนและการเปิดเทอมใหม่ | new-term wizard (below), activate/close terms, term list with links to history |
| | ข้อมูลนักเรียน (Sync API) | API status (never shows the token), "Sync ตอนนี้", run history, review list (codes only), class-name aliases |
| กติกาการประเมิน | รูปแบบการประเมิน | zone or building; group or individual (room, area); integer or decimal + step (§6.12) |
| | ส่วนคะแนนและรอบ | score components, term max, rounds and dates (§6.12) |
| | หลักฐานและการแก้ไข | photo min/max, signature required, comment max, self-edit hours, late-entry default hours |
| สถานที่ | อาคารและหมายเลขห้อง | buildings, floors, room numbers, which class uses which room from which date, QR print (§6.21) |
| | โซน | zones, area description, buildings/places in the zone, responsible classes, zone committee (§6.22) |
| | ห้องเรียน | class register (track, grade, name, rank group), aliases, current room, activate/deactivate |
| บุคคล | คณะกรรมการ | committee duties and targets, freelance, approvers, Excel import, coverage (§6.13) |
| | ผู้ใช้และสิทธิ์ | users and roles (create/grant only for super admin) |
| อื่นๆ | การแจ้งเตือน | reminder hours before close (default 72, 24), overdue reminder time, push batching window |
| | เอกสาร PDF และคำสั่ง | school name/crest for the PDF header, document number prefix, appointment-order PDFs |
| | หน้าสาธารณะ | show rankings publicly on/off, show live (approved) scores or only finalized rounds, guide pages |
| | การเชื่อมต่อ API | ปพ.5 API keys, allowed networks, student API URL test, teacher-auth status |
| | ข้อมูลและความเป็นส่วนตัว | retention days (students, evidence), last backup time, audit log link |

A settings page never shows a secret value; tokens are replaced (write-only field "เปลี่ยน token").

**Overview page** — header with the active term chip and primary button "เปิดภาคเรียนใหม่"; card
"ขั้นตอนเตรียมภาคเรียน {term}" with a progress bar and 9 ordered steps. Each step: number or check circle, title,
one-line live status ("76 จาก 79 ห้องเรียนผูกแล้ว"), amber flag when something needs action ("ยังไม่ผูก 3 ห้อง"),
and a button to the page that fixes it. Footer: "ตรวจความพร้อมและเปิดรอบที่ 1" enabled only when steps 1–8 pass
(readiness rules BR-TM5). The second-level menu shows the same amber flags so problems are visible from anywhere.

**New-term wizard** (sheet, 4 steps): 1) ปีการศึกษา + ภาคเรียน · 2) copy settings from (latest term preselected) ·
3) what to copy: rules (always), zones and responsible classes (default on), committee duties (default off) ·
4) summary → "สร้างภาคเรียน" (creates a `draft` term; the old term stays active until "เปิดใช้ภาคเรียนนี้").
Copy explains: "ข้อมูลเทอมก่อนไม่ถูกลบ ดูย้อนหลังและเทียบกราฟได้ตลอด".

### 6.21 Buildings and room numbers `/admin/settings/rooms` (canvas: "ตั้งค่า · อาคารและหมายเลขห้อง")
Building chips (with room counts, "+ เพิ่มอาคาร") → selected building card with floors top-down, each floor a
6-column grid of room tiles: number (16/700) + class using it, or amber dashed "ยังไม่ผูกห้องเรียน". Selecting a
tile opens the right panel: room number, floor, building; "ห้องเรียนที่ใช้ห้องนี้" select + "มีผลตั้งแต่วันที่"
(moving a class closes its previous room link on that date, BR/FR-P3); usage history by term; "บันทึก",
"ปิดใช้งานห้อง". Header actions: "นำเข้าจาก Excel" (rooms.xlsx), "พิมพ์ QR ทุกห้อง".

### 6.22 Zones `/admin/settings/zones` (canvas: "ตั้งค่า · โซน")
Info banner when the term uses buildings ("ข้อมูลโซนเก็บไว้ใช้เมื่อเปลี่ยนรูปแบบเป็นโซน"). List of zone cards:
code badge, area description, chips of responsible classes, committee. Edit panel: code, name, description,
"อาคารหรือสถานที่ในโซน" (chips; pick a building or type a place name → `zone_places`), responsible classes for
the term (chips + add), zone committee (chips + add → creates committee duties). Header: "นำเข้าจาก Excel"
(zones.xlsx), "+ เพิ่มโซน".

## 7. States every screen must implement
| State | Pattern |
|---|---|
| Loading | skeletons shaped like the content (no spinners for page loads) |
| Empty | one sentence of what will appear here + the next useful action |
| Error | "เกิดข้อผิดพลาด" + plain reason + "ลองอีกครั้ง"; never a stack trace |
| Offline | top banner "ออฟไลน์ — ข้อมูลจะถูกส่งเมื่อมีสัญญาณ" (committee pages only) |
| Forbidden | "คุณไม่มีสิทธิ์เข้าหน้านี้" + back home |
| Read-only (executive) | banner "โหมดดูอย่างเดียว"; action buttons not rendered |

## 8. Accessibility
- WCAG 2.2 AA: text contrast per §3.1; focus ring 2 px `brand` + 2 px offset on every interactive element.
- Real elements only (`button`, `a`, `label`+`input`); radios/segmented controls expose roles and arrow keys.
- Status = icon + text. Charts have a table view.
- Photos in approval views have alt text "รูปสถานที่ 1 ของห้อง 121".
- Respect `prefers-reduced-motion`: no slide animations; transitions ≤ 150 ms otherwise.

## 9. UI copy (use exactly)

| Key | Thai |
|---|---|
| status.not_evaluated | ยังไม่ประเมิน |
| status.submitted | รออนุมัติ |
| status.returned | ส่งกลับให้แก้ |
| status.approved | อนุมัติแล้ว |
| status.late | เลยกำหนด |
| action.submit | บันทึกและส่งให้ Admin อนุมัติ |
| action.request | ขออนุมัติ |
| action.request_late | ขออนุมัติใส่คะแนน |
| action.request_edit | ขออนุมัติแก้ไข |
| action.approve | อนุมัติและออก PDF |
| action.return | ส่งกลับ |
| action.finalize | ปิดรอบ |
| val.score_required | กรุณาเลือกคะแนน (ถ้าไม่ให้คะแนน ให้เลือก 0) |
| val.score_step | คะแนนต้องเป็นทีละ {step} |
| val.photos_min | ต้องถ่ายรูปอีก {n} รูป |
| val.photos_max | ถ่ายได้สูงสุด {max} รูป |
| val.signature_required | กรุณาถ่ายรูปใบลงชื่อนักเรียน |
| val.comment_max | ข้อติชมยาวเกิน {max} ตัวอักษร |
| val.reason_required | กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร |
| info.self_edit | แก้ไขเองได้อีก {time} |
| info.owner | ประเมินแล้วโดย {name} เมื่อ {time} |
| info.entry_closed | เลยกำหนดใส่คะแนนแล้ว กด "ขออนุมัติใส่คะแนน" |
| info.saved | ส่งแล้ว รออนุมัติ |
| info.offline_queue | จะส่งเมื่อมีสัญญาณ |
| info.readonly | โหมดดูอย่างเดียว |
| empty.tasks | คุณยังไม่ได้รับมอบหมายให้ประเมินในเทอมนี้ |
| empty.rankings | ยังไม่มีคะแนนที่อนุมัติ |
