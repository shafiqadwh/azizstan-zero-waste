# คู่มือติดตั้งระบบใช้งานจริง (สำหรับครู/เจ้าหน้าที่ไอที)

คู่มือนี้พาติดตั้ง AZIZSTAN ZERO WASTE บนเครื่อง Linux ของโรงเรียนตั้งแต่เครื่องเปล่าจนเปิดให้ครูใช้งาน
คำสั่งติดตั้ง สำรองข้อมูล และกู้คืน ผ่านการทดลองจริงกับ Docker image แล้ว (2 ต.ค. 2569) ส่วนที่ต้องใช้บัญชีภายนอก (Cloudflare, Google Drive) ทำตามหน้าจอของผู้ให้บริการ
รายละเอียดเชิงเทคนิคฉบับเต็ม (ภาษาอังกฤษ) อยู่ที่ `docs/14-deployment.md`

> พิมพ์คำสั่งทีละบรรทัด ถ้าบรรทัดไหนขึ้นข้อความผิดพลาด ให้หยุดแล้วดูหัวข้อ **ปัญหาที่พบบ่อย** ท้ายคู่มือก่อน

---

## 0. สิ่งที่ต้องเตรียมก่อนเริ่ม

| รายการ | หมายเหตุ |
|---|---|
| เครื่อง PC | SSD, RAM 16 GB (อย่างน้อย 8 GB), ต่อ UPS, ตั้ง IP ในวง LAN แบบคงที่ |
| ระบบปฏิบัติการ | Ubuntu Server 24.04 LTS เขตเวลา Asia/Bangkok |
| บัญชี Cloudflare ของโดเมน `azizstan.net` | สำหรับสร้าง Tunnel ให้เข้าเว็บจากนอกโรงเรียนได้ |
| Token ของ API รายชื่อนักเรียน **ที่เปลี่ยนใหม่แล้ว** | ห้ามใช้ token เดิม (ข้อกำหนดความปลอดภัย Q14) |
| IP ของเครื่องที่ใช้โปรแกรม ปพ.5 | เช่น `192.168.1.20` ใช้จำกัดว่าเครื่องไหนดึงคะแนนได้ |
| ที่เก็บไฟล์สำรองนอกเครื่อง | เช่น Google Drive ของบัญชีโรงเรียน หรือ NAS ของโรงเรียน |
| แฟลชไดรฟ์หรือที่เก็บรหัสผ่าน | เก็บ "กุญแจถอดรหัสไฟล์สำรอง" ห้ามเก็บไว้ในเครื่องเซิร์ฟเวอร์ |

ตั้งเวลาเครื่อง:
```sh
sudo timedatectl set-timezone Asia/Bangkok
sudo timedatectl set-ntp true
```

## 1. ติดตั้ง Docker และเครื่องมือ

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get update && sudo apt-get install -y git age rclone
```
ตรวจว่าใช้ได้: `sudo docker compose version` ต้องขึ้นเลขเวอร์ชัน

คำสั่งทั้งหมดต่อจากนี้ใช้สิทธิ์ root (`sudo -i`) เพื่อให้สั่ง Docker ได้

## 2. ดึงโค้ดลงเครื่อง

```sh
git clone https://github.com/shafiqadwh/azizstan-zero-waste.git /opt/azizstan-zero-waste
cd /opt/azizstan-zero-waste
```
ถ้ามีการออกเวอร์ชัน (tag เช่น `v1.0.0`) ให้ใช้เวอร์ชันนั้น: `git checkout v1.0.0`

**จากนี้ไปทุกคำสั่งให้พิมพ์ในโฟลเดอร์ `/opt/azizstan-zero-waste`**

## 3. สร้าง image ของระบบ

```sh
cp .env.example .env
sh deploy/zw.sh build
```
ใช้เวลาประมาณ 5–10 นาที (ดาวน์โหลดโปรแกรมสร้าง PDF และฟอนต์ไทย)

> `sh deploy/zw.sh` คือคำสั่ง `docker compose` ที่อ่านไฟล์ `.env` ให้ถูกที่ ใช้คำสั่งนี้แทน `docker compose` เสมอ

## 4. กรอกไฟล์ `.env`

เปิดไฟล์ด้วย `nano .env` แล้วแก้ทีละบรรทัด:

| ตัวแปร | ใส่อะไร | สร้างอย่างไร |
|---|---|---|
| `APP_URL` | `https://zerowaste.azizstan.net` | ต้องเป็น https (QR ที่ประตูห้องพิมพ์ที่อยู่นี้) |
| `POSTGRES_PASSWORD` | รหัสผ่านฐานข้อมูล | `openssl rand -hex 24` |
| `DATABASE_URL` | `postgres://zw:<รหัสเดียวกับบรรทัดบน>@db:5432/zw` | แก้แค่ส่วนรหัสผ่าน |
| `SESSION_SECRET` | ค่าสุ่มยาว | `openssl rand -base64 64 \| tr -d '\n'` |
| `INTERNAL_PDF_SECRET` | ค่าสุ่ม | `openssl rand -base64 32` |
| `STUDENT_API_TOKEN` | token ที่เปลี่ยนใหม่แล้ว | ขอจากผู้ดูแลระบบ StudentCare |
| `PP5_ALLOWED_CIDRS` | IP เครื่อง ปพ.5 ตามด้วย `/32` เช่น `192.168.1.20/32` | |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | กุญแจแจ้งเตือนบนมือถือ | `docker run --rm azizstan-zero-waste node scripts/vapid-keys.js` แล้วคัดลอก 2 บรรทัดที่ได้ |
| `VAPID_SUBJECT` | `mailto:อีเมลผู้ดูแล` | |
| `CLOUDFLARE_TUNNEL_TOKEN` | token จากข้อ 6 | กรอกทีหลังได้ |
| `COMPOSE_PROFILES` | `tunnel` | เอาเครื่องหมาย `#` หน้าบรรทัดออก หลังได้ token ในข้อ 6 |

