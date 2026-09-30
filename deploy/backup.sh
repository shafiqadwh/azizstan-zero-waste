#!/usr/bin/env sh
# Nightly backup: database dump + uploads/pdf, encrypted with age, copied off the machine with rclone.
# Run from the host (cron 30 1 * * *):  sh deploy/backup.sh
set -eu
STAMP=$(date +%Y%m%d-%H%M)
DIR=$(cd "$(dirname "$0")" && pwd)
OUT="$DIR/backup/zw-$STAMP"
mkdir -p "$OUT"

# 1. Database (custom format, restorable with pg_restore)
docker compose -f "$DIR/docker-compose.yml" exec -T db pg_dump -U zw -d zw -Fc > "$OUT/db.dump"

# 2. Files (uploads + pdf) from the app-data volume
docker run --rm -v azizstan-zero-waste_app-data:/data:ro -v "$OUT":/out alpine \
  tar -C /data -czf /out/files.tgz uploads pdf

# 3. Encrypt (public key in deploy/backup.pub; private key kept OFF this machine)
tar -C "$OUT" -cf - . | age -R "$DIR/backup.pub" > "$OUT.tar.age"
rm -rf "$OUT"

# 4. Copy off-machine (rclone remote configured once: school NAS / Google Drive of the school account)
rclone copy "$OUT.tar.age" zw-backup:azizstan-zero-waste/ --quiet

# 5. Keep 14 local copies
ls -1t "$DIR"/backup/zw-*.tar.age | tail -n +15 | xargs -r rm --
echo "backup ok: $OUT.tar.age"
