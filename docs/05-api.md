# 05 — API and Server Actions

Two surfaces:
1. **Server Actions** — used by the app UI. Typed with Zod, return `Result<T>`.
2. **REST `/api/v1`** — for external systems (ปพ.5), health checks, uploads, polling. JSON, versioned.

## 1. Conventions

```ts
type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; field?: string } };
```

| ErrorCode | HTTP | When | Thai message (UI) |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | no/expired session | กรุณาเข้าสู่ระบบอีกครั้ง |
| `FORBIDDEN` | 403 | policy denied | คุณไม่มีสิทธิ์ทำรายการนี้ |
| `NOT_FOUND` | 404 | | ไม่พบข้อมูล |
| `VALIDATION` | 422 | Zod / rule failure; `field` set | (per field, see 08-ux-ui §9) |
| `ALREADY_EVALUATED` | 409 | BR-P3/P5 | ห้องนี้ประเมินแล้วโดย {name} เมื่อ {time} |
| `ENTRY_CLOSED` | 409 | BR-P2 | เลยกำหนดใส่คะแนนแล้ว กด "ขออนุมัติใส่คะแนน" |
| `EDIT_WINDOW_PASSED` | 409 | BR-E2 | เกิน 24 ชั่วโมงแล้ว กด "ขออนุมัติแก้ไข" |
| `CONFIG_LOCKED` | 409 | BR-TM2 | เทอมนี้มีผลประเมินแล้ว แก้การตั้งค่าไม่ได้ |
| `ROUND_NOT_COMPLETE` | 409 | BR-R3 | ยังปิดรอบไม่ได้ เหลือ {n} รายการ |
| `CONFLICT` | 409 | optimistic lock (`version` mismatch) | มีคนแก้ไขข้อมูลนี้ก่อนหน้า กรุณาโหลดใหม่ |
| `RATE_LIMITED` | 429 | login, uploads | ลองใหม่อีกครั้งในอีกสักครู่ |

Every mutating input carries `expectedVersion` where the entity has a `version`.

## 2. Server actions (grouped by file in `src/app/**/actions.ts`)

### Auth
| Action | Input | Output | Policy |
|---|---|---|---|
| `login` | `{username, password}` | `{redirectTo}` | public; 5 attempts / 15 min / IP+username |
| `logout` | – | – | session |
| `changePassword` | `{current, next}` | – | local accounts |

### Committee
| Action | Input | Output | Policy |
|---|---|---|---|
| `getMyTasks` (RSC loader) | `{roundId?}` | `TaskItem[]` (target, component, status, owner, deadlines) | committee duty |
| `findTarget` | `{q}` (room number, "ม.1 Amanah", or qrToken) | `TargetRef[]` | committee duty |
| `uploadEvidence` → REST `POST /api/v1/uploads` | multipart `file`, `kind`, `targetRef` | `{evidenceId, url, capturedAt}` | committee duty on target |
| `submitEvaluation` | `{roundId, componentId, target, score?, studentScores?, siteEvidenceIds[], signatureEvidenceId, comment?}` | `EvaluationDTO` | BR-P1..P3, BR-E1 |
| `updateEvaluation` | `{id, expectedVersion, score?, siteEvidenceIds?, signatureEvidenceId?, comment?}` | `EvaluationDTO` | owner + BR-E2 |
| `deleteEvaluation` | `{id, expectedVersion}` | – | owner + BR-E5 |
| `resubmitEvaluation` | `{id, expectedVersion, …same as update}` | `EvaluationDTO` | owner, status returned |
| `createRequest` | `{type, roundId, componentId, target?, evaluationId?, reason, payload}` | `RequestDTO` | §6 of business rules |
| `cancelRequest` | `{id}` | – | requester, status waiting |

### Admin
| Action | Input | Policy |
|---|---|---|
| `createTerm` | `{academicYear, termNo, copyFromTermId, copyDuties}` | admin |
| `updateTermConfig` | `{termId, …config, components[]}` | admin, BR-TM2 |
| `activateTerm` | `{termId}` | admin |
| `upsertRound` / `deleteRound` | `{termId, roundNo, opensAt, closesAt}` | admin, BR-R5 |
| `finalizeRound` | `{roundId}` | admin, BR-R3 |
| `upsertArea` / `upsertPhysicalRoom` / `upsertClass` / `addClassAlias` | … | admin |
| `linkClassRoom` | `{classId, physicalRoomId, effectiveFrom}` (closes previous link at the same date) | admin |
| `setTermClasses` | `{termId, classIds[]}` (replaces the selection; rejected once config is locked) | admin, FR-P7 |
| `setClassZone` | `{termId, classId, areaId}` | admin |
| `editRoundClassArea` | `{roundId, classId, areaId}` | admin, BR-R4 |
| `assignDuty` / `removeDuty` | `{termId, userId, duty, target?, isFreelance, validUntil?}` | admin |
| `importDutiesExcel` | file (template in 10-integrations §4) → dry-run report → `commit` | admin |
| `approveEvaluation` / `returnEvaluation` | `{id, expectedVersion, reason?}` | admin / approver (BR-E6/E7) |
| `approveRequest` / `rejectRequest` | `{id, note?, grantHours?}` | admin (BR-Q*) |
| `runStudentSync` | `{source?}` | admin |
| `resolveStudentReview` | `{studentId, action: 'alias' | 'ignore', classId?}` | admin |
| `uploadAppointmentOrder` / `reorder` / `delete` | … | admin |
| `upsertGuidePage` | `{slug, title, bodyMd, audience}` | admin |
| `createApiKey` / `revokeApiKey` | `{name}` → shows key once | admin |

