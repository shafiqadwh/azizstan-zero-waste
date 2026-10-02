# AZIZSTAN Zero Waste — ชุดเอกสารออกแบบระบบสำหรับพัฒนาด้วย AI

ระบบให้คะแนนความสะอาดห้องเรียนและพื้นที่ (โซน/อาคาร) ของโรงเรียนมูลนิธิอาซิซสถาน
ชุดนี้เขียนให้ **AI coding agent** (Claude Code, Codex, Cursor ฯลฯ) อ่านแล้วพัฒนาต่อได้ทันที
เนื้อหาทางเทคนิคเขียนเป็นภาษาอังกฤษเพื่อลดความกำกวม ส่วนข้อความบนหน้าจอเป็นภาษาไทยทั้งหมด

## มีอะไรอยู่ในชุดนี้

| ไฟล์ | เนื้อหา |
|---|---|
| `AGENTS.md` / `CLAUDE.md` | กติกาสำหรับ AI: stack, โครงสร้างโฟลเดอร์, ข้อห้าม, นิยาม "งานเสร็จ" |
| `docs/00-glossary.md` | คำศัพท์ไทย ↔ ชื่อในโค้ด |
| `docs/01-requirements.md` | ข้อกำหนดทั้งหมดที่ตกลงกันแล้ว มีรหัส FR-xx |
| `docs/02-architecture.md` | สถาปัตยกรรม, container, layer, ตัวแปร `.env`, งบ RAM |
| `docs/03-database.md` + `db/schema.ts` | ฐานข้อมูล 35 ตาราง (ทดสอบ migrate บน PostgreSQL 16 ด้วย `pnpm test:db`) |
| `docs/04-business-rules.md` | กติกาแบบละเอียดทุกข้อ: รอบ, 24 ชม., คำขออนุมัติ, สูตรคะแนน, จัดอันดับ, sync รายชื่อ |
| `docs/05-api.md` | Server actions, REST API, API สำหรับ ปพ.5, รหัส error + ข้อความไทย |
| `docs/06-auth-permissions.md` | การล็อกอิน, ตารางสิทธิ์ทุกบทบาท |
| `docs/07-frontend.md` | แผนผังทุกหน้า, ฟอร์มประเมิน, ออฟไลน์, PWA |
| `docs/08-ux-ui.md` | Design tokens, คอมโพเนนต์, สเปกทุกหน้าจอ, ข้อความ UI ภาษาไทย |
| `docs/09-pdf.md` | เอกสาร PDF A4 |
| `docs/10-integrations.md` | API รายชื่อนักเรียน, รายชื่อห้อง 79 ห้อง, โซน A–Y, แม่แบบ Excel |
| `docs/11-jobs-notifications.md` | งานตามเวลา และการแจ้งเตือน |
| `docs/12-security-privacy.md` | PDPA และความปลอดภัย |
| `docs/13-testing.md` | รายการทดสอบทุกกติกา |
| `docs/14-deployment.md` | ติดตั้งบน Xpenology และ PC ของโรงเรียน ทีละขั้นตอน |
| `docs/releases/` | บันทึกการออกเวอร์ชัน (v1.0.0 = เวอร์ชันแรกสำหรับใช้งานจริง) |
| `docs/go-live-th.md` | **คู่มือติดตั้งใช้งานจริงภาษาไทย** สำหรับครู/เจ้าหน้าที่ไอที (คำสั่งหลักผ่านการทดลองแล้ว) |
| `docs/15-roadmap.md` | งาน 30+ ชิ้น เรียงลำดับ พร้อมเกณฑ์ตรวจรับ |
| `docs/16-open-questions.md` | คำถามที่ยังค้าง พร้อมค่าเริ่มต้นที่ให้ AI ใช้ไปก่อน |
| `src/lib/scoring/` | โค้ดคำนวณคะแนนต้นแบบ + ทดสอบ 24 ข้อ (ผ่านทั้งหมด) |
| `deploy/` · `.env.example` | Docker Compose, Dockerfile, สคริปต์สำรองข้อมูล |

## วิธีใช้กับ AI ทีละขั้นตอน

1. **สร้าง repository ใหม่** แล้วคัดลอกทั้งโฟลเดอร์นี้ลงไป
   (`git init` → วางไฟล์ → `git add . && git commit -m "docs: initial spec"`)
2. **ตรวจสูตรคะแนนต้นแบบ** ว่ารันได้บนเครื่องคุณ (ต้องมี Node.js 22):
   ```
   node --experimental-strip-types --test src/lib/scoring/scoring.test.ts
   ```
   ต้องได้ `pass 24` ถ้าได้แสดงว่าสูตรตรงกับที่ตกลงกันไว้
3. **ตอบคำถามใน `docs/16-open-questions.md`** ข้อที่ตอบได้ แก้คอลัมน์ Default ให้เป็นคำตอบจริง
4. **สั่ง AI ทีละ ticket** เช่นใน Claude Code:
   ```
   อ่าน AGENTS.md แล้วทำ ticket T00 ใน docs/15-roadmap.md ให้ครบตามเกณฑ์ AC
   ```
   เสร็จแล้วตรวจผล → commit → สั่ง ticket ถัดไป (T01, T02, …) อย่าสั่งหลาย ticket พร้อมกัน
5. **เมื่อกติกาเปลี่ยน** ให้แก้ `docs/01-requirements.md` และ `docs/04-business-rules.md` ก่อน แล้วค่อยสั่ง AI แก้โค้ด
   เอกสารคือแหล่งความจริงเสมอ
6. **Phase 1 (T00–T29)** คือชุดที่ทำให้ใช้งานจริงได้ในภาคเรียนที่ 2/2569

## ภาพหน้าจอ
ดูแคนวาส **AZIZSTAN Zero Waste UX/UI** (8 หน้าจอ) ประกอบกับ `docs/08-ux-ui.md`
ถ้ามีจุดไม่ตรงกัน ให้ยึดเอกสาร
