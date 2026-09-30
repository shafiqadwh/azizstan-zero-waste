# 10 — Integrations and Reference Data

## 1. Student API (existing school system)

### 1.1 Endpoints
| Track | URL | Params |
|---|---|---|
| General (ม.1–ม.6 + religious column) | `GET {STUDENT_API_BASE}/Export` | `token`, `academic_year` (2569), `term_id` (1/2) |
| Vocational (ปวช.) | `GET {STUDENT_API_BASE}/ExportVoc` | same |

Response: `text/csv`, UTF-8 with BOM, header row, 11 columns:

| # | Header | Imported? |
|---|---|---|
| 0 | รหัสนักเรียน | **yes** → `student_code` |
| 1 | ชื่อ-สกุลนักเรียน | **yes** → `full_name` (never displayed) |
| 2 | ชั้นสามัญ | **yes** → general class, e.g. `ม.1/1 Amanah` |
| 3 | ชั้นศาสนา | **yes** → religious class, e.g. `PR 1/1 Amanah`, `อก.1/3 Cergas` |
| 4 | เพศ | no |
| 5 | เลขประจำตัวประชาชน | **no — must never be read into a variable that outlives the row** |
| 6 | วันเดือนปีเกิด | no |
| 7 | จังหวัด | no |
| 8 | ชื่อ-สกุลผู้ปกครอง | no |
| 9 | เบอร์ติดต่อผู้ปกครอง | no (this column sometimes contains extra commas → see BR-Y 9.1 step 3) |
| 10 | ชื่อ-สกุลผู้ประสานงาน | no |

Known data problems (seen in the 2569/1 file): line breaks inside the province field; two phone numbers separated
by a comma without quotes; empty cells; text instead of a phone number. The parser must survive all of them.

### 1.2 Security notes
- The token is a query parameter and grants full personal data. Store it only in `.env`. Never log request URLs.
- Ask the school to (a) rotate the token before production, (b) provide an endpoint returning only the 4 needed
  columns, (c) accept the token in a header. Code must work with the current endpoint meanwhile.

### 1.3 Home class and religious-only students
`home_class = general class if the ชั้นสามัญ cell is non-empty, else religious class` (FR-R10). Students with
neither → `review`.

### 1.4 Class register seed (from appointment order 23/2569, term 1/2569 — verify each term)

| Rank group | Track | Classes (display name) |
|---|---|---|
| ม.1 | general | Amanah, Berdikari, Cergas, Dedikasi, Fatanah, Hormat, Ikhlas, Mulia, Patuh, Usaha, Wawasan, Yakin |
| ม.2 | general | same 12 + Zikir |
| ม.3 | general | Amanah, Berdikari, Cergas, Dedikasi, Fatanah, Hormat, Ikhlas, Mulia, Patuh, Usaha, Wawasan, Yakin |
| ม.4 | general | Intan, Delima, Nilam, Kristal, Al-Khawarizmi, Ash-Shafi'i, Al-Biruni, Amber, Mutiara, Topaz, Berlian |
| ม.5 | general | Intan, Delima, Nilam, Kristal, Al-Khawarizmi, Ash-Shafi'i, Al-Biruni, Amber, Mutiara, Topaz |
| ม.6 | general | Intan, Delima, Nilam, Kristal, Al-Khawarizmi, Ash-Shafi'i, Al-Biruni, Amber, Mutiara, Topaz |
| สายศาสนา | religious | มุตะวัซซิต ปี 1 Al-Taqwa (1M), มุตะวัซซิต ปี 2 Al-Istiqamah (2M), ซานาวี ปี 2 Al-Bukhari (2S), ซานาวี ปี 2 Muslim (2S), ซานาวี ปี 3 Al-Bukhari (3S), ซานาวี ปี 3 Muslim (3S) |
| ปวช. | vocational | ปวช.1/1, ปวช.2/1, ปวช.2/2, ปวช.3/1, ปวช.3/2 |

Total 79 classes. Room numbers (`roomNo`) follow the order listed. Seed aliases:
`Usaha(Ijtihad)`→Usaha, `Iklas`→Ikhlas, `At-Takwa`/`Al-Taqwa`/`1M Al-Taqwa`→Al-Taqwa, `Biruni`→Al-Biruni,
`Al-khawarizmi`→Al-Khawarizmi, `Ash-Shafi’i` (curly)→Ash-Shafi'i, `2M Al-Istiqamah`, `2S Muslim`, `3S Al-bukhari`…