### Super admin
| Action | Input |
|---|---|
| `createUser` | `{username, displayName, role, authSource, tempPassword?}` |
| `setUserRole` | `{userId, role}` (only super admin may grant admin/super_admin) |
| `setUserActive` | `{userId, active}` |
| `resetPassword` | `{userId}` → temporary password shown once, `must_change_password = true` |

## 3. REST `/api/v1`

### 3.1 Public (no auth, cached 60 s)
| Method | Path | Response |
|---|---|---|
| GET | `/public/summary` | `{term, currentRound:{no,status,closesAt}, progress:{classesDone,classesTotal,areasDone,areasTotal}}` |
| GET | `/public/rankings?view=round|term&roundNo=` | `{groups:[{group:'ม.1', rows:[{rank, classId, display:'ม.1 Amanah', roomNumber:'121', score:'14.50'}]}], areas:[…]}` |
| GET | `/public/classes?grade=` | `[{classId, display, roomNumber}]` |
| GET | `/public/classes/{id}/scores?termId=` | `{rounds:[{no, classScore, areaScore, total}], termScore}` |
| GET | `/public/areas/{id}/scores?termId=` | `{rounds:[{no, score}], termScore}` |
| GET | `/public/series?type=class|area&id=` | `[{roundNo, total}]` of the active term, for charts |
| GET | `/public/orders` | `[{id, title, url}]` |

Scores are strings with 2 decimals. Only approved data (FR-W7). No evaluator names, no photos.

### 3.2 Staff (session cookie)
| Method | Path | Notes |
|---|---|---|
| POST | `/uploads` | multipart; returns evidence id; max 15 MB; rate 30/min/user |
| GET | `/files/{evidenceId}` | streams WebP; policy: staff (admin/executive/owner/committee of target) |
| GET | `/pdf/{pdfId}` | streams PDF; staff |
| GET | `/dashboard/summary` | polled every 30 s |
| GET | `/monitor/board?round=&status=&group=&area=&committee=&q=&mine=` | rows for `/monitor`; scope per 06-auth `monitor.read` |
| GET | `/monitor/activity?round=&since=` | activity feed (11-jobs §2b) |
| GET | `/monitor/targets/{class|area}/{id}?round=` | popover: assigned committee, owner, status, approver, PDF, waiting request |
| POST | `/push/subscribe` / `/push/unsubscribe` | Web Push subscription JSON |
| GET | `/exports/term/{termId}.xlsx` | admin/executive |
| GET | `/exports/round/{roundId}/pdfs.pdf` | merged PDFs (P2) |

### 3.3 ปพ.5 (API key in `Authorization: Bearer <key>`, source IP in `PP5_ALLOWED_CIDRS`)
| Method | Path | Response |
|---|---|---|
| GET | `/pp5/terms` | `[{termId, academicYear, termNo, finalMax, roundsFinalized, roundsTotal}]` |
| GET | `/pp5/terms/{termId}/classes` | per class (group mode) |
| GET | `/pp5/terms/{termId}/students` | per student (requires student-level data; 404 `NOT_AVAILABLE` otherwise) |

**Format — CSV by default (decided 2026-10-01):** every `/pp5/*` endpoint answers `text/csv; charset=utf-8`
(UTF-8 with BOM, CRLF, RFC 4180 quoting, `Content-Disposition: attachment`). Add `?format=json` to get the JSON
shown below instead. Errors are always JSON `{error}` with the HTTP status (401 key, 403 network, 404).
The CSV has fixed columns — one row per class (or student) per finalized round, the term score repeated:

| Endpoint | Columns |
|---|---|
| `/pp5/terms` | `term_id, academic_year, term_no, final_max, rounds_finalized` (e.g. `1\|2`)`, rounds_total` |
| `/pp5/terms/{termId}/classes` | `academic_year, term_no, term_complete, final_max, class_id, track, grade, class_name, display, source_class_key, round_no, class_score, area_score, round_total, term_score` |
| `/pp5/terms/{termId}/students` | `academic_year, term_no, term_complete, student_code, home_class_key, round_no, class_key, round_total, term_score` |

A class without any finalized round still has one row, with empty round columns.

JSON (`?format=json`) for `/pp5/terms/{termId}/classes`:
```json
{
  "academicYear": 2569, "termNo": 2, "finalMax": "15.00",
  "roundsFinalized": [1, 2, 3], "roundsTotal": 3, "termComplete": true, "generatedAt": "2026-12-20T09:00:00+07:00",
  "classes": [
    { "classId": "…", "track": "general", "grade": "ม.1", "name": "Amanah", "display": "ม.1 Amanah",
      "sourceClassKey": "ม.1/1 Amanah",
      "rounds": [ { "roundNo": 1, "classScore": "4.00", "areaScore": "9.00", "total": "13.00" } ],
      "termScore": "13.00" }
  ]
}
```
`sourceClassKey` is the class string as it appears in the student API, so the ปพ.5 program can join on it.
`/students` returns `{ studentCode, homeClassKey, rounds:[{roundNo, classKey, total}], termScore }` — **no names**.
Only finalized rounds are included (FR-I4). `termComplete` is true when every round of the term is finalized —
the ปพ.5 program should import final grades only then.

### 3.4 Health
`GET /api/v1/health` → `{status:'ok', db:'ok', worker:{lastHeartbeat}, version}` (no auth; no secrets).
