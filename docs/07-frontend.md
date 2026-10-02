# 07 — Frontend (Next.js App Router)

## 1. Route map

| Route | Audience | Screen (see 08-ux-ui §6) | Rendering |
|---|---|---|---|
| `/` | public | Home | RSC, ISR 60 s |
| `/rankings?view=term|round&round=` | public | Rankings | RSC, ISR 60 s |
| `/classes?grade=&class=` | public | Class scores | RSC + client dropdowns (URL state) |
| `/areas` · `/areas/[id]` | public | Zones/Buildings (label from term) | RSC |
| `/charts?type=class|area&id=` | public | Development chart (T32): one series, totals per round, y 0 → round maximum, tap/hover/Tab readout, table view | RSC data + a small client SVG chart (no chart library) |
| `/orders` · `/orders/[id]` | public | Appointment orders PDF viewer | RSC |
| `/guide` · `/guide/[slug]` | public | How-to | RSC (markdown) |
| `/calendar` | public (P2, T31) | Scoring calendar: round cards + month grids from round dates; `/calendar.ics` for phone calendars (24 h reminder before each close) | RSC |
| `/login` | public | Login | client form |
| `/account/password` | staff | Change password | client form |
| `/tasks` | committee | My tasks (tabs: ต้องทำ · รออนุมัติ · เสร็จ · คำขอของฉัน) | RSC + 30 s refresh |
| `/r/[qrToken]` | committee | QR entry → redirects to `/evaluate/new?target=…` | server redirect |
| `/evaluate/new?round=&component=&target=` | committee | Evaluation form | client (offline-capable) |
| `/evaluate/[id]` | committee/staff | Evaluation detail / edit / request | RSC + client |
| `/requests/new?…` | committee | Request form (sheet) | client |
| `/inbox` | staff | Notifications | RSC |
| `/admin` | admin/executive | Dashboard | RSC + 30 s poll |
| `/admin/approvals?tab=results|requests` | admin (executive read-only) | Approval queue | RSC + client |
| `/monitor?round=&status=&group=&mine=` | super admin/admin/executive: all targets · committee: own targets only | Monitor board (every target × status, incl. PDF) | RSC + 30 s poll |
| `/admin/requests?status=&type=` | admin/executive | Requests log (all requests, all statuses) | RSC, paginated |
| `/admin/settings` | admin (executive read-only) | Settings overview + readiness checklist + new-term wizard (08-ux-ui §6.20) | RSC + client sheet |
| `/admin/rounds` | admin | Round control: open early, extend close, finalize (BR-R3/R5) | RSC + actions |
| `/admin/settings/{term,students,mode,scoring,evidence,rooms,zones,classes,committee,users,notifications,documents,public,integrations,privacy}` | admin (users: super admin) | Settings pages (08-ux-ui §6.12, §6.13, §6.20–6.22) | RSC + forms |
| `/admin/audit` | admin/executive | Audit log | RSC, paginated |
| `/admin/exports` | admin/executive | Excel / merged PDF / API keys | RSC |
| `/internal/pdf/*` | worker only | PDF templates | RSC, no layout chrome |

Layouts: `(public)` top bar + bottom actions on mobile; `(committee)` app shell with bottom nav
(งานของฉัน · ติดตามสถานะ · แจ้งเตือน · บัญชี); `(admin)` sidebar ≥ 1024 px, top bar + drawer below.

## 2. Data flow

- Pages load data in Server Components through `src/server/services/*` read functions (never repositories
  directly, never `fetch` to our own API).
- Mutations: Server Actions with `useActionState`; forms use `react-hook-form` + `zodResolver` with the same
  Zod schema as the action. Optimistic UI only for "mark read" and toggles; scoring waits for the server.
- After a successful mutation: `revalidatePath` of the affected pages; public tag revalidation per 02-architecture §4.
- URL is the state for filters (grade, class, round, view) so views are shareable and back-button safe.

## 3. Committee evaluation form — technical design

