# 01 — Product Requirements (decisions of 30 Sep 2026 / 30 ก.ย. 2569)

Each requirement has an ID. Tickets, tests and code comments reference these IDs.
"MUST" is mandatory for phase 1 unless marked (P2)/(P3).

## 1. Context

- School: โรงเรียนมูลนิธิอาซิซสถาน. Project and system name: **AZIZSTAN Zero Waste** (used everywhere in UI, PDF, notifications and code).
- Replaces a Google Sites + Google Forms + Looker Studio setup ("AZIZSTAN Zero Waste 3.0").
- Scale (term 1/2569): ~79 classes (ม.1–ม.6, ปวช. 1–3, religious-track classes), 25 zones (A–Y), ~150 staff.
- This term (2/2569): **buildings**, **group mode**, **executives are the only committee**, 3 rounds,
  room score max 5 + building score max 10 = 15.
- Next terms: rules can change completely (zones, individual mode, teachers as committee, deductions).

## 2. Users and permissions

| ID | Requirement |
|---|---|
| FR-U1 | Roles: `super_admin`, `admin`, `executive`, `teacher`. Anonymous visitors use the public site. |
| FR-U2 | `super_admin`: everything. **Only the super admin creates users and sets each user's role** (admin, executive or teacher; also super admin). |
| FR-U3 | `admin`: everything **except** creating users and setting roles. The admin decides which existing users are committee members (and for which targets). Includes term settings, score format, zone/building mode, duties and targets, round dates, approvals of results and requests. |
| FR-U4 | `executive`: read everything (all results, evidence, dashboards, reports). Cannot change anything unless given a duty. |
| FR-U5 | `teacher`: has an account only in terms where they hold a duty; otherwise the account is disabled (history kept). |
| FR-U6 | Duties are per term and independent of role: `committee`, `area_teacher` (P3), `approver`. Any role can hold `committee`. |
| FR-U7 | A committee member may score a target only if assigned to it (or temporarily assigned as "freelance" by an admin). |
| FR-U8 | Teacher login uses the existing school system's credentials via an API (spec pending, see open questions). The system must not store teacher passwords from that system. Local accounts (argon2id) exist for super admin/admin/executive and as fallback. |
| FR-U9 | Admin can bulk-import users' duties and target assignments from an Excel template (P2 for users, P1 for duties). |

## 3. Term configuration (all per term, copied from the previous term)

| ID | Requirement |
|---|---|
| FR-C1 | Area type: `zone` or `building`. |
| FR-C2 | Room mode and area mode: `group` or `individual` each. |
| FR-C3 | Score components: list of {unit room/area, source committee/area_teacher, kind score/deduct, max}. |
| FR-C4 | Score format: `integer` or `decimal`; when decimal, input step (0.5, 0.25, 0.1). Chosen by admin. |
| FR-C5 | Term maximum (e.g. 15). If it differs from the sum of score components' max, scale proportionally. |
| FR-C6 | Number of rounds and each round's open/close dates (Asia/Bangkok). |
| FR-C7 | Evidence: site photos min/max (default 3/5), signature sheet photo exactly 1 (required). |
| FR-C8 | Self-edit window in hours (default 24). |
| FR-C9 | A new term starts as a copy of the previous term's configuration. Configuration is locked once the term has any evaluation. |
| FR-C11 | Scoring settings (admin): number of rounds; full marks of the room score and of the building/zone score; an optional zone/building-teacher score (or deduction) with its own full marks that can be switched off (off in 2/2569); term maximum; optionally different full marks per round ("ใช้คะแนนเต็มเท่ากันทุกรอบ" on by default). |
| FR-C10 | One "ตั้งค่า" menu for admins groups every setting: new term wizard, student sync, evaluation mode, score components and rounds, evidence rules, buildings and room numbers (with class-to-room mapping), zones (description, buildings/places inside, responsible classes, committee), classes, committee duties, users, notifications, PDF and appointment orders, public-site visibility, API connections, retention. Its overview shows a readiness checklist for the term (BR-TM5). |

## 4. Places