### 1.5 Zones seed (term 1/2569)
| Code | Area |
|---|---|
| A | ประตูใหญ่ทางเข้าโรงเรียน หน้าถนน ประตูหอพักชายถึงหน้ากูโบร์ |
| B | ลานจอดรถนักเรียนชาย ถึงถนนหน้าบอร์ดประกาศ |
| C | อาคารวิทยาลัยเทคโนโลยีอาซิซสถาน ชั้น 1–2, บอร์ดประชาสัมพันธ์กลาง, ที่จอดรถและประตูทางเข้าอาคาร ปวช. |
| D | ใต้ต้นประดู่, สนามปิงปอง, หน้าเสาธง, สนามบาสเก็ตบอล |
| E | ชั้นล่างอาคาร 1 หน้าห้องสมุด, ห้องประชุมอาคาร 1, หน้าห้องผู้บริหาร, ลานจอดรถ, ถนนหน้ามุกเสาธงถึงห้องสมุด |
| F | ชั้นล่างอาคาร 1 ฝั่งห้องสัมพันธ์ชุมชน–ห้องธุรการการเงิน–ห้องบุคลากร–ห้องวิชาการ–ห้องพักครูศาสนา, ลานจอดรถ, ถนนถึงทางเข้าสนามบอลฝั่งน้ำตก |
| G | สวนน้ำตก, ห้องน้ำบุคลากรหญิง, หน้าห้องพักครูหญิง, ห้องแนะแนว, หน้าห้องพักครูชาย, จุดบริการน้ำดื่ม |
| H | หน้าอาคาร 2–3, ศูนย์ภาษา, ห้องพยาบาล, ห้องน้ำนักเรียนหญิง, หน้าอาคาร 4 สหกรณ์ชายและลานข้างสหกรณ์ชาย |
| I | โรงอาหารหญิงใต้มูซอลลาหญิง, ทางเดินระหว่างโรงอาหาร, โรงอาหารฝั่งกำแพง |
| J | บนมูซอลลาหญิง, บันไดมูซอลลาหญิงทั้ง 2 ฝั่ง, ที่เอาน้ำละหมาดหญิง |
| K | ถนนทางเข้าโรงอาหารฝั่ง ปวช., ลานอเนกประสงค์โรงอาหารหญิงหลังห้องสมุดถึงประตูสหกรณ์หญิง |
| L | มูซอลลาหญิงใต้อาคาร 5, บันไดทุกชั้นฝั่งห้องเรียน AEP, หน้าห้องคอมพิวเตอร์ 4, หน้าห้องประชุมและหลังอาคาร 5 |
| M | โรงอาหารชาย, ลานจอดรถหน้าอาคาร 5, คูน้ำทั้ง 2 ฝั่ง |
| N | ทางเดินหลังโรงอาหารชาย, ลานอเนกประสงค์ใกล้จุดขายน้ำดื่มชาย, รอบมัสยิดหลังอาคาร 5 ถึงรั้วโรงเรียน |
| O | มูซอลลาชาย, ลานมูซอลลา, ห้องน้ำนักเรียนชาย (ใหม่) |
| P | ลานอเนกประสงค์หลังอาคาร 5 ใกล้โรงผลิตน้ำดื่ม |
| Q | หน้า–หลังอาคาร 6 ห้องปฏิบัติการ บันได ทางเดิน ห้องน้ำนักเรียนและครู ข้างโรงยิม |
| R | โรงยิมเนเซียมภายในและหน้าโรงยิม, ห้องน้ำนักเรียนชายฝั่งห้องพยาบาล, หน้าห้องพักครูพละ |
| S | ถนน 3 แยกทางขึ้นน้ำตก, ประตูทางออก, โรงเรือนไฮโดรโพนิกส์, โรงองุ่น, คูน้ำข้างอาคาร 6 |
| T | สวนสัตว์, ทางเดินหลังกรงนก, คูน้ำฝั่งหน้าโรงยิม, สวนหย่อมบน–หน้าน้ำตก |
| U | บันไดอาคาร 1 ฝั่งห้องสัมพันธ์ชุมชนและฝั่งห้องวิชาการ ทุกชั้น |
| V | บันไดอาคาร 1 ฝั่งห้องสมุดและฝั่งห้องปกครอง ทุกชั้น |
| W | บันไดกลางอาคาร 5 และบันไดฝั่งมูซอลลาชาย ทุกชั้น |
| X | อัฒจันทร์ทั้งหมด (ฝั่งกูโบร์ถึงโรงเกษตร), สนามฟุตบอล, สนามซ้อมฟุตบอล |
| Y | รอบอาคารศิลปะ และลานหน้าอาคารศิลปะ |

Buildings and physical room numbers: to be entered by the admin (not in the order).

## 2. Teacher authentication API
Pending (Q1). Implement against `ExternalAuthProvider` (06-auth §1.2). Preferred contract to propose to the school:
```
POST {TEACHER_AUTH_URL}/verify   Authorization: Bearer <server key>
{ "username": "…", "password": "…" }
→ 200 { "ok": true, "externalId": "T0123", "displayName": "…" }
→ 200 { "ok": false }            (wrong credentials)
```
The school system never returns a password hash; this system never stores the password.

## 3. ปพ.5 program (school-built, other team)
- Pull model; endpoints in 05-api §3.3. Hand the ปพ.5 team: base URL, one API key, the JSON examples, and the
  rule "only finalized rounds are included; re-pull after each finalize".
- Join key for group mode: `sourceClassKey` (the exact class string of the student API, e.g. `ม.1/1 Amanah`).
- Fallback: `GET /api/v1/exports/term/{termId}.xlsx` sheet `ปพ5` with the same columns.

## 4. Excel templates (download from the admin UI; import with dry-run)

### 4.1 `duties.xlsx` — one row per (committee member, target)
| username | ชื่อ (for humans, ignored) | หน้าที่ (`committee`/`approver`) | ประเภทเป้าหมาย (`ห้อง`/`โซน`/`อาคาร`) | เป้าหมาย |
|---|---|---|---|---|
| t.kamal | … | committee | โซน | X |
| t.kamal | … | committee | ห้อง | 121 |
| t.kamal | … | committee | ห้อง | ม.1 Usaha |

"เป้าหมาย" for rooms accepts a room number **or** a class name (resolved via aliases). Dry-run reports
unknown users, unknown targets, duplicates, and classes/areas left without any committee.

### 4.2 `rooms.xlsx` — physical rooms and links
| อาคาร | หมายเลขห้อง | ชั้น | ห้องเรียน (optional) | มีผลตั้งแต่ |
|---|---|---|---|---|
| 1 | 121 | 2 | ม.1 Amanah | 2026-11-01 |

### 4.3 `zones.xlsx` — zone responsibilities per term
| โซน | คำอธิบายพื้นที่ | ห้องที่รับผิดชอบ (comma-separated) |
|---|---|---|
| A | ประตูใหญ่… | ม.1 Usaha, ม.4 Amber, ม.6 Ash-Shafi'i |
