# 15 — Roadmap and Tickets

Work top to bottom. Each ticket is sized for one agent session (a few hours). Do not start a ticket before its
dependencies are merged. "AC" = acceptance criteria; all must pass plus the Definition of Done in AGENTS.md §7.

## Phase 0 — Foundation

**T00 Repo scaffold** — deps: none
Next.js (App Router, TS strict, `output: 'standalone'`), pnpm, Tailwind, shadcn/ui init, ESLint/Prettier, Vitest,
Playwright, path aliases, `src/` layout from AGENTS §4, fonts in `/fonts` via `next/font/local`.
AC: `pnpm dev` shows a blank page with IBM Plex Sans Thai; `pnpm lint typecheck test` green; copy
`src/lib/scoring/*` in and its 24 tests pass under Vitest.

**T01 Database** — deps: T00
drizzle-kit config, `db/schema.ts` as provided, first migration + `RAW_SQL`, `db:migrate`, `db:seed`
(03-database §5; reference data from 10-integrations §1.4/1.5; fake students).
AC: fresh DB migrates; exclusion constraints reject overlapping class–room links (test); seed idempotent.

**T02 Docker & worker skeleton** — deps: T01
Dockerfile, compose (deploy/), worker entry with pg-boss, heartbeat job, `/api/v1/health`,
`scripts/migrate.js` (runs drizzle migrations + `RAW_SQL` once, inside the container).
AC: `docker compose up` → health `ok` with worker heartbeat < 60 s old.