| ID | Requirement |
|---|---|
| FR-P1 | Class register: track (`general`, `religious`, `vocational`), grade, room number (sort only), name, aliases. Display: `ม.1 Amanah` (no "/1"); vocational keeps `ปวช.2/1`. Religious classes are created manually by admin. |
| FR-P2 | Physical rooms: number (e.g. 121) under a building. Created once, reused every year. |
| FR-P3 | Class ↔ physical room link with effective dates. One class ↔ one room at a time and vice versa (no sharing). Mid-year moves happen for some classes. |
| FR-P4 | Zones: code (A–Y), description of the area, responsible classes (per term), responsible teachers (per term, P3), zone head (P3). |
| FR-P5 | Everywhere a class is shown to staff it appears as `121 · ม.1 Amanah`. Committee can find a target by room number, by grade+name, or by QR code on the door (P2). |
| FR-P6 | Admin sees a coverage report: every class and every area has at least one committee member; no duplicates. |

## 5. Evaluation

| ID | Requirement |
|---|---|
| FR-E1 | One evaluation per (round, target, score component). The first committee member to save it becomes its owner. Other committee members of the same target see who scored it and when, and cannot create, edit or delete it. |
| FR-E2 | Required fields: score (0 must be entered explicitly; empty ≠ 0), site photos within min/max, signature-sheet photo **only for class (room) evaluations — building/zone evaluations have no signature** (per component flag `requires_signature`), comment (optional, ≤ 300 chars). |
| FR-E3 | Photos may be taken with the device camera or picked from the gallery (all photo kinds, incl. the signature sheet), because committees sometimes evaluate without internet (Q7); server stamps date/time; EXIF location stripped. |
| FR-E4 | The owner can edit or delete their evaluation within the self-edit window (24 h after first submit) while it is not approved. |
| FR-E5 | After the window, or for anyone other than the owner, changes require a **request** approved by an admin. |
| FR-E6 | Request types: `late_entry`, `edit_score`, `edit_photos`, `edit_comment`, `move_target` (scored the wrong room), `delete`. The requester states a reason and attaches the new values; approval applies them automatically. |
| FR-E7 | After the round's close time, no new evaluation can be created without an approved `late_entry` request. Approval opens entry for that user and target for a duration the admin chooses (default 24 h). |
| FR-E8 | Every evaluation goes to `submitted`; an admin (approver of that target, else any admin) approves or returns it with a reason. |
| FR-E9 | Approval locks the evaluation and generates the PDF. Changing an approved evaluation (via request) creates a new PDF version; old versions kept. |
| FR-E10 | Every change is written to the audit log (who, what, when, old value, new value). |
| FR-E11 | When both committee and teacher scores exist for the same room in a future term, the committee score is primary (see open question Q2 for exact rule). |
| FR-E12 | (P3) Area teachers may deduct points: max per round, reason required, same lock rules. |

## 6. Rounds and scores

