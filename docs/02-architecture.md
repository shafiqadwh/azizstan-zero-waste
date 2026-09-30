# 02 — Architecture

## 1. Runtime view

```
                 Internet
                    │ HTTPS
            ┌───────▼────────┐
            │  cloudflared   │  Cloudflare Tunnel (no open ports on the router)
            └───────┬────────┘
                    │ http://app:3000
┌───────────────────▼───────────────────┐        ┌──────────────────────┐
│ app  (Next.js, Node 22)               │        │ worker (Node 22)      │
│  - public pages (RSC, cached 60 s)    │        │  - pg-boss consumer   │
│  - committee PWA + admin UI           │  jobs  │  - student sync 02:00 │
│  - server actions → services          │───────►│  - PDF render         │
│  - /api/v1 (ปพ.5 export, health)      │        │  - image processing   │
│  - /internal/pdf/* (HTML for PDF)     │◄───────│  - push notifications │
└───────┬─────────────────┬─────────────┘  HTTP  │  - retention cleanup  │
        │ SQL             │ files               └───┬──────────┬───────┘
┌───────▼───────┐  ┌──────▼────────────────┐        │ SQL      │ files
│ db PostgreSQL │  │ /data volume           │◄───────┘          │
│ app + pg-boss │  │  uploads/  pdf/  tmp/  │◄──────────────────┘
└───────────────┘  └────────────────────────┘
External: Student API (azizstan.net, CSV) · Teacher auth API (TBD) · ปพ.5 program pulls /api/v1/pp5/*
```

- **app** and **worker** are the same codebase and Docker image, different start commands
  (`node server.js` vs `node worker/index.js`).
- The worker renders PDFs by opening `http://app:3000/internal/pdf/evaluation/{id}?token=…` in Chromium.
  The token is an HMAC of (evaluationId, version, expiry 5 min) signed with `INTERNAL_PDF_SECRET`.
- Files live on a Docker volume, addressed by content hash. The DB stores only relative paths.

## 2. Layers inside `app`

```
UI (RSC pages, client components)
   │  server actions / route handlers  — parse input with Zod, get session
   ▼
Policies (src/server/policies)          — can(user, action, resource) → throws Forbidden
   ▼
Services (src/server/services)          — business rules, transactions, audit log, enqueue jobs
   ▼
Repositories (src/server/repositories)  — Drizzle queries, no rules
   ▼
PostgreSQL
Pure logic (src/lib/scoring)            — called by services; no I/O; 100 % unit-tested
```

Service calls always receive an explicit `actor` (the user) and `now` (a `Date`), so rules are testable
without a clock.

## 3. Services (one per aggregate)

| Service | Responsibilities |
|---|---|
| `term.service` | create term by copying previous; update config while unlocked; round CRUD; open/close/finalize round |
| `place.service` | classes, aliases, buildings, zones, physical rooms, class–room links, class–zone links |
| `duty.service` | assign/unassign duties and targets; freelance assignment; coverage report; Excel import |
| `evaluation.service` | create/update/delete/submit; ownership; self-edit window; evidence attach; approve/return |
| `request.service` | create/approve/reject requests; apply payload atomically |
| `result.service` | compute round results and term results through `lib/scoring`; freeze at finalize |
| `student.service` | sync from API; home class; snapshots; retention |
| `pdf.service` | enqueue render; store versions; watermark state |
| `notify.service` | inbox rows + push fan-out; subscriptions |
| `export.service` | ปพ.5 payloads; Excel exports |
| `auth.service` | login (local + external adapter), sessions, password change |
| `audit.service` | append-only audit writer |

## 4. Caching and real-time

- Public pages: `revalidate = 60` plus `revalidateTag('public-scores')` whenever an evaluation is approved or a
  round is finalized.
- Staff dashboard: server-rendered; a lightweight poll every 30 s (`/api/v1/dashboard/summary`) — no websocket
  needed at this scale (≤ 150 staff).

## 5. Configuration (`.env`)

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://zw:***@db:5432/zw` | |
| `APP_URL` | `https://zerowaste.azizstan.net` | used in push and PDF links |
| `SESSION_SECRET` | 64 random bytes base64 | |
| `INTERNAL_PDF_SECRET` | 32 random bytes | HMAC for /internal/pdf |
| `DATA_DIR` | `/data` | uploads, pdf, tmp |
| `STUDENT_API_BASE` | `https://azizstan.net/StudentCareV4/students` | |
| `STUDENT_API_TOKEN` | *** | rotate before production |
| `TEACHER_AUTH_URL` | (pending) | external auth adapter |
| `PP5_API_KEYS` | comma-separated hashed keys | |
| `PP5_ALLOWED_CIDRS` | `10.0.0.0/8,192.168.0.0/16` | |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | | `pnpm vapid:generate` |
| `TZ` | `Asia/Bangkok` | also set in containers |
| `SYNC_ABORT_RATIO` | `0.10` | FR-I2 |
| `STUDENT_RETENTION_DAYS` | `365` | FR-S2 |

## 6. Hardware budget (school PC: Core i3/i5 gen 11, 8 → 16 GB RAM, SSD)

| Container | RAM limit |
|---|---|
| db | 1 GB |
| app | 768 MB |
| worker (incl. Chromium while rendering) | 1 GB, PDF concurrency = 1 |
| cloudflared | 64 MB |
| (existing Moodle, separate) | as is |

Expected data: ~80 classes × 3 rounds × 6 images ≈ 1 500 images/term ≈ 0.5 GB after compression.
