# 16 — Open Questions (with the default to implement until answered)

Agents: implement the **default**, mark the code with `// OPEN-QUESTION: Qn`, and do not invent other behaviour.

| ID | Question | Default until answered | Affects |
|---|---|---|---|
| Q1 | Teacher login API: URL, request/response, how to identify the teacher | **Answered 2026-09-30:** no API details yet. Local accounts only; `ExternalAuthProvider` stub returns `unavailable`; revisit in T33 | T33, 06-auth §1.2 |
| Q2 | When committee and teacher both score the same room (future term): use committee only, or combine? | Undecided (owner, 2026-09-30). Committee value only; teacher score stored but not counted | T42 |
| Q3 | Only super admin creates users? (earlier note said executives could create users) | **Answered:** only super admin creates users and sets roles (admin/executive/teacher); admin assigns committee duty | T12 |
| Q4 | Area-teacher deductions: max per round, per student or per class, anytime or once per round, photo required? | **Answered 2026-09-30:** decide in phase 3. Not built | T41 |
| Q5 | Retention of evidence photos and PDFs | **Answered:** all term data kept 1 year after the term closes, then deleted (BR-D1..D4) | T28 |
| Q6 | QR codes on classroom doors? | **Answered 2026-09-30:** build the `/r/[qrToken]` route now; printing sheet in phase 2 | T19, T34 |
| Q7 | May site photos come from the gallery, or camera only? Signature sheet? | **Answered 2026-09-30:** **every** evaluation photo (site photos and signature sheet) may be taken live **or** picked from the gallery — committees sometimes evaluate where there is no internet. No `capture` attribute on the file input | T19 |
| Q8 | May admins activate/deactivate teacher accounts and reset passwords of non-admins? | **Answered 2026-09-30:** no — super admin only | T12 |
| Q9 | High-resolution logo (SVG or transparent PNG) and a symbol-only version for app icon | **Answered 2026-09-30:** the school has **no** logo file (no SVG/PNG, no JPG). Use a text wordmark "AZIZSTAN Zero Waste"; generate app icon/favicon from the letters "ZW" on `brand`. Swap in a real logo if one is provided later | T00, T26 |
| Q10 | Is a per-target approver needed, or can any admin approve anything? | **Answered 2026-09-30:** any admin; `approver` duty optional (if set, restricts) | T18 |
| Q11 | After "ส่งกลับให้แก้", how long can the owner edit? | **Answered 2026-09-30:** new window of `self_edit_hours` from the return time | T18 |
| Q12 | Building/zone evaluation: who signs the signature sheet (many classes share one area)? | **Answered:** no signature for building/zone evaluations (`requires_signature = false`) | T19, T22 |
| Q13 | Ranking group for religious classes: one group "สายศาสนา" or by year (มุตะวัซซิต/ซานาวี)? | **Answered 2026-09-30:** one religious group "ซานาวี". มุตะวัซซิต classes are removed from the system. Only some ซานาวี classes take part, so admins choose each term which classes are used (FR-P7, `term_classes`); a new academic year starts with no selection. Religious-only มุตะวัซซิต students are skipped silently by the student sync (BR-Y step 4a, `class_skip_rules`) | T24 |
| Q14 | Student API: rotated token, reduced columns, token in header | **Answered 2026-09-30:** not rotated/changed yet. Works with the current endpoint; token from `.env`. Token must still be rotated before production | T25 |
| Q15 | List of buildings and room numbers; which class is in which room for 2/2569 | **Answered:** super admin/admin enter buildings and room numbers each term (UI or `rooms.xlsx`) | T13 |
| Q16 | Production hostname (e.g. `zerowaste.azizstan.net`) | **Answered 2026-09-30:** `https://zerowaste.azizstan.net` (`APP_URL`) | T29 |
| Q18 | Import term 1/2569 scores from the old Google Sheets so charts start from 1/2569? | **Answered:** no import; terms are independent, charts show the current term only | T24 |
| Q19 | Exact class string format of vocational students in `ExportVoc` (ชั้นสามัญ column) | **Answered 2026-09-30:** format unknown. Resolve through aliases; unknown → review list | T25 |
| Q17 | Is a class's building score its **own** building's evaluation, even when the class moved buildings mid-round? | **Answered 2026-09-30:** building frozen at round open (`round_class_areas`), admin can correct | T16 |
