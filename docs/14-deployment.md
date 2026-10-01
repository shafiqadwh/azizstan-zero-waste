# 14 — Deployment

Same Docker Compose on both machines. Files: `deploy/docker-compose.yml`, `deploy/Dockerfile`,
`deploy/backup.sh`, `.env.example`.

## 1. Development/test on Xpenology NAS (owner's machine)

1. **Enable Container Manager** (DSM Package Center) and SSH (Control Panel → Terminal).
2. **Create an encrypted shared folder** `zw` (Control Panel → Shared Folder → Encrypt) — real student names
   will be stored here (12-security §2 item 11).
3. **Copy the repository** into `/volume1/zw/app` (git clone over SSH).
4. **Create `.env`** from `.env.example`; set `APP_URL` to your test subdomain (not azizstan.net).
5. **Build and start**:
   ```sh
   cd /volume1/zw/app
   docker compose -f deploy/docker-compose.yml build
   docker compose -f deploy/docker-compose.yml up -d db
   docker compose -f deploy/docker-compose.yml run --rm app node scripts/migrate.js
   docker compose -f deploy/docker-compose.yml run --rm app node scripts/create-super-admin.js
   docker compose -f deploy/docker-compose.yml up -d
   ```
   `up` also runs the one-shot `migrate` service before `app` and `worker` start, so the explicit
   `scripts/migrate.js` call is only needed before `create-super-admin.js`. Check with
   `curl http://127.0.0.1:3000/api/v1/health` (inside the host) → `"status":"ok"` once the worker heartbeat arrives.
6. **Access**: LAN only (`ports: ["127.0.0.1:3000:3000"]` + DSM reverse proxy) or Cloudflare Tunnel **with
   Cloudflare Access** restricted to allowed emails.
7. After handover to the school: `docker compose down -v` and delete the encrypted folder.

## 2. Production on the school Linux PC

Prerequisites: SSD, 16 GB RAM recommended, UPS, Ubuntu Server 24.04 LTS (or current Debian), static LAN IP,
time sync (`timedatectl set-ntp true`, timezone Asia/Bangkok).

1. **Install Docker Engine + compose plugin** (official convenience script or apt repository).
2. **Create a Cloudflare Tunnel** in the Cloudflare dashboard for `azizstan.net`
   (Zero Trust → Networks → Tunnels → Create), public hostname e.g. `zerowaste.azizstan.net` → `http://app:3000`.
   Copy the tunnel token into `.env` (`CLOUDFLARE_TUNNEL_TOKEN`).
3. **Clone the release tag**: `git clone --branch vX.Y.Z … /opt/azizstan-zero-waste`.
4. **`.env`**: copy from `.env.example`; generate secrets:
   `openssl rand -base64 64` (SESSION_SECRET), `openssl rand -base64 32` (INTERNAL_PDF_SECRET),
   `pnpm vapid:generate` or `npx web-push generate-vapid-keys` (VAPID). Put the **rotated** student API token.
5. **Start**: same commands as §1 step 5.
6. **Create the super admin** (script prints a one-time password) → log in → change password.
7. **Admin setup order** (the UI shows this as a checklist): buildings/zones → physical rooms → classes &
   aliases → run student sync → term 2/2569 config → rounds → duties (Excel import) → appointment order PDF →
   guide pages.
8. **Backups**: install `age` and `rclone`, put `backup.pub`, configure the rclone remote, add cron
   `30 1 * * * sh /opt/azizstan-zero-waste/deploy/backup.sh`. **Test a restore** (§5) before go-live.
9. **Moodle**: keep it on its own network; do not publish it through the same tunnel unless it is patched.

## 3. Updates
```sh
cd /opt/azizstan-zero-waste && git fetch --tags && git checkout vX.Y.Z
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml run --rm app node scripts/migrate.js
docker compose -f deploy/docker-compose.yml up -d
```
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
4. [ ] `docker compose … run --rm app node scripts/migrate.js` reports nothing to apply (the dump has the schema).
5. [ ] Start the stack; `GET /api/v1/health` returns `ok` within 2 minutes (worker heartbeat included).
6. [ ] Log in as an admin. `/admin` shows the current term and round; the counts match the live system.
7. [ ] Open three evaluations from different rounds: photos load (thumbnails and full size) and the PDF opens.
8. [ ] `/admin/settings/privacy` lists the terms with the same delete dates as the live system.
9. [ ] The ปพ.5 API answers with the CSV header on the spare machine (`curl -H "Authorization: Bearer …"`).
10. [ ] Note how long steps 2–5 took (target: under 1 hour). Destroy the spare copy (`docker compose down -v`,
        delete `/tmp/restore`) — it holds real data.

Retention runs inside the restored copy too: a restore of an old backup re-creates data that `retention.run`
already deleted, and the next 03:00 run deletes it again (BR-D3), so an old backup never extends retention.
Migrations are forward-only; take a backup first (`sh deploy/backup.sh`).

## 4. Monitoring
- `GET /api/v1/health` every 5 min from an external uptime monitor (e.g. Cloudflare health check).
- Worker heartbeat older than 3 min → health returns `degraded`.
- Disk usage alert at 80 % (simple cron + `df` + notify admins via the app's `sync_problem`-style notification).

## 5. Restore (tested procedure)
```sh
age -d -i backup.key zw-YYYYMMDD-HHMM.tar.age | tar -x -C /tmp/restore
docker compose -f deploy/docker-compose.yml up -d db
docker compose -f deploy/docker-compose.yml exec -T db pg_restore -U zw -d zw --clean --if-exists < /tmp/restore/db.dump
docker run --rm -v azizstan-zero-waste_app-data:/data -v /tmp/restore:/in alpine tar -C /data -xzf /in/files.tgz
docker compose -f deploy/docker-compose.yml up -d
```
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
4. [ ] `docker compose … run --rm app node scripts/migrate.js` reports nothing to apply (the dump has the schema).
5. [ ] Start the stack; `GET /api/v1/health` returns `ok` within 2 minutes (worker heartbeat included).
6. [ ] Log in as an admin. `/admin` shows the current term and round; the counts match the live system.
7. [ ] Open three evaluations from different rounds: photos load (thumbnails and full size) and the PDF opens.
8. [ ] `/admin/settings/privacy` lists the terms with the same delete dates as the live system.
9. [ ] The ปพ.5 API answers with the CSV header on the spare machine (`curl -H "Authorization: Bearer …"`).
10. [ ] Note how long steps 2–5 took (target: under 1 hour). Destroy the spare copy (`docker compose down -v`,
        delete `/tmp/restore`) — it holds real data.

Retention runs inside the restored copy too: a restore of an old backup re-creates data that `retention.run`
already deleted, and the next 03:00 run deletes it again (BR-D3), so an old backup never extends retention.
