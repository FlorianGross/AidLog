#!/usr/bin/env bash
# ============================================================================
# Aidlog backup — Postgres dump + MinIO blob mirror.
#
# Produces, under $BACKUP_DIR/<timestamp>/:
#   - postgres.sql.gz   (full pg_dump of the aidlog database)
#   - blobs/            (mirror of the MinIO blob bucket)
#   - MANIFEST.txt      (what was backed up, when, sizes)
#
# ─────────────────────────────────────────────────────────────────────────────
# PRIVACY NOTE (read this):
#   These backups contain ONLY CIPHERTEXT. The server is a blind store: protocol
#   payloads and attachments are end-to-end encrypted on the client, and the
#   Postgres rows / MinIO objects are opaque blobs the server cannot read. That
#   is excellent for GDPR (a backup leak does NOT expose patient data).
#
#   BUT the metadata (org/helper public identities, timestamps, record counts,
#   deployment ids) is still personal-data-adjacent and the ciphertext is only
#   as safe as the org password. So:
#     - Store backups ENCRYPTED AT REST and ACCESS-CONTROLLED.
#     - Prefer an off-site, separately-encrypted copy (e.g. age/gpg + restic).
#     - Apply retention limits; don't keep dumps forever (data minimisation).
# ─────────────────────────────────────────────────────────────────────────────
#
# Usage (run from the repo root, with the stack up):
#   ./infra/scripts/backup.sh
#
# Env (sourced from infra/.env by default; override on the command line):
#   ENV_FILE     path to env file        (default: infra/.env)
#   BACKUP_DIR   where to write backups   (default: ./backups)
#   COMPOSE_FILE compose file             (default: infra/docker-compose.yml)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/infra/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/infra/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"

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

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$TS"
mkdir -p "$DEST/blobs"
# Tighten perms: backups are sensitive even as ciphertext.
chmod 700 "$BACKUP_DIR" "$DEST"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

echo "[backup] Postgres dump -> $DEST/postgres.sql.gz"
# pg_dump as the owner; pipe through gzip on the host.
dc exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip -9 > "$DEST/postgres.sql.gz"

echo "[backup] MinIO blob mirror -> $DEST/blobs/"
# Use a throwaway mc container on the compose network to mirror the bucket out.
dc run --rm --no-deps -T \
  -v "$DEST/blobs:/backup" \
  --entrypoint /bin/sh minio-setup -c '
    set -e
    mc alias set local http://minio:9000 "'"$MINIO_ROOT_USER"'" "'"$MINIO_ROOT_PASSWORD"'" >/dev/null
    mc mirror --overwrite --remove "local/'"$S3_BUCKET"'" /backup
  '

PG_SIZE="$(du -h "$DEST/postgres.sql.gz" | cut -f1)"
BLOB_SIZE="$(du -sh "$DEST/blobs" | cut -f1)"
cat > "$DEST/MANIFEST.txt" <<EOF
Aidlog backup
created_utc : $TS
postgres_db : $POSTGRES_DB
pg_dump     : postgres.sql.gz ($PG_SIZE)
blob_bucket : $S3_BUCKET
blobs       : blobs/ ($BLOB_SIZE)

CONTENTS ARE CIPHERTEXT ONLY (server is a blind store). Still store encrypted
and access-controlled. See infra/scripts/backup.sh header + infra/README.md.
EOF

echo "[backup] done: $DEST"
echo "[backup] REMINDER: copy this off-site and encrypt at rest (e.g. age/gpg/restic)."
