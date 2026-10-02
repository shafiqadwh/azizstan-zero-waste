#!/usr/bin/env sh
# docker compose for this stack, from any directory: reads the repository's .env for both the containers and
# the ${…} values in docker-compose.yml (plain `docker compose -f deploy/docker-compose.yml` only looks for
# deploy/.env and stops at "required variable … is missing a value").
# A machine-specific deploy/compose.local.yml (gitignored; e.g. the NAS ports and encrypted-folder volumes in
# deploy/compose.local.example.yml) is added when it exists.
#   sh deploy/zw.sh up -d
#   sh deploy/zw.sh run --rm app node scripts/preflight.js
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -- --env-file "$ROOT/.env" -f "$ROOT/deploy/docker-compose.yml" "$@"
if [ -f "$ROOT/deploy/compose.local.yml" ]; then
  # insert the override right after the base file (before the subcommand)
  first=$1 second=$2 third=$3 fourth=$4
  shift 4
  set -- "$first" "$second" "$third" "$fourth" -f "$ROOT/deploy/compose.local.yml" "$@"
fi
# Docker Engine's compose plugin, or the standalone docker-compose (Synology Container Manager ships that one)
if docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi
exec docker-compose "$@"
