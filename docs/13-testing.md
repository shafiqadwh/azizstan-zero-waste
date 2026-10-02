# 13 — Testing

## 1. Layers

| Layer | Tool | Scope | Where |
|---|---|---|---|
| Pure logic | node:test / Vitest | `src/lib/**` | `*.test.ts` beside the code |
| Services | Vitest + real PostgreSQL (Testcontainers or `embedded-postgres`) | rules that touch the DB | `src/server/services/*.test.ts` |
| E2E | Playwright (mobile Pixel 7 + desktop 1440) | user journeys | `e2e/*.spec.ts` |
| PDF snapshot | Playwright screenshot of `/internal/pdf/...` | layout regressions | `e2e/pdf.spec.ts` |

Services receive `now` explicitly; tests pass fixed dates. Never use the real clock in a test.

## 2. Already implemented (reference): `src/lib/scoring/scoring.test.ts` — 24 tests, all passing
Covers BR-N1..N3, BR-S2..S6 (incl. S4b per-round full marks), golden example G1 (a/b/c), ranking ties at thousandths, deduction floor,
student moves, class-string keys (§9.2), home class (FR-R10). Run:
`node --experimental-strip-types --test src/lib/scoring/scoring.test.ts`.

## 3. Service tests to write (each is a ticket's acceptance test)

| ID | Rule | Scenario → expected |
|---|---|---|
| T-P1 | BR-P1 | teacher without duty submits → `FORBIDDEN` |
| T-P2 | BR-P2 | submit at `closes_at + 1 s` → `ENTRY_CLOSED`; with approved late_entry `grant_until` in future → ok; after grant → `ENTRY_CLOSED` |
| T-P3 | BR-P3/P5 | two committee members submit same target concurrently → one ok, other `ALREADY_EVALUATED` with winner name |
| T-E1 | BR-E1 | 2 site photos when min = 3 → `VALIDATION field=sitePhotos`; no signature → `VALIDATION field=signature`; score null → `VALIDATION field=score`; score 0 → ok |
| T-E2 | BR-E2/E3 | owner edits at `first_submitted_at + 23h59m` after round closed → ok; at `+24h` → `EDIT_WINDOW_PASSED` |
| T-E3 | BR-E2 | non-owner committee member edits → `FORBIDDEN` (UI offers request) |
| T-E5 | BR-E5 | owner deletes within window → status void; another member can now create |
| T-E6 | BR-E6 | approve by admin who is not the target's approver when an approver exists → `FORBIDDEN`; super admin → ok; PDF job enqueued |
| T-E7 | BR-E7 | return extends `self_edit_until` to now + 24h; owner edits after original window → ok |
| T-Q1 | BR-Q3 | approve `edit_score` with value off the step grid → approval fails, request stays waiting |
| T-Q2 | BR-Q | approve `move_target` to a target that already has a live evaluation → fails with `ALREADY_EVALUATED` |
| T-Q3 | BR-E9 | applied request on approved evaluation → version+1, new PDF version, old PDF `superseded_at` set |
| T-R1 | BR-R1 | round.open freezes `round_class_areas` from class_room_links at `opens_at`; later room move does not change it |
| T-R2 | BR-R3 | finalize with 1 missing evaluation → `ROUND_NOT_COMPLETE (1)`; with waiting request → blocked |
| T-R3 | BR-R3 | finalize writes frozen results equal to live computation; public API returns them |
| T-TM1 | BR-TM2 | first evaluation sets `config_locked_at`; updateTermConfig afterwards → `CONFIG_LOCKED` |
| T-TM2 | BR-TM1 | createTerm copies config/components/zones, not duties (unless flag) |
| T-TM3 | FR-P7, BR-TM1 | createTerm for term 2 of the same academic year copies `term_classes`; createTerm for a new academic year copies none and readiness step 5 fails until a class is selected |
| T-TM4 | FR-P7 | unselected class: not in `round_class_areas`, not a committee target, not in `/public/rankings` or `/pp5/terms/{id}/classes`; `setTermClasses` after config lock → `CONFIG_LOCKED` |
| T-Y1 | BR-Y step 3 | CSV fixture with (a) line break inside province, (b) unquoted comma in phone, (c) empty cells → all students parsed with correct codes and classes |
| T-Y2 | BR-Y step 6 | fixture with 15 % students missing → sync `aborted`, DB unchanged, admins notified |
| T-Y3 | BR-Y step 4 | unknown class string → student `review`, not auto-created class |
| T-Y5 | BR-Y step 4a | religious-only row `1M Al-Taqwa` / `มุตะวัซซิต ปี 1 …` → not imported, not `review`, no notification, `counts.skipped` = 1; same string for a student with a general class → imported normally (religious ignored) |
| T-Y4 | FR-S1 | after sync, DB has no column/value containing a 13-digit national ID (scan all text columns) |
| T-D1 | BR-D1..D4 | term closed 366 days ago → all its term data and files deleted, `purged_at` set, other terms untouched; student in no kept term with past `delete_after` → deleted |
| T-A1 | FR-E10 | every mutating service call writes exactly one audit row (spy on audit.service) |

CSV fixtures must be **synthetic** (fake names, fake 13-digit numbers that fail the Thai ID checksum) — never
real student data in the repository.

## 4. E2E journeys (mobile unless noted)

1. **Committee happy path**: login → /tasks → tap `121 · ม.1 Amanah` → choose 4 → take 3 photos + signature
   (Playwright file chooser) → submit → item shows "รออนุมัติ".
2. **Admin approval (desktop)**: /admin/approvals → approve → PDF link appears → public rankings show the score
   within 60 s (or immediately after tag revalidation).
3. **Late entry**: time-travel past close → form shows `info.entry_closed` → request → admin approves 24 h →
   form enabled → submit.
4. **Edit after 24 h**: request `edit_score` 4.5 → 3 → admin sees old/new → approve → PDF v2.
5. **Executive read-only (desktop)**: all pages visible, no action buttons, direct server action call → 403.
6. **Public**: home → rankings → toggle building → class picker → no student name text on any public page
   (assert against a list of seeded fake names).
7. **Offline draft**: go offline after 2 photos → reload → draft restored → online → submit succeeds.

## 5. Static checks
- ESLint custom rule `no-student-name`: forbids selecting `students.fullName` anywhere except
  `src/server/services/student.service.ts` (sync writes it; nothing reads it for output — ปพ.5 export uses codes).
- `tsc --noEmit` strict, `eslint`, `prettier --check` in CI.

## 6. E2E against the production image (go-live dry run)
Run before the first install and after any change under `deploy/`: the same suite, but served by the Docker image
instead of `pnpm dev`.
1. `.env` with `APP_URL=http://localhost:3100`; a compose override that publishes `app` on `127.0.0.1:3100:3000`
   and `db` on `127.0.0.1:5433:5432` (test machine only — production never publishes the database).
2. `sh deploy/zw.sh build`, then `docker compose --env-file .env -f deploy/docker-compose.yml -f override.yml up -d`.
3. `DATABASE_URL=postgres://zw:<POSTGRES_PASSWORD>@localhost:5433/zw pnpm test:e2e` — Playwright reuses the server
   already on port 3100.

Expected: everything passes except journey 2's last step ("the PDF link appears once rendered"), which renders the
PDF inside the test process and writes it to the host's `./data`, not to the container volume (a test shortcut; the
worker's own rendering is covered by checking `/data/pdf` in the worker container).
Last run 2026-10-02: 107 passed; the run found the backup missing `orders/` and the restore leaving the volume
owned by root (both fixed in `deploy/`).
