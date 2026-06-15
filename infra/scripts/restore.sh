#!/usr/bin/env bash
# ============================================================================
# Aidlog restore — reverse of backup.sh.
#
# Restores a backup directory produced by backup.sh:
#   <backup>/postgres.sql.gz   -> Postgres (aidlog database)
#   <backup>/blobs/            -> MinIO blob bucket
#
# ⚠️  DESTRUCTIVE: this overwrites the current database contents and mirrors the
#     bucket to match the backup (extra objects in the live bucket are REMOVED).
#     Take a fresh backup first if the current data matters.
#
# Like the backups themselves, the restored data is CIPHERTEXT ONLY — restoring
# does NOT make patient data readable to the server. Decryption still requires
# the org password on a client.
#
# Usage (stack must be up; run from repo root):
#   ./infra/scripts/restore.sh ./backups/20260101T000000Z
#
# Env:
#   ENV_FILE     (default: infra/.env)
#   COMPOSE_FILE (default: infra/docker-compose.yml)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/infra/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/infra/docker-compose.yml}"

SRC="${1:-}"
if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  echo "Usage: $0 <backup-directory>" >&2
  echo "  e.g. $0 ./backups/20260101T000000Z" >&2
  exit 1
fi
SRC="$(cd "$SRC" && pwd)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${POSTGRES_USER:?missing in env}"
: "${POSTGRES_DB:?missing in env}"
: "${MINIO_ROOT_USER:?missing in env}"
: "${MINIO_ROOT_PASSWORD:?missing in env}"
: "${S3_BUCKET:?missing in env}"

[[ -f "$SRC/postgres.sql.gz" ]] || { echo "ERROR: $SRC/postgres.sql.gz missing" >&2; exit 1; }
[[ -d "$SRC/blobs" ]]          || { echo "ERROR: $SRC/blobs/ missing" >&2; exit 1; }

echo "About to RESTORE from: $SRC"
echo "  -> Postgres database '$POSTGRES_DB' will be OVERWRITTEN"
echo "  -> MinIO bucket '$S3_BUCKET' will be MIRRORED to match the backup"
read -r -p "Type 'RESTORE' to continue: " confirm
[[ "$confirm" == "RESTORE" ]] || { echo "Aborted."; exit 1; }

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

echo "[restore] Postgres <- $SRC/postgres.sql.gz"
# Recreate a clean public schema as the owner, then load the dump.
dc exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
gunzip -c "$SRC/postgres.sql.gz" \
  | dc exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1
# Re-assert least-privilege grants for the app role (the dump used --no-privileges).
dc exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
GRANT USAGE ON SCHEMA public TO aidlog_app;
GRANT SELECT, INSERT ON records TO aidlog_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, helpers, schemas, sessions, auth_challenges TO aidlog_app;
GRANT SELECT, INSERT, DELETE ON sealed_keys TO aidlog_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aidlog_app;
SQL

echo "[restore] MinIO bucket <- $SRC/blobs/"
dc run --rm --no-deps -T \
  -v "$SRC/blobs:/backup:ro" \
  --entrypoint /bin/sh minio-setup -c '
    set -e
    mc alias set local http://minio:9000 "'"$MINIO_ROOT_USER"'" "'"$MINIO_ROOT_PASSWORD"'" >/dev/null
    mc mb --ignore-existing "local/'"$S3_BUCKET"'" >/dev/null
    mc mirror --overwrite --remove /backup "local/'"$S3_BUCKET"'"
  '

echo "[restore] done. Restart the api so it picks up a clean state:"
echo "          docker compose -f $COMPOSE_FILE --env-file $ENV_FILE restart api"
