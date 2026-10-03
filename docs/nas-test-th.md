# ติดตั้งทดสอบบน NAS (Synology / Xpenology) ที่ `zerowaste.shafiq-lap.com`

ใช้สำหรับ**ทดสอบก่อนติดตั้งจริงที่โรงเรียน** ด้วยรายชื่อนักเรียนจริง เข้าเว็บผ่าน DSM Reverse Proxy
กับใบรับรอง `*.shafiq-lap.com` และให้เข้าได้เฉพาะเครือข่ายภายใน
ขั้นตอนหลักเหมือน `docs/go-live-th.md` คู่มือนี้บอกเฉพาะส่วนที่ต่างบน NAS

> **ใช้ข้อมูลนักเรียนจริง = ต้องทำตามข้อกำหนดความปลอดภัยข้อ 11** (`docs/12-security-privacy.md`)
> - เก็บข้อมูลในโฟลเดอร์ที่**เข้ารหัส**
> - **ไม่เปิดเว็บให้คนภายนอกเข้า**
> - มี**หนังสืออนุญาตจากโรงเรียน**เก็บไว้
> - **ลบข้อมูลทั้งหมดหลังส่งมอบ**

ทำไมต้องใช้ https เท่านั้น: คุกกี้ล็อกอินตั้งค่า `Secure` ไว้ ถ้าเปิดผ่าน `http://IP-ของ-NAS:พอร์ต` จะล็อกอินไม่ได้
ต้องเปิดผ่าน `https://zerowaste.shafiq-lap.com` เสมอ

---

## 1. เตรียม DSM

1. **Container Manager**: ติดตั้งจาก Package Center
2. **Git**: ติดตั้งแพ็กเกจ **Git Server** (ได้คำสั่ง `git` มาใช้ใน SSH)
3. **SSH**: Control Panel → Terminal & SNMP → เปิด SSH
4. **โฟลเดอร์เข้ารหัส**: Control Panel → Shared Folder → Create → ชื่อ **`zw`** → ติ๊ก **Encrypt this shared folder**
   - ตั้งรหัสผ่านแล้วเก็บไฟล์กุญแจ (.key) ไว้นอก NAS
   - ไม่ต้องตั้งให้ mount อัตโนมัติตอนบูต เพราะถ้าโฟลเดอร์ยังไม่ mount คอนเทนเนอร์จะไม่เริ่ม ข้อมูลจึงไม่ไปตกที่อื่น
   - หลังรีบูต NAS ต้องเข้า Shared Folder → `zw` → Encryption → **Mount** ก่อน แล้วค่อย `sh deploy/zw.sh up -d`

## 2. ดึงโค้ดและเตรียมโฟลเดอร์ข้อมูล

SSH เข้า NAS แล้วใช้สิทธิ์ root:
```sh
ssh <ชื่อผู้ใช้>@<IP ของ NAS>
sudo -i
cd /volume1/zw
git clone https://github.com/shafiqadwh/azizstan-zero-waste.git app
cd app
mkdir -p /volume1/zw/data/db /volume1/zw/data/app
chown 10001:10001 /volume1/zw/data/app
cp deploy/compose.local.example.yml deploy/compose.local.yml
```
- เครื่องทดสอบใช้ `main` (ไฟล์ `compose.local.example.yml` และการรองรับ Container Manager ใน `deploy/zw.sh`
  เพิ่มหลัง v1.0.0) เครื่องจริงที่โรงเรียนใช้ tag ตาม `docs/go-live-th.md`
- ถ้า repo เป็น private, git จะถามชื่อผู้ใช้และรหัสผ่าน ให้ใช้ชื่อผู้ใช้ GitHub กับ **Personal Access Token**
  (สร้างที่ GitHub → Settings → Developer settings → Fine-grained tokens โดยให้สิทธิ์อ่าน repo นี้อย่างเดียว)
