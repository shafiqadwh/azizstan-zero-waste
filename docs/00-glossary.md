# 00 — Glossary (Thai ↔ English identifiers)

Use the English identifier in code, database, API and logs. Use the Thai term in the UI.

| Thai (UI) | English identifier | Meaning |
|---|---|---|
| ปีการศึกษา | `academic_year` | Buddhist-era year, e.g. 2569 |
| ภาคเรียน / เทอม | `term` | 1 or 2 within an academic year. All rules are configured per term |
| รอบการประเมิน | `round` | One scoring period inside a term (this term: 3 rounds) |
| ห้องเรียน | `class` | A class of students, e.g. ม.1 Amanah. Evaluated as a "room" |
| ห้องกายภาพ / หมายเลขห้อง | `physical_room`, `room_number` | The actual room in a building, e.g. 121 = building 1, floor 2, room 1 |
| อาคาร | `building` | An `area` of type `building` |
| โซน | `zone` | An `area` of type `zone` (A–Y), e.g. "ประตูใหญ่ทางเข้าโรงเรียน" |
| พื้นที่ | `area` | Zone or building — whichever the term uses |
| เป้าหมายการประเมิน | `target` | What is scored: a `class` (room score) or an `area` |
| ส่วนคะแนน | `score_component` | A configured part of the score (e.g. room 5 pts, building 10 pts) |
| คะแนนห้อง | room score | Component whose unit is `class` |
| คะแนนอาคาร / คะแนนโซน | area score | Component whose unit is `area` |
| หักคะแนน | deduction | Component of kind `deduct` (future: by area teachers) |
| เหมารวม | `group` mode | Every student in the target gets the same score |
| รายคน | `individual` mode | Each student gets their own score |
| คะแนนรอบ | round total | Sum of components for one class in one round |
| คะแนนเทอม | term score | Average of round totals, scaled to the term maximum |
| จัดอันดับ | ranking | Competition ranking (1, 1, 3) |
| คณะกรรมการประเมิน / กรรมการ | `committee` duty | A user assigned to score targets this term |
| ครูผู้รับผิดชอบพื้นที่ | `area_teacher` duty | Future: may deduct points in their area |
| ผู้อนุมัติ | `approver` duty | Admin responsible for approving a set of targets |
| ผู้บริหาร | `executive` role | View everything; scores only when given committee duty |
| ผู้ดูแลระบบ | `admin` role | Runs the term; cannot create users or grant admin |
| ผู้ดูแลสูงสุด | `super_admin` role | Everything |
| เจ้าของผลประเมิน | evaluation owner | The first committee member who saved the evaluation |
| รออนุมัติ | status `submitted` | Waiting for admin approval |
| ส่งกลับให้แก้ | status `returned` | Admin sent it back with a reason |
| อนุมัติแล้ว | status `approved` | Locked; PDF generated |
| ขออนุมัติ | `request` | Late entry, edit, move or delete after the self-edit window |
| ใบลงชื่อนักเรียน | signature sheet | Paper the students sign; photographed as evidence |
| รูปสถานที่ | site photo | Evidence photos (min/max per term) |
| คำแนะนำและข้อติชม | `comment` | Evaluator's written feedback (≤ 300 chars) |
| คำสั่งแต่งตั้ง | appointment order | Official PDF naming committees; shown on the public site |
| ปพ.5 | `pp5` | The school's grade-book program; receives term scores via API |
| ชั้นสามัญ | `general_class` | Class in the general (secular) track, from the student API |
| ชั้นศาสนา | `religious_class` | Class in the religious track (มุตะวัซซิต, ซานาวี, PR…, อก.…) |
| ห้องหลัก | `home_class` | The class whose score a student receives: general class, else religious class |
| ปวช. | vocational | Vocational certificate classes, named like "ปวช.2/1" |
| ม.1–ม.6 | grade `M1`–`M6` | Secondary grades |
| snapshot รายชื่อ | `roster_snapshot` | Frozen class membership at the moment a round opens |
