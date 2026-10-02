#!/usr/bin/env sh
# docker compose for this stack, from any directory: reads the repository's .env for both the containers and
# the ${…} values in docker-compose.yml (plain `docker compose -f deploy/docker-compose.yml` only looks for
# deploy/.env and stops at "required variable … is missing a value").
#   sh deploy/zw.sh up -d
#   sh deploy/zw.sh run --rm app node scripts/preflight.js
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
exec docker compose --env-file "$ROOT/.env" -f "$ROOT/deploy/docker-compose.yml" "$@"
