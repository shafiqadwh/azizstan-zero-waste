# 04 — Business Rules (exact)

This is the executable specification. Every rule has an ID (BR-xx) used by tests (docs/13-testing.md).
Reference implementation of the scoring rules: `src/lib/scoring/` (runs, tested).

---

## 1. Time and numbers

- **BR-T1** All comparisons use server time `now` (UTC). Displayed in Asia/Bangkok; Thai UI shows
  Buddhist-era dates: `15 พ.ย. 2569 16:30 น.`.
- **BR-T2** A round is *open for entry* when `opens_at ≤ now < closes_at` and status is `open`.
- **BR-N1** Scores are exact decimals with 3 places. In code: integer thousandths (`4.5` → `4500`).
- **BR-N2** A score is valid iff `0 ≤ s ≤ component.max` and `s` is a multiple of `term.score_step`
  (`score_step = 1` when `score_format = integer`). Empty is invalid; `0` must be typed.
- **BR-N3** Division results (averages, scaling) are computed with full precision (thousandths, rounded
  half-up at the 3rd decimal) and rounded **half-up to 2 decimals only for display and export**.

## 2. Terms

- **BR-TM1** Creating a term copies from the latest term: config columns, score components, and
  `term_class_zones` (zone mode). Duties are **not** copied (committees change every term) unless the admin
  ticks "คัดลอกผู้ประเมินจากเทอมก่อน".
- **BR-TM2** Config (terms row + components) is editable while `config_locked_at IS NULL`. The first evaluation
  created in the term sets `config_locked_at = now` in the same transaction.
- **BR-TM3** If `sum(max of score components with kind=score)` ≠ `final_max`, the UI shows the scaling
  factor `final_max / sum` next to the term maximum so the admin sees it (e.g. "คะแนนจะถูกแปลงเป็นเต็ม 20").
- **BR-TM4** Exactly one term has `status = active` at a time. Activating a term closes the previous one. Round
  jobs (open, close, reminders) run only for the active term; a `draft` term is invisible to committees and the public.
- **BR-TM5 Readiness** — round 1 of a term can be opened (manually or by its job) only when all pass; each failed
  check is a step flag on the settings overview (08-ux-ui §6.20):
  1. term config saved; 2. a student sync succeeded within the last 7 days (**blocking only when `student_level_enabled`**; in group mode a
  missing sync or students in `review` are warnings, because group scores do not depend on the roster);
  3. mode and score format set; 4. components' max > 0 and every round has dates; 5. every active class has a
  current physical room (building mode) or a zone for the term (zone mode); 6. every class and area has ≥ 1
  committee member; 7. at least one appointment order uploaded (warning only — does not block);
  8. no class shares a room (guaranteed by the DB) and no area is empty of classes.
  If round 1's `opens_at` arrives while checks fail, the job does not open the round and notifies admins.
- **BR-TM6** New-term wizard copies, from the chosen term: term config and components (always); zone places,
  zone descriptions and `term_class_zones` (default on); committee/approver duties (default off). Class–room links
  are date-based and simply continue; the admin moves classes with an effective date. Nothing from the old term is
  modified or deleted.

## 3. Round lifecycle

```
scheduled ──(opens_at reached, worker)──► open ──(closes_at reached, worker)──► closed ──(admin: ปิดรอบ)──► finalized
    ▲                                        │                                    │
    └───────(admin edits dates before open)──┘       late-entry grants still work ┘
```

- **BR-R1 Open** (job `round.open`, runs at `opens_at`): in one transaction
  1. status → `open`;
  2. write `round_class_areas` for every active class:
     - building mode: building of the physical room linked to the class on the date of `opens_at`;
     - zone mode: the class's row in `term_class_zones`;
     - a class with no area → listed in the dashboard as "ไม่มีพื้นที่" (blocks finalize);
  3. write `roster_snapshots` from active students' `home_class_id`;
  4. notify committee members with targets (type `round_opened`).
- **BR-R2 Close** (job `round.close`, at `closes_at`): status → `closed`. Committee can no longer create
  evaluations without a late-entry grant. Owners may still edit within their own self-edit window.
- **BR-R3 Finalize** (admin action) allowed only if, for every class and every applicable component,
  there is an evaluation with status `approved` (see BR-S1 for applicability), and no request is `waiting`.
  Effects: compute results (BR-S*), write with `frozen=true`, status → `finalized`, regenerate PDFs of the round
  without watermark (job `pdf.render` per evaluation), notify admins and executives.
- **BR-R4** Admin may edit `round_class_areas` rows while the round is not finalized (e.g. a class moved on the
  wrong day). Audit logged.
