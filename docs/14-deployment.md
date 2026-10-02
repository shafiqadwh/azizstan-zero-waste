# 14 — Deployment

Step-by-step Thai handbook for the school's IT staff: `docs/go-live-th.md` (same procedure, tested commands).
NAS test install in Thai (DSM Reverse Proxy, encrypted folder, `deploy/compose.local.yml`): `docs/nas-test-th.md`.

Same Docker Compose on both machines. Files: `deploy/docker-compose.yml`, `deploy/Dockerfile`,
`deploy/backup.sh`, `deploy/zw.sh`, `.env.example`.

**Always call compose through `sh deploy/zw.sh …`** (from the repository root). It is `docker compose` with the
repository's `.env` passed in; a plain `docker compose -f deploy/docker-compose.yml …` looks for `deploy/.env`
instead and stops with "required variable POSTGRES_PASSWORD is missing a value".

## 1. Development/test on Xpenology NAS (owner's machine)

1. **Enable Container Manager** (DSM Package Center) and SSH (Control Panel → Terminal).
2. **Create an encrypted shared folder** `zw` (Control Panel → Shared Folder → Encrypt) — real student names
   will be stored here (12-security §2 item 11).
3. **Copy the repository** into `/volume1/zw/app` (git clone over SSH).
4. **Create `.env`** from `.env.example`; set `APP_URL` to your test subdomain (not azizstan.net).
5. **Build and start**:
   ```sh
   cd /volume1/zw/app
   sh deploy/zw.sh build
   sh deploy/zw.sh up -d db
   sh deploy/zw.sh run --rm app node scripts/migrate.js
   sh deploy/zw.sh run --rm app node scripts/create-super-admin.js
   sh deploy/zw.sh up -d
   ```
   `create-super-admin.js` asks for the new password twice (not shown on screen); without a terminal pass it as
   `-e ZW_SUPER_ADMIN_PASSWORD=…`. `up` also runs the one-shot `migrate` service before `app` and `worker` start,
   so the explicit `scripts/migrate.js` call is only needed before `create-super-admin.js`. Check with
   `curl http://127.0.0.1:3000/api/v1/health` (inside the host) → `"status":"ok"` once the worker heartbeat arrives.
6. **Access**: LAN only (`ports: ["127.0.0.1:3000:3000"]` + DSM reverse proxy) or Cloudflare Tunnel **with
   Cloudflare Access** restricted to allowed emails. The `cloudflared` container only starts with
   `COMPOSE_PROFILES=tunnel` in `.env`; leave it out (and `CLOUDFLARE_TUNNEL_TOKEN` empty) for LAN only.
7. After handover to the school: `sh deploy/zw.sh down -v` and delete the encrypted folder.

## 2. Production on the school Linux PC

Prerequisites: SSD, 16 GB RAM recommended, UPS, Ubuntu Server 24.04 LTS (or current Debian), static LAN IP,
time sync (`timedatectl set-ntp true`, timezone Asia/Bangkok).

1. **Install Docker Engine + compose plugin** (official convenience script or apt repository).
2. **Create a Cloudflare Tunnel** in the Cloudflare dashboard for `azizstan.net`
   (Zero Trust → Networks → Tunnels → Create), public hostname e.g. `zerowaste.azizstan.net` → `http://app:3000`.
   Copy the tunnel token into `.env` (`CLOUDFLARE_TUNNEL_TOKEN`) and add `COMPOSE_PROFILES=tunnel`, which turns
   on the `cloudflared` container.
3. **Clone the release tag**: `git clone --branch v1.0.0 … /opt/azizstan-zero-waste` (release notes: `docs/releases/`).
4. **`.env`**: copy from `.env.example`; generate secrets:
   `openssl rand -base64 64` (SESSION_SECRET), `openssl rand -base64 32` (INTERNAL_PDF_SECRET),
   VAPID with `docker run --rm azizstan-zero-waste node scripts/vapid-keys.js` after `sh deploy/zw.sh build`
   (no Node.js needed on the host; from a checkout: `pnpm vapid:generate`). Put the **rotated** student API token.
