# 11 — Background Jobs and Notifications

## 1. Jobs (pg-boss, worker process)

| Job | Trigger | Handler summary | Retries |
|---|---|---|---|
| `round.open` | scheduled at `opens_at` (re-scheduled when dates change) | BR-R1 | 3 |
| `round.close` | at `closes_at` | BR-R2 | 3 |
| `round.remind` | at `closes_at − 72h` and `− 24h` | notify committee with open targets, admins, executives | 1 |
| `round.overdue` | at `closes_at + 1h`, then daily 08:00 while targets missing | notify owners' committee + admins | 1 |
| `students.sync` | cron `0 2 * * *` Asia/Bangkok, and admin button | BR-Y | 2 |
| `retention.run` | cron `0 3 * * *` | BR-D1..D3 | 1 |
| `retention.warn` | cron `0 8 * * *` | BR-D2 | 1 |
| `pdf.render` | on approve / finalize / applied request | 09-pdf | 3 (exp backoff) |
| `evidence.gc` | cron `0 4 * * *` | BR-V4 | 1 |
| `disk.check` | cron `15 * * * *` | measures the filesystem under `DATA_DIR`; stores `disk.last` (shown on /admin/settings/privacy); at ≥ 80 % used sends `disk_space` once per Bangkok day | 0 |
| `request.expire` | on finalize | BR-Q4 | 1 |
| `push.send` | fan-out from `notify.service` | web-push; delete subscription on 404/410 | 2 |
| `backup.db` | cron `30 1 * * *` | see 14-deployment §5 (script runs in the `db` container instead if simpler) | 1 |
| `worker.heartbeat` | every 60 s | writes heartbeat for `/api/v1/health` | – |

Rules: handlers are idempotent (safe to run twice); they receive `now` from the job start time; every handler
writes an audit row with `actor_id = null` when it changes data.

## 2. Notifications

`notify.service.send({ userIds, type, title, body, link })` → inserts `notifications` rows → enqueues
`push.send` for users with subscriptions. The in-app inbox (bell icon) always shows the row, so push is optional.

| Type | Recipients | Title (TH) | Body (TH) | Link |
|---|---|---|---|---|
| `duty_assigned` | the user | ได้รับมอบหมายเป็นกรรมการประเมิน | {n} รายการ ภาคเรียนที่ {t} | /tasks |
| `round_opened` | committee with targets | เปิดลงคะแนนรอบที่ {n} แล้ว | ลงคะแนนได้ถึง {closesAt} | /tasks |
| `round_reminder` | committee with open targets | อีก {h} ชั่วโมงปิดรับคะแนน | คุณยังเหลือ {n} รายการ | /tasks |
| `round_reminder_staff` | admins, executives | อีก {h} ชั่วโมงปิดรับคะแนน | ยังไม่มีคะแนน {n} รายการ | /admin |
| `overdue` | committee + admins | เลยกำหนดใส่คะแนน | {target} ยังไม่มีคะแนน | /tasks or /admin |
| `evaluation_submitted` | **all admins and super admins** | มีการใส่คะแนนใหม่ | {owner} ใส่คะแนน {target} ได้ {score}/{max} | /monitor |
| `evaluation_changed` | **all admins and super admins** | มีการแก้ไขผลประเมิน | {owner} แก้ไข{คะแนน {old} → {new} / รูปภาพ / ข้อติชม / ลบผลประเมิน} {target} | /monitor |
| `evaluation_returned` | owner | ผลประเมินถูกส่งกลับให้แก้ | {target}: {reason} | /evaluate/{id} |
| `request_created` | admins | มีคำขออนุมัติใหม่ | {type} · {target} | /admin/approvals?tab=requests |
| `request_decided` | requester | คำขอ{อนุมัติแล้ว/ถูกปฏิเสธ} | {target} {note} | /tasks |
| `round_complete` | admins, executives | ประเมินครบทุกรายการแล้ว | รอบที่ {n} พร้อมปิดรอบ | /admin |
| `classes_created` | admins | sync สร้างห้องเรียนใหม่ {n} ห้อง | {names} · ตรวจชื่อและเลือกห้องที่ร่วมประเมินภาคนี้ | /admin/settings/classes |
| `sync_problem` | admins | Sync รายชื่อ{ล้มเหลว/หยุดอัตโนมัติ} | {reason} | /admin/settings/students |
| `disk_space` | super admin, admins | พื้นที่ดิสก์ใกล้เต็ม (ใช้ไป {p}%) | เหลือ {free} จาก {total} … | /admin/settings/privacy |
| `retention_warning` | super admin, admins | ข้อมูลภาคเรียน {term} จะถูกลบใน 30 วัน | ดาวน์โหลดข้อมูลเก็บถาวรได้ก่อนวันที่ {date} | /admin/settings/privacy |

Quiet hours: no push between 21:00 and 06:00 Bangkok time (held and sent at 06:00; inbox unaffected).
Batching: at most one push per user per type per 10 minutes; later ones only go to the inbox. For
`evaluation_submitted` / `evaluation_changed` the batched push reads "มีการใส่/แก้ไขคะแนนใหม่ {n} รายการ".
Admins can mute these two types per device in /account (inbox and the monitor's activity feed still show them).
`evaluation_changed` fires on: owner self-edit of score, photos or comment; owner delete; resubmit after return;
and any approved request that changes an evaluation.

## 2b. Activity feed (monitor)
The monitor board's right panel lists the latest 50 events of the selected round from `audit_logs`
(actions `evaluation.submit|update|delete|resubmit|approve|return`, `request.create|approve|reject`), newest first,
polled every 30 s (`GET /api/v1/monitor/activity?round=&since=`). Same scope rule as the board.

## 3. Web Push setup
- VAPID keys in `.env`. Service worker `sw.ts` (Serwist) handles `push` → `showNotification(title, {body,
  icon:'/icons/icon-192.png', badge:'/icons/badge-72.png', data:{link}})` and `notificationclick` → focus/open link.
- Permission is requested **only** after a user taps "เปิดการแจ้งเตือน" on /tasks or /admin (never on page load).
- iOS: show the "เพิ่มไปยังหน้าจอโฮม" guide when `navigator.standalone !== true` on iOS Safari
  (08-ux-ui §6.6).