สร้างกุญแจแจ้งเตือน**ครั้งเดียว** ถ้าเปลี่ยนภายหลัง มือถือทุกเครื่องต้องกดเปิดการแจ้งเตือนใหม่

## 5. เปิดระบบและสร้างผู้ดูแลระบบสูงสุด

```sh
sh deploy/zw.sh up -d db
sh deploy/zw.sh run --rm app node scripts/migrate.js
sh deploy/zw.sh run --rm app node scripts/create-super-admin.js
sh deploy/zw.sh up -d
```
- `create-super-admin.js` จะถามรหัสผ่านใหม่ 2 ครั้ง (พิมพ์แล้วไม่แสดงบนจอ เป็นเรื่องปกติ) ชื่อผู้ใช้คือ `superadmin`
- ตรวจว่าระบบทำงาน: `sh deploy/zw.sh ps` ต้องเห็น `db`, `app`, `worker` สถานะ Up
- ภายในเครื่อง: `sh deploy/zw.sh exec app node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>r.text()).then(console.log)"`
  ต้องได้ `"status":"ok"` (ถ้าได้ `degraded` ให้รอ 1–2 นาทีให้ worker เริ่มก่อน)

## 6. เปิดให้เข้าจากภายนอกด้วย Cloudflare Tunnel

1. เข้า Cloudflare → Zero Trust → Networks → Tunnels → **Create a tunnel** → ชนิด Cloudflared
2. ตั้งชื่อ เช่น `zerowaste` แล้วคัดลอก **token** (ข้อความยาวหลังคำว่า `--token`)
3. หน้า Public Hostname: subdomain `zerowaste` โดเมน `azizstan.net` → Service `HTTP` URL `app:3000`
4. ใส่ token ใน `.env` (`CLOUDFLARE_TUNNEL_TOKEN=...`) และเปิดบรรทัด `COMPOSE_PROFILES=tunnel`
5. `sh deploy/zw.sh up -d` แล้วเปิด `https://zerowaste.azizstan.net` จากมือถือ (ปิด Wi-Fi โรงเรียน) ต้องเห็นหน้าแรก

## 7. ตรวจความพร้อม (preflight)

```sh
sh deploy/zw.sh run --rm app node scripts/preflight.js
```
- `✓` ผ่าน · `!` ควรตรวจ · `✗` **ต้องแก้ก่อนใช้งานจริง**
- รันซ้ำทุกครั้งที่แก้ `.env`
- ตอนนี้ยังขึ้น `!` เรื่องภาคเรียนและการสำรองข้อมูลได้ จะหายไปหลังทำข้อ 8–9

## 8. ตั้งค่าในระบบ (ทำผ่านหน้าเว็บ)