- **BR-R5** Round dates can be edited freely while `scheduled`; while `open`/`closed` only `closes_at` can be
  extended (never shortened below `now`).

## 4. Who may score what

`canCreateEvaluation(user, round, component, target, now)` is true iff all hold:

- **BR-P1** user is active and holds a `committee` duty in `round.term` whose target equals `target`
  (for freelance duties also `valid_until > now`). Component source must be `committee`
  (area_teacher components need an `area_teacher` duty on the area — P3).
- **BR-P2** entry is open (BR-T2) **or** the user has an approved `late_entry` request for this
  (round, component, target) with `grant_until > now`.
- **BR-P3** no live evaluation exists for (round, component, target) (I1). If one exists, the UI shows
  "ประเมินแล้วโดย {owner} เมื่อ {time}" and offers nothing else except "ขออนุมัติ" (edit/delete request).
- **BR-P4** role `executive` or `teacher` or `admin` doesn't matter — only the duty does (FR-U6).
- **BR-P5** Race: two committee members submitting the same target at once → the unique index rejects the
  second; the service catches it and returns `ALREADY_EVALUATED` with the winner's name.

## 5. Evaluation lifecycle

```
          submit (BR-E1)                       approve (BR-E6)
 (none) ────────────────► submitted ───────────────────────────► approved ──(approved request)──► approved v+1
                              │   ▲                                   
                 return (BR-E7)│   │ resubmit (BR-E8)                
                              ▼   │                                   
                           returned                                   
 submitted/returned ──(owner delete within window, BR-E5)──► void
```

- **BR-E1 Submit** requires: valid score (BR-N2) or, in individual mode, a score for every snapshot student of
  the class; site photos `photo_min ≤ n ≤ photo_max`; exactly one signature photo **when the component has
  `requires_signature = true`** (default true for class-unit, false for area-unit), none otherwise; comment ≤ `comment_max`.
  Sets `first_submitted_at = now`, `self_edit_until = now + self_edit_hours`, `room_number_at_eval` from
  `round_class_areas`, status `submitted`. Notifies approvers.
- **BR-E2 Self-edit window**: owner may change score, photos, comment while
  `status ∈ {submitted, returned}` and `now < self_edit_until`. Each change: `version += 1`, audit row.
- **BR-E3** The self-edit window does **not** depend on the round being open: an owner who submitted 1 hour
  before close may still fix a typo 20 hours later.
- **BR-E4** Outside the window, or for anyone who is not the owner, every change is a request (§6).
- **BR-E5 Delete** by owner within the window → status `void` (row kept; unique index frees the slot).
- **BR-E6 Approve** (admin; if the target has an `approver` duty holder, only that admin or a super admin):
  status `approved`, `approved_at/by`, enqueue `pdf.render`, revalidate public cache, recompute live results.
- **BR-E7 Return** (admin, reason required ≥ 5 chars): status `returned`, `returned_reason`,
  `self_edit_until = max(self_edit_until, now + self_edit_hours)` so the owner can fix it. Notifies owner.
- **BR-E8 Resubmit** from `returned` → `submitted` (same validation as BR-E1).
- **BR-E9** Approved evaluations change only via requests (§6). Applying a request to an approved evaluation
  keeps it `approved`, increments `version`, and renders a new PDF version.

## 6. Requests (ขออนุมัติ)

| Type | Who can create | Preconditions | Payload | On approve |
|---|---|---|---|---|
| `late_entry` | committee member of the target | no live evaluation; entry closed | `{hours?}` suggestion | `grant_until = now + chosen hours` (default `late_entry_default_hours`); requester may create the evaluation until then |
| `edit_score` | owner (outside window) or another committee member of the target | evaluation exists, not void | `{score}` or `{studentScores}` | set score; version+1; if approved → new PDF |
| `edit_photos` | same | same | `{add:[evidenceIds], remove:[evidenceIds]}` (new photos uploaded first as orphans) | apply; re-validate counts |
| `edit_comment` | same | same | `{comment}` | set comment |
| `move_target` | owner | evaluation exists | `{targetClassId|targetAreaId}` must be a target the owner is assigned to, with no live evaluation | move evaluation; `room_number_at_eval` recomputed |
| `delete` | owner or committee member of the target | evaluation exists | `{}` | status `void` |

- **BR-Q1** Reason is required (≥ 5 characters).
- **BR-Q2** Admin sees old vs new values side by side and approves or rejects with an optional note.
- **BR-Q3** Approval applies the payload in the same transaction, re-validating as if it were a submit; if
  validation fails the approval fails with the reason shown to the admin (request stays `waiting`).
- **BR-Q4** Waiting requests expire (`expired`) when their round is finalized — admins are warned before
  finalizing (finalize is blocked while any are waiting, BR-R3).