1. **Entry**: from `/tasks` (one tap), from search by room number, or by scanning the door QR (`/r/[qrToken]`,
   camera via the phone's native scanner — no in-app scanner library needed; the QR is just a URL).
2. **Confirm target**: the header shows `121 · ม.1 Amanah · อาคาร 1 ชั้น 2 · รอบที่ 1` (green bar). If the
   server says another member already scored it, the form is replaced by the read-only result + "ขออนุมัติแก้ไข".
3. **Score input**: stepper (−/+ by `score_step`) + quick chips for integers 0…max (max ≤ 10 → chips; > 10 →
   numeric keypad input `inputmode="decimal"`). Value starts **empty** (FR-E2: 0 must be chosen).
4. **Photos**: `<input type="file" accept="image/*">` per tap (no `capture`: the phone offers camera **or** gallery, Q7); each photo is resized
   client-side to ≤ 2000 px JPEG 0.85 (canvas) before upload to save mobile data, then uploaded immediately
   (`POST /api/v1/uploads`) with a progress ring; server does the final processing (BR-V1).
5. **Offline draft**: the form state (score, comment, evidence ids, and not-yet-uploaded image blobs) is saved to
   IndexedDB key `draft:{round}:{component}:{target}` on every change. If offline, uploads queue and retry when
   `online` fires; the submit button shows "จะส่งเมื่อมีสัญญาณ" and submits automatically when all uploads finish
   **and** the user confirmed submit. Drafts older than 7 days are cleared.
6. **Submit**: one primary button fixed at the bottom; disabled with an inline reason until valid
   ("ต้องถ่ายรูปอีก 1 รูป"). On success → haptic (`navigator.vibrate(30)` where supported) + toast
   "ส่งแล้ว รออนุมัติ" → back to `/tasks` with the item moved to "รออนุมัติ".
7. **Edit window**: the detail page shows a countdown "แก้ไขเองได้อีก 21 ชม. 14 นาที"; after that, the edit
   buttons turn into "ขออนุมัติแก้ไข".

## 4. PWA

- `manifest.webmanifest`: name "AZIZSTAN ZERO WASTE", short_name "ZERO WASTE", start_url `/tasks`, display
  `standalone`, theme `#1D6A4E`, background `#F5F4EF`, icons 192/512/maskable generated from the "ZW" monogram (no logo file exists — Q9; 08-ux-ui §2).
- Service worker (Serwist): precache app shell + fonts; `NetworkFirst` for pages; `CacheFirst` for `/_next/static`;
  never cache `/api/v1/files`, `/api/v1/pdf`, or any staff JSON.
- Install prompt: custom button on `/tasks` ("ติดตั้งแอป") using `beforeinstallprompt` (Android/desktop); iOS
  guide sheet (08-ux-ui §6.6).

## 5. Components to build (in `src/components/app`)

| Component | Props (summary) | Notes |
|---|---|---|
| `TargetBadge` | `roomNumber, classDisplay, areaName?` | renders `121 · ม.1 Amanah`; the only way to show a target |
| `StatusPill` | `status` | icon + Thai label (08-ux-ui §4.4); never colour alone |
| `ScoreInput` | `max, step, value, onChange` | stepper + chips; keyboard: ↑/↓ step |
| `PhotoGrid` | `items, min, max, onAdd, onRemove, kind` | camera button shows remaining count |
| `DeadlineBanner` | `closesAt, now` | amber < 72 h, red after close |
| `RankList` | `rows, limit?, moreHref?` | top-3 highlight, tie ranks |
| `GradeClassPicker` | `grades, classes` | two selects side by side, URL-synced |
| `KpiTile` | `label, value, total?, tone` | status tones need icon + label |
| `ApprovalCard` | `evaluation | request` | thumbnails, old→new diff, approve/return buttons |
| `PdfViewer` | `src` | `<object type="application/pdf">` + download button + fallback link on iOS |
| `EmptyState` / `ErrorState` / `Skeleton*` | | every list uses them |
| `ConfirmSheet` | | bottom sheet on mobile, dialog on desktop |

## 6. Performance budgets
- Public home: LCP < 2.0 s on a mid-range Android over 4G; JS < 120 KB gzip on public routes (no charts there).
- `/tasks` interactive < 2.5 s; evaluation form works with 1 bar of signal (uploads resumable, drafts local).
- Images: `next/image` for logos; evidence thumbnails requested at 320 px (`/api/v1/files/{id}?w=320`).