5. **Start**: same commands as §1 step 5.
6. **Create the super admin** (step 5's `create-super-admin.js`; you type the password) → log in.
7. **Admin setup order** — `/admin` shows it as the "ตั้งค่าเริ่มต้น n/9" checklist, each step ticked from the
   data and linked to its settings page; the card disappears once all nine are done: buildings/zones → physical
   rooms → classes & aliases → a successful student sync → active term (2/2569) → rounds → classes taking part
   this term → committee duties (Excel import) → appointment order PDF. Guide pages ship with defaults
   (migrations 0006, 0008); review them on `/admin/settings/content`.
8. **Backups**: install `age` and `rclone`, put `backup.pub`, configure the rclone remote, add cron
   `30 1 * * * sh /opt/azizstan-zero-waste/deploy/backup.sh`. The backup holds the database and every folder of
   the data volume except `tmp/` (photos `uploads/`, evaluation PDFs `pdf/`, appointment orders `orders/`). **Test a restore** (§5) before go-live.
9. **Moodle**: keep it on its own network; do not publish it through the same tunnel unless it is patched.
10. **Preflight before go-live** (and after any `.env` change):
    `sh deploy/zw.sh run --rm app node scripts/preflight.js`
    (from a checkout: `pnpm preflight`, which reads `.env`). It refuses (exit 1, `✗`) on: an `APP_URL` that is not
    https or still localhost (QR sheets print it), example secrets or `change-me` passwords, a missing or example
    student API token, an empty or malformed `PP5_ALLOWED_CIDRS`, half a VAPID key pair, `COMPOSE_PROFILES=tunnel` without a
    tunnel token, a data directory that is not writable, pending migrations, no super admin, a disk at 95 % or more. It warns (`!`) on: the student token (confirm it is the
    **rotated** one, Q14), the example private ranges in `PP5_ALLOWED_CIDRS` (narrow to the ปพ.5 machine), no push
    keys, no tunnel token (or a token without `COMPOSE_PROFILES=tunnel`), no active term, a disk at 80 % or more, and no successful backup in the last day. It also prints whether
    "อนุมัติอัตโนมัติ" is on for the active term.

## 3. Updates
```sh
cd /opt/azizstan-zero-waste && git fetch --tags && git checkout vX.Y.Z
sh deploy/zw.sh build
sh deploy/zw.sh run --rm app node scripts/migrate.js
sh deploy/zw.sh up -d
```
The backup also writes `backup.last` into `app_settings` after the off-site copy succeeds; the time shows on
`/admin/settings/privacy` ("สำรองข้อมูลล่าสุด"). No entry for more than a day means the nightly backup failed.

## 4. Monitoring
- `GET /api/v1/health` every 5 min from an external uptime monitor (e.g. Cloudflare health check).
- Worker heartbeat older than 3 min → health returns `degraded`.
- Disk space: the worker's `disk.check` job measures the filesystem under `DATA_DIR` every hour (:15). At 80 %
  used every admin gets a `disk_space` inbox notice (and push), once per day while it stays full. The last reading
  shows on `/admin/settings/privacy` ("พื้นที่ดิสก์"); preflight warns at 80 % and refuses at 95 %.

## 5. Restore (tested procedure)
```sh
age -d -i backup.key zw-YYYYMMDD-HHMM.tar.age | tar -x -C /tmp/restore
sh deploy/zw.sh up -d db
sh deploy/zw.sh exec -T db pg_restore -U zw -d zw --clean --if-exists < /tmp/restore/db.dump
docker run --rm -v azizstan-zero-waste_app-data:/data -v /tmp/restore:/in alpine \
  sh -c 'tar -C /data -xzf /in/files.tgz && chown 10001:10001 /data'
sh deploy/zw.sh up -d
```
The `chown` matters: on an empty machine `docker run` creates the volume owned by root, and the app (user 10001)
then cannot create a new folder in it (uploading an appointment order fails with `EACCES … mkdir '/data/orders'`).
The backup also writes `backup.last` into `app_settings` after the off-site copy succeeds; the time shows on
`/admin/settings/privacy` ("สำรองข้อมูลล่าสุด"). No entry for more than a day means the nightly backup failed.

## 6. Restore rehearsal checklist (before go-live, then once per term)
Rehearse on a **spare machine or a throw-away directory**, never on the live database. Write the date, the
backup file name and who did it in the school's IT log.

1. [ ] Pick last night's file from the off-site copy (`rclone ls zw-backup:azizstan-zero-waste/`), not the local one
       — this proves the off-site copy works.
2. [ ] Fetch the private key (`backup.key`) from where it is kept off the machine; confirm the file decrypts:
       `age -d -i backup.key zw-….tar.age | tar -t` lists `./db.dump` and `./files.tgz`.
3. [ ] On the spare machine: clone the repo at the same version tag, copy `.env` (new secrets are fine), start only
       `db`, then run the §5 commands.
4. [ ] `sh deploy/zw.sh run --rm app node scripts/migrate.js` finishes without error (the dump has the schema).
5. [ ] Start the stack; `GET /api/v1/health` returns `ok` within 2 minutes (worker heartbeat included).
6. [ ] Log in as an admin. `/admin` shows the current term and round; the counts match the live system.
7. [ ] Open three evaluations from different rounds: photos load (thumbnails and full size) and the PDF opens.
       Open one appointment order on `/orders`, and upload a test order on `/admin/settings/content` (proves the
       app can write to the restored volume), then delete it.
8. [ ] `/admin/settings/privacy` lists the terms with the same delete dates as the live system.
9. [ ] The ปพ.5 API answers with the CSV header on the spare machine (`curl -H "Authorization: Bearer …"`).
10. [ ] Note how long steps 2–5 took (target: under 1 hour). Destroy the spare copy (`sh deploy/zw.sh down -v`,
        delete `/tmp/restore`) — it holds real data.

Retention runs inside the restored copy too: a restore of an old backup re-creates data that `retention.run`
already deleted, and the next 03:00 run deletes it again (BR-D3), so an old backup never extends retention.