- `deploy/compose.local.yml` ทำ 2 อย่าง:
  - เก็บฐานข้อมูลและรูปไว้ใน `/volume1/zw/data` (โฟลเดอร์เข้ารหัส) แทน `/volume1/@docker` ที่ไม่เข้ารหัส
  - เปิดพอร์ตแอปที่ `127.0.0.1:3100` ให้เข้าได้ทาง Reverse Proxy เท่านั้น

  ถ้าพอร์ต 3100 ถูกใช้อยู่ ให้แก้ตัวเลขในไฟล์นี้

## 3. ไฟล์ `.env`

```sh
cp .env.example .env
sh deploy/zw.sh build
```
`build` ใช้เวลา 10–20 นาทีบน NAS จากนั้น `vi .env` (หรือแก้ผ่าน File Station → Text Editor) ตามตารางใน `docs/go-live-th.md` ข้อ 4
ค่าที่ต่างสำหรับ NAS:

| ตัวแปร | ค่าบน NAS |
|---|---|
| `APP_URL` | `https://zerowaste.shafiq-lap.com` |
| `STUDENT_API_TOKEN` | token ของ API รายชื่อนักเรียน (อยู่ใน `.env` บน NAS เท่านั้น ห้ามส่งขึ้น GitHub) |
| `PP5_ALLOWED_CIDRS` | วง LAN ของบ้าน เช่น `192.168.2.0/24` |
| `CLOUDFLARE_TUNNEL_TOKEN` | เว้นว่าง |
| `COMPOSE_PROFILES` | **ไม่ต้องใส่** (ไม่ใช้ Tunnel) |

## 4. เปิดระบบ

```sh
sh deploy/zw.sh up -d db
sh deploy/zw.sh run --rm app node scripts/migrate.js
sh deploy/zw.sh run --rm app node scripts/create-super-admin.js
sh deploy/zw.sh up -d
sh deploy/zw.sh ps
```
ตรวจ: `curl -s http://127.0.0.1:3100/api/v1/health` ต้องได้ `"status":"ok"` (ถ้าได้ `degraded` ให้รอ worker สัก 1–2 นาที)

> `sh deploy/zw.sh` เลือกใช้ `docker compose` หรือ `docker-compose` ของ Container Manager ให้เอง
> และรวมไฟล์ `deploy/compose.local.yml` ให้อัตโนมัติ

## 5. DSM Reverse Proxy และใบรับรอง

1. Control Panel → Login Portal → Advanced → **Reverse Proxy** → Create
   - Description: `zerowaste`
   - Source: Protocol **HTTPS**, Hostname **`zerowaste.shafiq-lap.com`**, Port **443**
   - Destination: Protocol **HTTP**, Hostname **`localhost`**, Port **3100**
   - แท็บ Custom Header: กด Create → **WebSocket**
2. Control Panel → Security → Certificate → **Settings** → บรรทัด `zerowaste.shafiq-lap.com` เลือกใบรับรอง `*.shafiq-lap.com`
3. **จำกัดให้เข้าได้เฉพาะในบ้าน**: Login Portal → Advanced → **Access Control Profile** → Create ชื่อ `zw-lan`
   - Allow: วง LAN ที่จะใช้ทดสอบ เช่น `192.168.2.0/24` (ถ้ามือถืออยู่อีก VLAN ให้เพิ่มวงนั้นด้วย)
   - Deny: All (เป็นกฎสุดท้าย)

   แล้วกลับไปแก้ Reverse Proxy `zerowaste` → เลือก Access control profile = `zw-lan`

## 6. DNS

ชื่อ `zerowaste.shafiq-lap.com` ต้องชี้มาที่ NAS เลือกอย่างใดอย่างหนึ่ง:
- **แนะนำ: DNS ภายในบ้าน.** เพิ่ม static DNS บนเราเตอร์ (MikroTik: IP → DNS → Static) ให้ `zerowaste.shafiq-lap.com` → IP ของ NAS
  มือถือที่ต่อ Wi-Fi บ้านจะเข้าได้ ส่วนคนนอกบ้านหาไม่เจอ
- **DNS สาธารณะ.** ถ้ามี wildcard `*.shafiq-lap.com` ชี้ไป `nas.shafiq-lap.com` อยู่แล้วก็ใช้ได้ทันที
  แต่ต้องพึ่ง Access Control Profile ข้อ 5.3 กันคนนอก (และเราเตอร์ต้องรองรับ hairpin NAT)