**T04 CI** — deps: T00
GitHub Actions (or the school's git host): install, `lint`, `typecheck`, `test`, `db:migrate` against a Postgres
service, Playwright smoke on PRs; block merge on failure. Every AI-made change goes through a PR reviewed by the
owner.
AC: a failing test blocks the merge; pipeline < 10 min.

**T03 Service conventions** — deps: T01
`Result` type, error classes and codes (05-api §1), `withTransaction`, `audit.service`, Bangkok date helpers
(Buddhist year formatting), `newId()` uuid v7.
AC: unit tests for date formatting (`15 พ.ย. 2569 16:30 น.`) and error mapping.

## Phase 1 — Usable for term 2/2569 (buildings, group mode, executives as committee)

**T10 Auth (local)** — deps: T03
argon2id, sessions, login/logout, rate limit, must-change-password, `requireUser`, middleware for route groups,
`scripts/create-super-admin.js`.
AC: 06-auth §1.1; e2e login; 6th wrong password → `RATE_LIMITED`.

**T11 Policies** — deps: T10
`can/assertCan`, permission matrix 06-auth §3 as data + tests for every cell.
AC: table-driven test covers each role × action.

**T12 Users admin** — deps: T11
`/admin/settings/users` (super admin create, set role, activate, reset password; admin read-only list).
AC: only super admin can create users and set roles; an admin calling those actions directly gets 403.

**T13 Places register** — deps: T11
Areas, physical rooms (QR token), classes + aliases, class–room links with effective dates (move flow),
zones' descriptions; Excel import `rooms.xlsx` (dry-run → commit); per-term class selection `term_classes`
(FR-P7, 08-ux-ui §6.14).
AC: moving a class closes the old link at the effective date; overlap errors shown in Thai; an unselected class
is not a target, not ranked and not exported; a new academic year starts with no classes selected.

**T14 Term & rounds settings** — deps: T13
`/admin/settings/mode` + `/admin/settings/scoring` exactly as 08-ux-ui §6.12; copy-from-previous; lock; rounds CRUD with date rules (BR-R5);
scaling note (BR-TM3); activate term.
AC: T-TM1, T-TM2; integer vs decimal changes the committee form step; number of rounds stepper creates/removes
rounds; a disabled component (zone-teacher score) never appears in forms, targets, results or readiness checks;
switching off "ใช้คะแนนเต็มเท่ากันทุกรอบ" stores `round_component_max` rows and results use `termScoreByRound`.

**T14b Settings menu, readiness checklist, new-term wizard** — deps: T14, T13, T25
`/admin/settings` overview (08-ux-ui §6.20) with the 15 settings pages wired into the second-level menu, amber
flags, readiness checks BR-TM5, new-term wizard BR-TM6, zone editor with `zone_places` (§6.22), room/building editor
(§6.21), `app_settings` pages (notifications, documents, public site, integrations, privacy).
AC: each BR-TM5 check turns its step amber with the right count and links to the fixing page; round 1 cannot open
while a blocking check fails (job refuses and notifies admins); wizard creates a draft term copying exactly what
was ticked and changes nothing in the old term; secrets are never rendered (write-only fields).

**T15 Duties & coverage** — deps: T14, T12
Assign/remove committee and approver duties, freelance with expiry, coverage matrix, `duties.xlsx` import.
AC: coverage shows classes/areas with 0 or 2+ committee members; dry-run lists unknown usernames/targets.

**T16 Round jobs** — deps: T14, T02
`round.open` (freeze `round_class_areas`, snapshots), `round.close`, rescheduling when dates change, admin edit of
`round_class_areas` (BR-R4).
AC: T-R1; jobs idempotent (run twice → same rows).

**T17 Evidence upload** — deps: T03
`POST /api/v1/uploads`, sharp pipeline (BR-V1), timestamp stamp, permission-checked `/files/{id}?w=`, GC job.
AC: EXIF GPS removed (test with a fixture); 15 MB limit; thumbnail 320 px.

**T18 Evaluation service** — deps: T15, T16, T17
submit / update / delete / resubmit / approve / return with all BR-P and BR-E rules; audit; optimistic `version`.
AC: T-P1..P3, T-E1..E7, T-A1.

**T19 Committee UI** — deps: T18
`/tasks`, search by room number, `/r/[qrToken]`, `/evaluate/new`, `/evaluate/[id]` per 08-ux-ui §6.7–6.9,
components `TargetBadge`, `StatusPill`, `ScoreInput`, `PhotoGrid`, `DeadlineBanner`.
AC: e2e journey 1; works at 360 px; every validation message from §9 appears in the right place.

**T20 Requests** — deps: T18
All six request types, approval applying payload (BR-Q1..Q5), late-entry grant duration.
AC: T-Q1..Q3; e2e journeys 3 and 4.

**T21 Results engine** — deps: T18
`result.service` using `lib/scoring`: live results, finalize (BR-R3) with frozen rows, request expiry.
AC: T-R2, T-R3.

**T22 PDF** — deps: T21, T02
`/internal/pdf/evaluation/[id]` layout 09-pdf §2, worker render, versions, watermark until finalize,
`/api/v1/pdf/{id}`.
AC: one page for 0–5 photos and a 300-char comment (snapshot tests); Thai text renders with Sarabun.

**T23 Admin dashboard & approvals** — deps: T21
`/admin` and `/admin/approvals` per 08-ux-ui §6.10–6.11, 30 s poll, keyboard shortcuts, executive read-only.
AC: e2e journeys 2 and 5.

**T23b Monitor board, requests log, "คำขอของฉัน"** — deps: T22, T20
`/monitor` (scoped per 06-auth `monitor.read`), target popover, `/admin/requests`, `/tasks` tab per
08-ux-ui §6.17–6.19; `pdf_status` updated by the PDF job
(queued → ready | failed with `pdf_error`); "สร้างใหม่" re-enqueues.
AC: every counter equals the number of rows it filters to; a teacher-committee sees only assigned targets
(direct API call for another target → 403); an admin who is also committee sees all targets and can toggle
"เฉพาะที่ฉันรับผิดชอบ"; popover lists every assigned committee member and the evaluator; a forced PDF failure
shows in "PDF ล้มเหลว" and recovers after retry; executive sees no action buttons; room-map and table views
show the same rows; filters (status, grade, building/zone, committee, room search) combine and persist in the
URL; the activity feed shows a new score or edit within 30 s; every submit/edit/delete creates an
`evaluation_submitted`/`evaluation_changed` notification for every admin and super admin (push batched per 11-jobs §2).

**T24 Public site** — deps: T21
`/`, `/rankings`, `/classes`, `/areas`, `/orders` (+ upload in admin), `/guide` (+ editor). Tag revalidation.
AC: e2e journey 6; no evaluator names/photos on public pages; LCP budget met on a throttled run.

**T25 Student sync** — deps: T13, T02
CSV fetch + robust parse (BR-Y), skip rules (step 4a), alias resolution, diff, abort guard, review list UI, manual run button.
AC: T-Y1..Y5 with synthetic fixtures; raw CSV never written to disk (assert tmp dir empty).

**T26 Notifications & PWA** — deps: T19, T23
Inbox, Web Push (VAPID), service worker, install prompts, reminder/overdue jobs (11-jobs).
AC: push received on Android Chrome in a manual test; batching rule; iOS guide shown in Safari.

**T27 ปพ.5 API & exports** — deps: T21
API keys UI, `/api/v1/pp5/*` with CIDR check, term Excel export.
AC: only finalized rounds included; JSON matches 05-api §3.3 example shape.

**T28 Retention & backups** — deps: T25
Close term (BR-D1), 30-day warning + archive download (Excel + ZIP of PDFs), `retention.run` purge (BR-D3/D4),
backup script documented and a restore rehearsal checklist.
AC: T-D1; a closed term older than 365 days leaves no evaluations, files or term audit rows, and its `terms` row
shows `purged_at`; places, classes and users are untouched.

**T29 Hardening & go-live** — deps: all phase 1
Security headers/CSP, log redaction test, rate limits, 12-security checklist sign-off, deployment on the school PC
(14-deployment §2), guide pages written.
AC: checklist complete; restore rehearsal done.

## Critical path for term 2/2569 (if time is short)
This term uses group mode and never shows students, so the roster is **not** needed to score. Minimum to replace the
Google Site for round 1: T00–T04, T10–T15, T16 (without snapshots), T17–T19, T21–T23b, T24 (home + rankings),
T29. Can follow before term end: T20 (requests — until then an admin edits on the requester's behalf, audited),
T25 (student sync), T26 (push; in-app inbox first), T27 (ปพ.5 — needed only at term end), T28.

## Phase 2 — Convenience
- **T30** Printable signature sheet per class/round (09-pdf §3).
- **T31** Scoring calendar page generated from rounds.
- **T32** Merged PDF of a round; charts page `/charts` with table view.
- **T33** Teacher login via school API (`ExternalAuthProvider`) when the API spec arrives (Q1).
- **T34** QR code sheet generator for all physical rooms (A4, 12 per page).

## Phase 3 — Future rule sets
- **T40** Individual mode end to end (per-student scores UI with codes only, student-level results, ปพ.5 students). *Built:* area-unit components stay group-scored (areas have no students).
- **T41** Area-teacher deductions (FR-E12) with limits and PDFs. *Built (Q4 answered):* `area_teacher` duty on areas, deductions per class per round with photo + reason, admin approval, PDF "แบบบันทึกการหักคะแนนความสะอาด".
- **T42** Zone head, zone teacher teams (FR-P4) and teacher-as-committee terms (priority rule Q2).
  *Parked 2026-10-02: not used in 2569.* Decisions kept for when it is built: a zone head (a new per-term duty on a
  zone) may (1) see the status and results of the classes and places in their zone (read-only monitor scope),
  (2) approve evaluations in their zone (like a target-scoped `approver`), and (3) assign and remove the area teachers
  of their zone (the `area_teacher` duty from T41). Q2: committee value only.