- **BR-Q5** Requests on a finalized round: allowed for super admin only ("แก้ไขหลังปิดรอบ"); approval
  unfreezes that round's results, applies, recomputes, refreezes, regenerates affected PDFs. Audit logged.

## 7. Scoring (reference implementation in `src/lib/scoring`)

### 7.1 Applicability — BR-S1
A component applies to a class in a round if:
- only components with `enabled = true` exist for scoring, targets, forms, reminders and readiness checks;
- `unit = class`: always (every active class is a target of every class-unit component);
- `unit = area`: the class has a row in `round_class_areas` for that round (it inherits that area's evaluation).

### 7.2 Component value for a class in a round — BR-S2
- class-unit, group mode: the class's approved evaluation `score`.
- class-unit, individual mode: mean of `evaluation_student_scores` over snapshot students (for ranking);
  each student keeps their own score for student-level results.
- area-unit: the approved evaluation score of the class's area (same number for every class in that area).
- `kind = deduct`: sum of approved deductions for the target, capped at `component.max`.

### 7.3 Round total — BR-S3
```
classScore = Σ value(c) for applicable components c with kind=score, unit=class
areaScore  = Σ value(c) for applicable components c with kind=score, unit=area
deduction  = Σ value(c) for applicable components c with kind=deduct
total      = max(0, classScore + areaScore − deduction)
```
Deductions reduce the total, but never below 0 (FR-E12: "คะแนนหลังหักไม่ต่ำกว่า 0").
A round total exists only when every applicable component has an approved value (else the class has no
total for that round and it is shown as "รอผล").

### 7.4 Term score — BR-S4
```
rounds_with_total = rounds of the term where the class has a total (frozen or live-approved)
avg        = (Σ total) / count(rounds_with_total)          -- equal weights (FR-R5)
maxSum     = Σ max of components with kind=score that applied to the class
termScore  = avg × final_max / maxSum                        -- scaling (FR-C5); factor 1 when equal
```
No rounds with a total → no term score ("ยังไม่มีคะแนน"), never 0.

**BR-S4b Per-round full marks.** A component's max for a round = `round_component_max` row if present, else
`score_components.max_value`. When rounds have different maxima the term score keeps equal round weights by
averaging percentages: `termScore = mean_i(total_i / max_i) × final_max` (reference `termScoreByRound`).
With equal maxima this is identical to BR-S4. Always implement with `termScoreByRound`.

### 7.5 Ranking — BR-S5
- Groups: `classes.rank_group` (ม.1 … ม.6, ปวช., สายศาสนา) and areas (all areas of the term type).
- Order: score descending. Ties share the rank; next rank skips (competition ranking: 14.5, 14.5, 13 → 1, 1, 3).
- Compare at **thousandths** (not the rounded display value), so 13.333 vs 13.334 are different ranks even though
  both display 13.33. Ties at thousandths share the rank.
- Classes without a score are listed after ranked ones, unranked ("—").

### 7.6 Student-level results — BR-S6
For each round, each student in `roster_snapshots` gets the total of the class they were in **in that round**.
Term score per student = mean over rounds they have a total in, scaled as BR-S4. A student who moved keeps earlier
rounds from the old class (FR-R9). Students absent from a round's snapshot (joined later) simply have fewer rounds.

### 7.7 Worked example (golden test G1)
Room 5 + building 10, final max 15, 3 rounds. Class ม.1 Amanah:

| Round | Room | Building | Total |
|---|---|---|---|
| 1 | 4 | 9 | 13 |
| 2 | 5 | 7 | 12 |
| 3 | 4 | 10 | 14 |

Term score = (13+12+14)/3 × 15/15 = **13.00**. If round 2 had no total: (13+14)/2 = **13.50**.
If final max were 20: 13 × 20/15 = 17.3333… → display **17.33**.

## 8. Evidence processing — BR-V*

- **BR-V1** Upload accepts JPEG/PNG/WebP ≤ 15 MB. HEIC is converted to JPEG **in the browser** (canvas re-encode,
  07-frontend §3.4) because prebuilt sharp cannot decode HEIC; the server rejects HEIC with "กรุณาถ่ายรูปใหม่ในแอป". Server (worker or inline sharp): auto-rotate, strip all
  EXIF, resize to max 1600 px long edge, WebP quality 80, stamp bottom-right
  `dd/MM/yyyy HH:mm · 121 · ม.1 Amanah` (Bangkok time, Buddhist year), store as `uploads/{sha[0:2]}/{sha}.webp`.
- **BR-V2** `captured_at` = server receive time (client clocks are not trusted).
- **BR-V3** Site photos must come from the camera (`<input capture="environment">` on mobile). The signature
  sheet may also be picked from the gallery (Q7).
- **BR-V4** Uploads not attached to an evaluation within 24 h are garbage-collected.

## 9. Student sync — BR-Y*

### 9.1 Algorithm (job `students.sync`, 02:00 daily and on demand)
1. For each source (general, vocational): GET `{base}/Export` or `/ExportVoc` with
   `academic_year`, `term_id`, `token`. Timeout 60 s, 2 retries. Failure → `sync_runs.status = failed`, notify admins,
   **no changes**.
2. Parse CSV in memory (UTF-8 with BOM). Keep only columns: `รหัสนักเรียน`, `ชื่อ-สกุลนักเรียน`, `ชั้นสามัญ`,
   `ชั้นศาสนา`. The raw text is discarded after parsing and never logged.
3. Robustness: the file has unquoted commas inside fields and line breaks inside fields. Parse with a real CSV
   parser (RFC 4180, `relax_column_count`), then **re-align by header count**: a row whose column count ≠ 11 is
   `malformed`; try repair — (a) join with the next physical line if the row is short; (b) if long, the extra
   fields sit in the phone column (index 9) — merge fields 9..(n−2) — because the column after phone is the
   coordinator name. Rows still wrong → counted as malformed and listed by student code only.
4. Normalize class strings (§9.2) and resolve through `class_aliases`. The religious string is resolved **only when the
   general class is empty** (religious-only students); for everyone else it is ignored, so strings like `PR 1/1 Amanah`
   never block a sync. Unknown class string (that must be resolved) → student status
   `review` with reason `unknown_class:<normalized string>`; the admin maps it once (creates an alias) and
   re-runs.
5. Diff against DB by `student_code`: new → insert; class changed → update (moved); name changed → update;
   present in DB but absent from both sources → candidate inactive; same code twice in the input → `review`.
6. **Abort guard**: if candidates to inactivate > `SYNC_ABORT_RATIO` × active students → status `aborted`,
   notify admins, no changes.
7. Apply in one transaction. `home_class_id = general_class_id ?? religious_class_id` (FR-R10).
   `last_seen_at = now`, `delete_after = now + STUDENT_RETENTION_DAYS`.
8. Write `sync_runs` with counts and a change list containing **student codes and class names only**.
9. Snapshots of rounds already open are **not** touched (FR-R3).

### 9.2 Class string normalization
```
input "ม.1/1 Amanah"      → trim, collapse spaces, NFC, "ม ." → "ม."   → key "ม.1|Amanah"
input "ม.1/10 Usaha"      → name "Usaha"   (alias "Usaha(Ijtihad)" also maps here)
input "ม.4 Ash-Shafi’i"   → apostrophes unified to ASCII "'"
input "PR 1/1 Amanah", "อก.1/3 Cergas" (religious column) → key "PR1|Amanah", "อก.1|Cergas"
input "ปวช.2/1"            → key "ปวช.2|ปวช.2/1"
```
Regex for general: `^ม\.\s*(\d)\s*/\s*(\d{1,2})\s+(.+)$` → grade, roomNo, name.
Everything else is looked up verbatim (after normalization) in `class_aliases`. Keys are case-insensitive.

## 10. Retention — BR-D*

- **BR-D1** Closing a term (`status = closed`) sets `terms.closed_at = now` and `terms.purge_after = closed_at + 365 days`.
  A closed term is read-only for everyone; its data is shown only to staff (history for disputes), never on the
  public site.
- **BR-D2** 30 days before `purge_after`, notify super admin and admins (type `retention_warning`) and offer
  "ดาวน์โหลดข้อมูลเก็บถาวร" (Excel of all results + ZIP of all PDFs of the term).
- **BR-D3** Daily job `retention.run` 03:00: for each term with `purge_after < today`, in one transaction delete the
  term's rounds and everything under them (evaluations, student scores, evidence rows, PDF rows, requests,
  results, snapshots, `round_class_areas`), components, duties, `term_class_zones`, appointment orders, and the audit
  rows whose entity belongs to the term; then delete the files (uploads, PDFs). Keep the `terms` row itself with
  `purged_at` so the history list shows "ข้อมูลถูกลบตามกำหนดแล้ว".
- **BR-D4** Students: delete those whose `delete_after` passed and who appear in no remaining term's snapshot.

## 11. Document numbers — BR-DN1
`ZW-{academic_year}-{term_no}-R{round_no}-{seq 4 digits}`; seq per round in approval order.
PDF version increments per evaluation. Footer: `เลขที่เอกสาร ZW-2569-2-R1-0007 · ฉบับที่ 2`.
