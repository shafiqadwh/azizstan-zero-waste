# 12 — Security and Privacy (PDPA)

## 1. Data classification

| Class | Examples | Rules |
|---|---|---|
| Public | approved room/area scores, ranks, appointment orders, guide | served without login |
| Staff-internal | evaluator names, comments, evidence photos, PDFs, dashboards, audit log | login + policy; never cached publicly |
| Personal (minors) | student code, student name | stored only; **never rendered**; exported to ปพ.5 as codes; deleted after 1 year |
| Forbidden | national ID, birth date, parent name/phone, coordinator name, province | never stored, never logged |
| Secrets | session secret, API tokens, VAPID private key, DB password | `.env` only; never in logs, repo, PDFs, client bundles |

## 2. Controls checklist (each must be verified in code review)

1. HTTPS end to end via Cloudflare Tunnel; `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: same-origin`, CSP: `default-src 'self'; img-src 'self' blob: data:; connect-src 'self';
   frame-ancestors 'none'` (PDF viewer uses same-origin `<iframe>`/`<object>`, allowed by `'self'`).
2. CSRF: Server Actions are same-origin POST with Next.js origin check; REST mutations require the session cookie
   **and** `Origin` equal to `APP_URL`.
3. Uploads: MIME sniffed by content (sharp decode), size limit, re-encoded to WebP (drops any payload), stored
   outside the web root, served through a permission-checked route.
4. SQL only through Drizzle parameterized queries.
5. Rate limits: login, uploads, public API (60 req/min/IP).
6. Logs: structured JSON (`src/server/log.ts`, dependency-free); redact `authorization`, `cookie`, `token`, `password`, query strings of the student
   API; never log CSV content or student names.
7. Admin actions that change permissions or data after finalize require re-entering the password (step-up, 10 min).
8. Audit log is append-only (DB trigger in `RAW_SQL` rejects UPDATE/DELETE; since migration 0004 only
   `retention.run` may DELETE, in a transaction that sets `zw.retention = 'on'`) and visible to admins/executives at
   `/admin/audit`.
9. Backups encrypted (age / restic) with the key stored off the machine.
10. Old Moodle on the same PC: not exposed to the internet, or on a separate Docker network; the app DB port is
    never published to the host.
