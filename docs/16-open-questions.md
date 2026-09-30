# 16 — Open Questions (with the default to implement until answered)

Agents: implement the **default**, mark the code with `// OPEN-QUESTION: Qn`, and do not invent other behaviour.

| ID | Question | Default until answered | Affects |
|---|---|---|---|
| Q1 | Teacher login API: URL, request/response, how to identify the teacher | Local accounts only; `ExternalAuthProvider` stub returns `unavailable` | T33, 06-auth §1.2 |
| Q2 | When committee and teacher both score the same room (future term): use committee only, or combine? | Committee value only; teacher score stored but not counted | T42 |
| Q3 | Only super admin creates users? (earlier note said executives could create users) | **Answered:** only super admin creates users and sets roles (admin/executive/teacher); admin assigns committee duty | T12 |
| Q4 | Area-teacher deductions: max per round, per student or per class, anytime or once per round, photo required? | Not built (phase 3) | T41 |
| Q5 | Retention of evidence photos and PDFs | **Answered:** all term data kept 1 year after the term closes, then deleted (BR-D1..D4) | T28 |
| Q6 | QR codes on classroom doors? | Build the `/r/[qrToken]` route (cheap); printing sheet in phase 2 | T19, T34 |
| Q7 | May site photos come from the gallery, or camera only? Signature sheet? | Site: camera only (`capture`). Signature: camera or gallery | T19 |
| Q8 | May admins activate/deactivate teacher accounts and reset passwords of non-admins? | No (super admin only) | T12 |
| Q9 | High-resolution logo (SVG or transparent PNG) and a symbol-only version for app icon | Use the provided 280×310 JPG; generate icons by cropping | T00, T26 |
| Q10 | Is a per-target approver needed, or can any admin approve anything? | Any admin; `approver` duty optional (if set, restricts) | T18 |
| Q11 | After "ส่งกลับให้แก้", how long can the owner edit? | New window of `self_edit_hours` from the return time | T18 |
| Q12 | Building/zone evaluation: who signs the signature sheet (many classes share one area)? | **Answered:** no signature for building/zone evaluations (`requires_signature = false`) | T19, T22 |
| Q13 | Ranking group for religious classes: one group "สายศาสนา" or by year (มุตะวัซซิต/ซานาวี)? | One group "สายศาสนา" | T24 |
| Q14 | Student API: rotated token, reduced columns, token in header | Works with the current endpoint; token from `.env` | T25 |
| Q15 | List of buildings and room numbers; which class is in which room for 2/2569 | **Answered:** super admin/admin enter buildings and room numbers each term (UI or `rooms.xlsx`) | T13 |
| Q16 | Production hostname (e.g. `zerowaste.azizstan.net`) | Configurable `APP_URL` | T29 |
| Q18 | Import term 1/2569 scores from the old Google Sheets so charts start from 1/2569? | **Answered:** no import; terms are independent, charts show the current term only | T24 |
| Q19 | Exact class string format of vocational students in `ExportVoc` (ชั้นสามัญ column) | Resolve through aliases; unknown → review list | T25 |
| Q17 | Is a class's building score its **own** building's evaluation, even when the class moved buildings mid-round? | Building frozen at round open (`round_class_areas`), admin can correct | T16 |