ทดสอบ: มือถือต่อ Wi-Fi บ้าน → เปิด `https://zerowaste.shafiq-lap.com` → ต้องเห็นหน้าแรก กุญแจ https ไม่ขึ้นเตือน และล็อกอินได้

## 7. ตรวจความพร้อมและเริ่มทดสอบ

```sh
sh deploy/zw.sh run --rm app node scripts/preflight.js
```
ผลที่คาดไว้บน NAS ทดสอบ (ไม่ต้องแก้):
- `!` ไม่มี Tunnel token
- `!` ยังไม่เคยสำรองข้อมูล
- `!` token นักเรียน ให้ยืนยันว่าเป็นตัวที่จะเปลี่ยนก่อนใช้จริง

ต้องไม่มี `✗` จากนั้นล็อกอิน `superadmin` แล้วทำตามการ์ด **"ตั้งค่าเริ่มต้น n/8"** ในหน้าภาพรวม


## 8. ปัญหาที่อาจเจอบน NAS

| อาการ | วิธีแก้ |
|---|---|
| `docker: command not found` | ใช้ `sudo -i` ก่อน และต้องติดตั้ง Container Manager แล้ว |
| `git: command not found` | ติดตั้งแพ็กเกจ Git Server |
| คอนเทนเนอร์ไม่เริ่มหลังรีบูต ขึ้น `no such file or directory … /volume1/zw/data` | โฟลเดอร์ `zw` ยังไม่ได้ mount ให้ mount (ข้อ 1.4) แล้ว `sh deploy/zw.sh up -d` |
| 502 Bad Gateway จาก DSM | แอปยังไม่ขึ้นหรือพอร์ตไม่ตรง ตรวจ `sh deploy/zw.sh ps` และพอร์ตใน `compose.local.yml` ต้องตรงกับ Reverse Proxy |
| ล็อกอินแล้วเด้งกลับหน้าเดิม | เปิดผ่าน http หรือ IP ให้เปิดผ่าน `https://zerowaste.shafiq-lap.com` เท่านั้น |
| กดบันทึกแล้วขึ้น `Invalid Server Actions request` | Reverse Proxy ไม่ส่งชื่อโดเมนต่อ ให้เพิ่ม Custom Header `X-Forwarded-Host` = `$host` แล้วลองใหม่ |
| อัปโหลดรูปไม่ผ่าน ขึ้น 413 | DSM จำกัดขนาด request ระบบย่อรูปก่อนส่งอยู่แล้ว ถ้ายังเจอให้แจ้ง พร้อมขนาดไฟล์ |
| `Bind mount failed: '…/deploy/backup' does not exist` | โค้ดก่อน 2 ต.ค. 2569 ค่ำ: `git pull` หรือ `mkdir -p deploy/backup` แล้วสั่งใหม่ |
| `EACCES … /data/...` | `chown 10001:10001 /volume1/zw/data/app` |
| build ช้ามากหรือค้าง | RAM ไม่พอ ปิดคอนเทนเนอร์อื่นชั่วคราว แล้ว `sh deploy/zw.sh build` ใหม่ |

## 9. อัปเดตเวอร์ชันบน NAS

```sh
cd /volume1/zw/app
git pull
sh deploy/zw.sh build
sh deploy/zw.sh run --rm app node scripts/migrate.js
sh deploy/zw.sh up -d
```

## 10. เลิกทดสอบ / หลังส่งมอบ (ต้องทำ)

```sh
cd /volume1/zw/app
sh deploy/zw.sh down -v
rm -rf /volume1/zw/data
```
`down -v` **ไม่ลบ**ไฟล์ใน `/volume1/zw/data` (เพราะเป็นโฟลเดอร์ที่ผูกไว้) จึงต้อง `rm -rf` เอง
จากนั้นลบ shared folder `zw` ทั้งโฟลเดอร์ใน DSM ลบ Reverse Proxy, Access Control Profile และ DNS ที่สร้างไว้
แล้วบันทึกวันที่ลบไว้คู่กับหนังสืออนุญาต