11. Development on a personal NAS with real data (owner's decision): import only the 4 columns, encrypted DSM
    shared folder for volumes, no public exposure (or Cloudflare Access allow-list), delete after handover,
    written permission from the school kept on file.
12. Evidence photos: photograph the place, not people. The form shows the hint "ถ่ายเฉพาะพื้นที่ หลีกเลี่ยงการถ่าย
    ใบหน้านักเรียน". Signature-sheet photos contain student names and signatures → staff-only, never public,
    deleted with the term data 1 year after the term closes (BR-D3).
13. Offline drafts (IndexedDB) are deleted immediately after a successful submit and on logout; drafts older than
    7 days are purged. Downloaded PDFs are the user's responsibility — the PDF footer says "เอกสารภายใน ห้ามเผยแพร่".

## 2a. Sign-off (T29, 2026-10-01)
Status of each control in §2. "Code" items are verified by the named test on every CI run; "On site" items are
checked by the person installing the school PC (14-deployment §2) and ticked in the school's IT log.

| # | Control | Status | Where / how verified |
|---|---|---|---|
| 1 | HTTPS, HSTS, nosniff, Referrer-Policy, CSP | Code ✓ · On site: tunnel | `src/server/security-headers.ts`, `src/proxy.ts` (per-request nonce, `'strict-dynamic'`); `e2e/security.spec.ts` checks the headers and that pages hydrate with no CSP violation. HTTPS itself is the Cloudflare Tunnel. |
| 2 | CSRF | Code ✓ | Server Actions: Next.js origin check. REST mutations (uploads, orders, push): `assertSameOrigin` (`src/server/http-guards.ts`); `http-guards.test.ts`, `e2e/uploads.spec.ts`, `e2e/notifications.spec.ts` (foreign or missing Origin → 403). |
| 3 | Uploads | Code ✓ | sharp decode + WebP re-encode, 15 MB limit, permission-checked `/api/v1/files` (`e2e/uploads.spec.ts`, T17). |
| 4 | SQL parameterized | Code ✓ | Drizzle only; no `sql.raw` in the code base. |
| 5 | Rate limits | Code ✓ | Login 5/15 min (`e2e/auth.spec.ts`), uploads 30/min/user, public API (`/api/v1/orders/*`, `/api/v1/pp5/*`) 60/min/IP (`http-guards.test.ts`). |
| 6 | Log redaction | Code ✓ | `src/server/log.ts`; `log.test.ts` (keys, URL query strings, 13-digit runs). Worker jobs log counts only; `src/instrumentation.ts` logs request errors without headers or query strings. |
| 7 | Step-up | Code ✓ | User create / role / activate / reset password and API key creation need a password entry within 10 min (login counts); `user.service.db.test.ts`, `e2e/users.spec.ts`. No admin action changes data after finalize (finalized rounds are read-only), so that half of the rule has nothing to guard yet. |
| 8 | Audit log | Code ✓ | Append-only trigger (+ retention exception, migration 0004); `/admin/audit` read-only for super admin, admins, executives (`e2e/audit.spec.ts`). |
| 9 | Encrypted backups | Code ✓ · On site | `deploy/backup.sh` (age + rclone). On site: key kept off the machine, restore rehearsal done (14-deployment §6). |
| 10 | Moodle / DB port | Code ✓ · On site | `deploy/docker-compose.yml` publishes no DB port. On site: Moodle not exposed through the tunnel. |
| 11 | NAS development | Owner | Owner's written permission on file; delete after handover. |
| 12 | Evidence photos | Code ✓ | Form hint "ถ่ายเฉพาะพื้นที่ หลีกเลี่ยงการถ่ายใบหน้านักเรียน"; signature photos staff-only; deleted by `retention.run`. |
| 13 | Offline drafts | Not applicable yet | Offline drafts (07-frontend §5) are not built; the rule applies when they are. PDF footer "เอกสารภายใน ห้ามเผยแพร่" is in place. |

## 2b. Pre-go-live review (2026-10-02, after T40/T41/auto-approve/offline drafts)
| Check | Result |
|---|---|
| Every `/api/v1/*` route authenticates (or is public by design: health, appointment order files with the public rate limit, ปพ.5 with key + CIDR) and every server action calls `requireUser` | pass |
| `students.full_name` read only by student sync; no page, export, PDF or log carries it (T40 lists codes only, e2e asserts no name on the page) | pass |
| Guide and manual Markdown renders as elements only; links limited to `https://` and same-site paths | pass |
| Area-teacher access (T41) reaches only area-teacher components; committee duties never count for them, nor the reverse | pass |
| CSV exports: formula guard extended to `-` (plain negative numbers stay numbers) besides `=`, `+`, `@`, tab, CR | **fixed** |
| Offline drafts (IndexedDB) keyed by the signed-in user, so a shared phone never restores another teacher's draft | **fixed** |
| Production `.env` checked by `scripts/preflight.js` before go-live (14-deployment §2 step 10) | added |

## 3. Retention summary
| Data | Kept | Deleted by |
|---|---|---|
| All data of a term (scores, evaluations, evidence, PDFs, requests, results, snapshots, term audit rows) | 1 year after the term is closed | `retention.run` (BR-D3) |
| Students | until not in any kept term and `delete_after` passed | `retention.run` (BR-D4) |
| Places, classes, users, settings | kept (not term data) | – |
| Audit rows not tied to a term (logins, user changes) | 1 year | `retention.run` |
| Sessions | until expiry | cleanup in `retention.run` |