ล็อกอินด้วย `superadmin` → หน้า **ภาพรวม** จะมีการ์ด **"ตั้งค่าเริ่มต้น n/9"** ให้ทำตามลำดับ กดแต่ละข้อเพื่อไปหน้าตั้งค่านั้น:

1. อาคาร/โซน
2. หมายเลขห้อง
3. ห้องเรียนและชื่อเรียกอื่น
4. ซิงก์รายชื่อนักเรียน (กดซิงก์ที่หน้า "นักเรียน" ให้สำเร็จ 1 ครั้ง)
5. ภาคเรียน 2/2569 และรูปแบบการประเมิน
6. รอบการประเมิน
7. ห้องเรียนที่ร่วมประเมินภาคนี้
8. คณะกรรมการ (นำเข้าจาก Excel ได้)
9. คำสั่งแต่งตั้ง (PDF)

การ์ดจะหายไปเองเมื่อครบทั้ง 9 ข้อ จากนั้น:
- สร้างบัญชีแอดมินคนอื่นที่หน้า **ผู้ใช้และสิทธิ์** (ใช้ superadmin เฉพาะงานผู้ดูแลระบบ)
- ตรวจหน้าคู่มือที่ **หน้าสาธารณะ** (ระบบมีหน้าคู่มือเริ่มต้นให้แล้ว)
- พิมพ์ QR ติดประตูห้องจากหน้า **ห้องเรียน อาคาร และหมายเลขห้อง**

## 9. สำรองข้อมูลทุกคืน

### 9.1 สร้างกุญแจ (ทำครั้งเดียว)
```sh
age-keygen -o /root/backup.key
age-keygen -y /root/backup.key > deploy/backup.pub
```
- **คัดลอก `/root/backup.key` ไปเก็บนอกเครื่อง** (แฟลชไดรฟ์ที่เก็บในตู้ล็อก หรือที่เก็บรหัสผ่านของโรงเรียน) แล้วลบออกจากเครื่อง: `shred -u /root/backup.key`
- ไม่มีไฟล์นี้ = **กู้คืนข้อมูลไม่ได้เลย**

### 9.2 ตั้งปลายทางนอกเครื่อง
```sh
rclone config
```
สร้าง remote ชื่อ **`zw-backup`** (เช่น ชนิด Google Drive ด้วยบัญชีโรงเรียน) ชื่อต้องตรงตัวนี้ สคริปต์เรียกใช้ชื่อนี้

### 9.3 ตั้งเวลาทุกคืน 01:30 น.
```sh
sh deploy/backup.sh
```
ทดลองรัน 1 ครั้ง ต้องขึ้น `backup ok: ...` แล้วตั้งเวลา: `crontab -e` เพิ่มบรรทัด
```
30 1 * * * sh /opt/azizstan-zero-waste/deploy/backup.sh >> /var/log/zw-backup.log 2>&1
```
หน้า **ข้อมูลและความเป็นส่วนตัว** ในระบบจะแสดง "สำรองข้อมูลล่าสุด" ถ้าวันที่เก่ากว่า 1 วัน แปลว่าการสำรองคืนก่อนล้มเหลว

## 10. ซ้อมกู้คืน (ก่อนเปิดใช้จริง และทุกภาคเรียน)

ทำบน**เครื่องสำรอง** ห้ามทำบนเครื่องที่ใช้งานจริง ขั้นตอนเต็มอยู่ใน `docs/14-deployment.md` §6 สรุปคำสั่ง:
```sh
rclone copy zw-backup:azizstan-zero-waste/<ไฟล์ล่าสุด>.tar.age /tmp/
mkdir -p /tmp/restore
age -d -i backup.key /tmp/<ไฟล์ล่าสุด>.tar.age | tar -x -C /tmp/restore
sh deploy/zw.sh up -d db
sh deploy/zw.sh exec -T db pg_restore -U zw -d zw --clean --if-exists < /tmp/restore/db.dump
docker run --rm -v azizstan-zero-waste_app-data:/data -v /tmp/restore:/in alpine \
  sh -c 'tar -C /data -xzf /in/files.tgz && chown 10001:10001 /data'
sh deploy/zw.sh up -d
```
ตรวจ: ล็อกอินได้, เปิดผลประเมินแล้วเห็นรูปและ PDF, เปิดคำสั่งแต่งตั้งได้, ลองอัปโหลดคำสั่งทดสอบได้
เสร็จแล้วลบเครื่องสำรองทิ้ง (`sh deploy/zw.sh down -v` และ `rm -rf /tmp/restore`) เพราะมีข้อมูลจริง

