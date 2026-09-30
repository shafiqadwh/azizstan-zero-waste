# AGENTS.md — AZIZSTAN Zero Waste

Instructions for any AI coding agent (Claude Code, Codex, Cursor, Gemini, etc.) working in this repository.
Read this file completely before writing code. Then read the docs listed under "Read order".

## 1. What this system is

AZIZSTAN Zero Waste is a web application (PWA) for Azizstan Foundation School (โรงเรียนมูลนิธิอาซิซสถาน), Thailand.
Committees score the cleanliness of **classrooms** and of **areas** (zones or buildings) several times per term.
Scores are approved by an Admin, turned into an official one-page A4 PDF, ranked publicly, and exported to the
school's separate grade-book program (ปพ.5), where the score counts in every subject.

The rules change every term. **Nothing that is a school rule may be hard-coded.** Every rule is term configuration.

## 2. Read order

1. `docs/00-glossary.md` — Thai ↔ English terms. Use these English identifiers in code.
2. `docs/01-requirements.md` — what the school decided. Source of truth for behaviour.
3. `docs/04-business-rules.md` — exact algorithms and state machines. Source of truth for logic.
4. `docs/03-database.md` + `db/schema.ts` — data model.
5. The doc for the area you are working on (API, frontend, UX/UI, jobs, PDF, integrations, deployment).
6. `docs/15-roadmap.md` — pick the next ticket; every ticket lists its acceptance criteria.

If two docs disagree, precedence is: `01-requirements` > `04-business-rules` > everything else.
If a question is listed in `docs/16-open-questions.md`, do not guess: implement the stated default and leave a
`// OPEN-QUESTION: Qn` comment at the decision point.

## 3. Stack (do not substitute without asking)

| Concern | Choice |
|---|---|
| Language | TypeScript (strict), Node.js 22 LTS |
| Web + API | Next.js (App Router), React Server Components, Route Handlers for the public/external API |
| Mutations from UI | Server Actions that call the service layer (never query the DB from a component) |
| Database | PostgreSQL 16 |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations committed) |
| Validation | Zod — one schema per input, shared by server action and client form |
| Job queue / cron | pg-boss (jobs stored in PostgreSQL), run by a separate `worker` process |
| Images | sharp (resize, EXIF strip, timestamp stamp) |
| PDF | Playwright (Chromium) renders an internal HTML route to PDF |
| Push | `web-push` (VAPID), no Firebase |
| PWA | Serwist (service worker), IndexedDB (`idb-keyval`) for offline drafts |
| UI | Tailwind CSS + shadcn/ui (Radix primitives), lucide-react icons |
| Fonts | IBM Plex Sans Thai (UI), Sarabun (PDF). Self-hosted via `next/font/local` — the server may be offline from Google |
| Charts | Recharts |
| Tests | Vitest (unit/integration), Playwright (e2e) |
| Package manager | pnpm |
| Deploy | Docker Compose (`app`, `worker`, `db`, `cloudflared`) |

## 4. Repository layout

```
/src
  /app                    Next.js routes (see docs/07-frontend.md for the full route map)
    /(public)             no login
    /(committee)          committee mobile flow  (/tasks, /evaluate/...)
    /(admin)              admin + executive desktop (/admin/...)
    /api/v1               external REST API (ปพ.5 export, health)
    /internal/pdf         HTML pages rendered to PDF (not linked, token-protected)
  /server
    /services             business logic, one file per aggregate (evaluation.service.ts ...)
    /repositories         Drizzle queries only
    /auth                 session, password, external-auth adapter
    /policies             permission checks (can(user, action, resource))
    /jobs                 pg-boss job handlers
  /lib
    /scoring              PURE functions: totals, averages, ranks, rounding (reference impl provided)
    /validation           Zod schemas
    /dates                Asia/Bangkok helpers
  /components             UI components (ui/ = shadcn, app/ = product components)
/db
  schema.ts               Drizzle schema (provided — extend, do not rewrite)
  /migrations
/worker                   entry point for the worker process
/deploy                   docker-compose.yml, Dockerfile, backup scripts
/docs                     specifications (this package)
```

## 5. Rules for agents

1. **Business logic lives in `src/server/services` and `src/lib/scoring`.** Components and route handlers stay thin.
2. **Every mutation checks permission through `src/server/policies`**, then validates input with Zod, then runs in a
   DB transaction, then writes one `audit_log` row. No exceptions.
3. **Time**: store `timestamptz` in UTC; all rule comparisons (deadlines, 24-hour window) use server time;
   display in `Asia/Bangkok` with Buddhist-era years (พ.ศ.) in Thai UI.
4. **Numbers**: scores are `numeric(6,3)` in the DB and handled as integers of thousandths in code
   (`src/lib/scoring/decimal.ts`). Never use floating point for scores. Round only for display/export: half-up, 2 places.
5. **Never store student national ID, date of birth, parent name or phone.** The student importer reads only
   `รหัสนักเรียน`, `ชื่อ-สกุลนักเรียน`, `ชั้นสามัญ`, `ชั้นศาสนา`. Never write the raw CSV to disk.
6. **Never show student names in any UI this term.** Student data exists only for storage and ปพ.5 export.
7. **Thai UI copy** comes from `docs/08-ux-ui.md` §9. Do not invent new wording for statuses; reuse the copy table.
8. **Accessibility**: real `<button>`/`<a>`/`<label>`; touch targets ≥ 44 px; status never by colour alone.
9. **Tests**: every rule in `docs/04-business-rules.md` has a golden test in `docs/13-testing.md`. A ticket is not
   done until its tests pass.
10. Do not add dependencies outside §3 without writing the reason in the PR description.
11. Secrets only in `.env` (see `.env.example`). Never commit real tokens. The student-API token in chat history
    must be rotated before production (see open questions).

## 6. Commands

```
pnpm install
pnpm db:generate      # drizzle-kit generate
pnpm db:migrate       # apply migrations
pnpm db:seed          # dev seed: 1 term, 3 rounds, rooms, zones, users (no real student data)
pnpm dev              # next dev
pnpm worker:dev       # pg-boss worker with watch
pnpm test             # vitest
pnpm test:e2e         # playwright
pnpm lint && pnpm typecheck
docker compose -f deploy/docker-compose.yml up -d
```

## 7. Definition of done (every ticket)

- Acceptance criteria in `docs/15-roadmap.md` met.
- Unit tests for new logic; e2e for new user flows. `pnpm lint && pnpm typecheck && pnpm test` green.
- Permission check + audit log on every mutation.
- Empty, loading and error states implemented for every new screen (see `docs/08-ux-ui.md` §7).
- Works at 360 px wide and at 1440 px wide.
- No student personal data leaves the server, no student names rendered.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
