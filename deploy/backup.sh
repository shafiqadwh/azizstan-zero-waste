#!/usr/bin/env sh
# Nightly backup: database dump + uploads/pdf, encrypted with age, copied off the machine with rclone.
# Run from the host (cron 30 1 * * *):  sh deploy/backup.sh
set -eu
STAMP=$(date +%Y%m%d-%H%M)
DIR=$(cd "$(dirname "$0")" && pwd)
OUT="$DIR/backup/zw-$STAMP"
mkdir -p "$OUT"

# 1. Database (custom format, restorable with pg_restore)
sh "$DIR/zw.sh" exec -T db pg_dump -U zw -d zw -Fc > "$OUT/db.dump"

# 2. Files from the app-data volume: everything (uploads/, pdf/, orders/, and any folder added later) except tmp/
docker run --rm -v azizstan-zero-waste_app-data:/data:ro -v "$OUT":/out alpine \
  tar -C /data --exclude=./tmp -czf /out/files.tgz .

# 3. Encrypt (public key in deploy/backup.pub; private key kept OFF this machine)
tar -C "$OUT" -cf - . | age -R "$DIR/backup.pub" > "$OUT.tar.age"
rm -rf "$OUT"

# 4. Copy off-machine (rclone remote configured once: school NAS / Google Drive of the school account)
rclone copy "$OUT.tar.age" zw-backup:azizstan-zero-waste/ --quiet

# 5. Record the time in the app (shown on /admin/settings/privacy) — only reached when the off-site copy worked
sh "$DIR/zw.sh" exec -T db psql -U zw -d zw -q -c \
  "INSERT INTO app_settings (key, value, updated_at) VALUES ('backup.last', jsonb_build_object('at', now()), now())
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"

# 6. Keep 14 local copies
ls -1t "$DIR"/backup/zw-*.tar.age | tail -n +15 | xargs -r rm --
echo "backup ok: $OUT.tar.age"