## 11. อัปเดตเป็นเวอร์ชันใหม่

```sh
cd /opt/azizstan-zero-waste
git pull                      # หรือ git fetch --tags && git checkout vX.Y.Z
sh deploy/zw.sh build
sh deploy/zw.sh run --rm app node scripts/migrate.js
sh deploy/zw.sh up -d
sh deploy/zw.sh run --rm app node scripts/preflight.js
```
อัปเดตช่วงที่ไม่มีการประเมิน (เช่น เย็นวันศุกร์) ระบบจะหยุดประมาณ 1 นาที

## 12. การเฝ้าระวัง

- **ดิสก์**: ระบบตรวจทุกชั่วโมง ถ้าใช้เกิน 80% แอดมินจะได้รับแจ้งเตือน "พื้นที่ดิสก์ใกล้เต็ม" ดูตัวเลขได้ที่หน้า **ข้อมูลและความเป็นส่วนตัว**
- **ระบบล่ม**: ตั้ง Cloudflare Health Check (หรือ UptimeRobot) ให้เรียก `https://zerowaste.azizstan.net/api/v1/health` ทุก 5 นาที
- **ดู log**: `sh deploy/zw.sh logs --tail 100 app` (หรือ `worker`)
- **Moodle เดิม**: แยกเครือข่ายไว้ ห้ามเปิดผ่าน Tunnel เดียวกัน

## 13. ปัญหาที่พบบ่อย

| อาการ | สาเหตุและวิธีแก้ |
|---|---|
| `required variable POSTGRES_PASSWORD is missing a value` | ใช้ `docker compose` ตรง ๆ หรือไม่ได้อยู่ในโฟลเดอร์ระบบ ให้ใช้ `sh deploy/zw.sh ...` ใน `/opt/azizstan-zero-waste` |
| `No terminal: set ZW_SUPER_ADMIN_PASSWORD or run with -it` | รันผ่านสคริปต์อัตโนมัติ ให้รันเองในหน้าจอ terminal หรือใส่ `-e ZW_SUPER_ADMIN_PASSWORD=...` |
| อัปโหลดคำสั่งแต่งตั้งไม่ได้ log ขึ้น `EACCES ... mkdir '/data/orders'` | โฟลเดอร์ข้อมูลเป็นของ root (มักเกิดหลังกู้คืน) แก้: `docker run --rm -v azizstan-zero-waste_app-data:/data alpine chown 10001:10001 /data` |
| เว็บจากนอกโรงเรียนเข้าไม่ได้ | ตรวจ `COMPOSE_PROFILES=tunnel` และ token ใน `.env` แล้ว `sh deploy/zw.sh up -d` ดู log: `sh deploy/zw.sh logs cloudflared` |
| health ขึ้น `degraded` | worker หยุด ดู `sh deploy/zw.sh logs --tail 50 worker` แล้ว `sh deploy/zw.sh up -d` |
| PDF ไม่ออก | ดู log worker หาคำว่า `pdf.render` ถ้าดิสก์เต็มให้เพิ่มพื้นที่ แล้วกดสร้างใหม่ที่หน้า **ติดตามสถานะ** |
| preflight ขึ้น `✗ STUDENT_API_TOKEN ยังเป็นค่าตัวอย่าง` | ยังไม่ได้ใส่ token จริงใน `.env` |

## 14. เช็กลิสต์วันเปิดใช้งาน

- [ ] preflight ไม่มี `✗`
- [ ] เปิดเว็บจากมือถือนอกโรงเรียนได้ (https)
- [ ] การ์ด "ตั้งค่าเริ่มต้น" หายไปแล้ว (ครบ 9 ข้อ)
- [ ] สแกน QR ที่ประตูห้องแล้วเปิดหน้าของห้องนั้นได้
- [ ] สำรองข้อมูลคืนแรกสำเร็จ และซ้อมกู้คืนแล้ว
- [ ] กุญแจ `backup.key` อยู่นอกเครื่องแล้ว และลบออกจากเซิร์ฟเวอร์แล้ว
- [ ] บันทึกวันที่ ผู้ติดตั้ง และเวอร์ชันลงสมุดงานไอทีของโรงเรียน