| ID | Requirement |
|---|---|
| FR-R1 | Round states: `scheduled` → `open` → `closed` (entry deadline passed) → `finalized`. |
| FR-R2 | A round can be finalized only when every target has an approved evaluation for every applicable component. |
| FR-R3 | At round open, a roster snapshot freezes each class's students. Finalization freezes round results and ranks. |
| FR-R4 | Round total per class = sum of its applicable components (room components from the class's own evaluation; area components from the area the class belonged to in that round), deductions subtracted, each component floored at 0. |
| FR-R5 | Term score = mean of the class's round totals over rounds that have a total, then scaled (FR-C5). Rounds weigh equally. |
| FR-R6 | Individual mode: each student has their own room score; the class's room score for ranking is the mean over its snapshot students. |
| FR-R7 | Store full precision; display and export rounded half-up to 2 decimals. |
| FR-R8 | Rankings: per grade (all classes of a grade, including vocational as its own group and religious classes in two groups by level: มุตะวัซซิต and ซานาวี — Q13) and per area. Two views: per round and term-to-date. Ties share a rank (1, 1, 3). Only approved scores count. |
| FR-R9 | A student who moves class keeps round scores earned in the old class; later rounds come from the new class (applies when student-level data is used). |
| FR-R10 | Home class for a student: general class if present, else religious class. |

## 7. Documents

| ID | Requirement |
|---|---|
| FR-D1 | One-page A4 PDF per approved evaluation: school header + logo, room number + class, area, round, evaluator, date, approver, score / max, comment, 3–5 site photos + signature sheet photo, document number and version. Font Sarabun. |
| FR-D2 | PDF is generated only after approval. Watermark "ฉบับร่าง" until the round is finalized. |
| FR-D3 | Printable blank signature sheet per class and round (room number, class, round, lines for students to sign) (P2). |
| FR-D4 | Appointment orders (คำสั่งแต่งตั้ง): admin uploads PDFs per term; public page shows them inline with a download button. |
| FR-D5 | Admin exports: term summary Excel, all PDFs of a round as one merged PDF (P2). |

## 8. Public site (no login)

| ID | Requirement |
|---|---|
| FR-W1 | Home: logo, current round status and progress, buttons: appointment order, zones/buildings (label follows term config), classes, rankings, charts, how-to guide, login. |
| FR-W2 | Areas page: every zone/building with per-round scores and term total. |
| FR-W3 | Classes page: dropdown grade + dropdown class; shows per-round room score and term average. **No student names.** |
| FR-W4 | Rankings: top 3 of every grade with "ดูเพิ่มเติม" per grade; areas ranked in full. Toggle per round / term-to-date. |
| FR-W5 | Charts: choose a class, zone or building; line of scores per round **within the current term**. Terms are independent: scores of a finished term are not carried into or compared with the next term. |
| FR-W6 | Scoring calendar generated from round dates (P2). |
| FR-W7 | Only approved scores are public. Evidence photos, signature sheets, evaluator names are staff-only. |

## 9. Staff dashboard and notifications

| ID | Requirement |
|---|---|
| FR-N1 | Real-time dashboard: progress per round, targets without score, overdue targets (red, with the responsible committee), pending approvals and requests, last student sync. |
| FR-N1b | Monitor board: status of every target per round (not scored / waiting approval / returned / approved / PDF queued / PDF failed / request waiting). Super admin, admin and executive see all targets — also when they hold committee duty. Other committee members see only their assigned targets. Hover (desktop) or tap (mobile) on a room/zone/building shows the assigned committee members and the evaluator. |
| FR-N2 | Web Push (Android, iOS ≥ 16.4 installed PWA, desktop) plus in-app inbox as fallback. |
| FR-N3 | Events: duty assigned; round opens; 72 h / 24 h before close (to committee with open targets, admins, executives); overdue; **every new score and every edit/delete of a score, photos or comment (to all admins and super admins)**; evaluation returned; request created (admins); request decided (requester); all targets approved (admins, executives). |
| FR-N4 | Monitor filters: status, grade (ชั้นเรียน), building or zone, committee member, room (number or name). Two views: room map (tiles grouped by grade, then areas) and table. Live activity feed of who scored or edited what. |

## 10. Integrations

| ID | Requirement |
|---|---|
| FR-I1 | Student API (existing): CSV per track (general `students/Export`, vocational `students/ExportVoc`), params `academic_year`, `term_id`, `token`. Import only student ID, name, general class, religious class. |
| FR-I2 | Daily sync at 02:00 compares by student ID: new, moved, name changed, missing → inactive, duplicates → admin review. Abort if > 10 % of active students would become inactive or the API fails. |
| FR-I3 | Class names from the API map to the class register through aliases (e.g. `Usaha(Ijtihad)` = `Usaha`, `Iklas` = `Ikhlas`). Unmapped names are reported to admin, never auto-created. |
| FR-I4 | ปพ.5 export API (pull, API key, school network only): per class (this term) and per student (when student-level); only finalized rounds. CSV/Excel export as fallback. |
| FR-I5 | Teacher auth API: pending (see open questions). |

## 11. Privacy, retention, security

| ID | Requirement |
|---|---|
| FR-S1 | Never store national ID, birth date, parent data. Never show student names in any UI this term. |
| FR-S2 | **Everything of a term is kept for 1 year after the term is closed, as evidence in case of disputes, then deleted**: evaluations, scores, comments, evidence photos, PDFs, requests, results, roster snapshots, and the term's audit rows. Students not seen in any kept term are deleted too. Super admin and admins are warned 30 days before and can download an archive (Excel + all PDFs) first. |
| FR-S3 | Places (buildings, rooms, zones, classes, aliases) and users are not term data and are kept. |
| FR-S4 | HTTPS only (Cloudflare Tunnel). Sessions httpOnly, SameSite=Lax, 12 h idle timeout for staff. Rate limit login. |
| FR-S5 | Daily encrypted off-machine backup of DB and uploads; restore procedure documented and tested. |

## 12. Out of scope for now

Self-registration, complaints about teachers not doing zone duty, repair requests, equipment requisition
(exist in the old Google Site; not built now).
