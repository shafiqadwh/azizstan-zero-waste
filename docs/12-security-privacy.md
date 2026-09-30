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
6. Logs: structured JSON (pino); redact `authorization`, `cookie`, `token`, `password`, query strings of the student
   API; never log CSV content or student names.
7. Admin actions that change permissions or data after finalize require re-entering the password (step-up, 10 min).
8. Audit log is append-only (DB trigger in `RAW_SQL` rejects UPDATE/DELETE) and visible to admins/executives at
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

## 3. Retention summary
| Data | Kept | Deleted by |
|---|---|---|
| All data of a term (scores, evaluations, evidence, PDFs, requests, results, snapshots, term audit rows) | 1 year after the term is closed | `retention.run` (BR-D3) |
| Students | until not in any kept term and `delete_after` passed | `retention.run` (BR-D4) |
| Places, classes, users, settings | kept (not term data) | – |
| Audit rows not tied to a term (logins, user changes) | 1 year | `retention.run` |
| Sessions | until expiry | cleanup in `retention.run` |
