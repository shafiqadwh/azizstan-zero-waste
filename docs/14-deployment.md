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
