# Aidlog — Backup & Restore Runbook

Operator runbook for the self-hosted Docker Compose stack (`postgres`, `minio`,
`api`, `caddy`). Commands assume you run them from the **repo root** with the
same `--env-file` you deploy with.

```bash
COMPOSE="docker compose -f infra/docker-compose.yml --env-file infra/.env"
```

The service / database / bucket names below are the real ones from
`infra/docker-compose.yml` and `infra/.env(.example)`:

| Thing                    | Value (from .env)                               |
| ------------------------ | ----------------------------------------------- |
| Postgres service         | `postgres`                                      |
| Postgres database        | `${POSTGRES_DB}` (default `aidlog`)             |
| Postgres OWNER role      | `${POSTGRES_USER}` (default `aidlog_owner`)     |
| Least-privilege app role | `aidlog_app` (do NOT dump/restore with this)    |
| MinIO service            | `minio`                                         |
| MinIO root user / pass   | `${MINIO_ROOT_USER}` / `${MINIO_ROOT_PASSWORD}` |
| Blob bucket              | `${S3_BUCKET}` (default `aidlog-blobs`)         |

> Use the **owner** role (`POSTGRES_USER`) for dumps/restores. The running app's
> `aidlog_app` role has INSERT/SELECT only and intentionally cannot restore.

---

## ⚠️ What backups DO and DO NOT contain (read first)

This is a zero-knowledge store. A Postgres dump + MinIO mirror contains **only**:

- **Ciphertext** (password-wrapped secrets, opaque blob ciphertext) and
- **non-secret metadata** (public identities, record hashes/seq, timestamps).

They do **NOT** contain — and CANNOT, by design — any plaintext patient data,
passwords, DEKs, or unwrapped secret keys.

**The org master key and the Shamir recovery shares are NOT in these backups.**
They live only with your operators/admins (the recovery shares were distributed
to shareholders at setup). **If those are lost, the data in the backup is
permanently unrecoverable** — ciphertext with no key is just noise. Safeguard the
org key / recovery shares **separately** from (and with at least the same care
as) these backups. A backup alone is necessary but not sufficient for recovery.

---

## 1. Postgres — logical backup (`pg_dump`)

Take a compressed custom-format dump from inside the running container and stream
it to a file on the host:

```bash
mkdir -p backups
TS=$(date -u +%Y%m%dT%H%M%SZ)

$COMPOSE exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/$TS/postgres-$POSTGRES_DB.dump"
```

(`-Fc` = custom format → restore with `pg_restore`; `-T` disables the TTY so the
redirect works. Export `POSTGRES_USER`/`POSTGRES_DB` from `infra/.env` first, or
inline the literal values.)

### Restore (DESTRUCTIVE — overwrites current data)

Restore into a clean database. The safest path is to recreate the DB, then
restore as the owner:

```bash
# 1. (optional) stop the api so nothing writes mid-restore
$COMPOSE stop api

# 2. drop & recreate the database as the owner
$COMPOSE exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $POSTGRES_DB;" \
  -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"

# 3. restore the dump
$COMPOSE exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner \
  < "backups/<timestamp>/postgres-$POSTGRES_DB.dump"

# 4. re-apply migrations (restores the append-only trigger + aidlog_app grants)
$COMPOSE run --rm migrate

# 5. start the api again
$COMPOSE up -d api
```

> Re-running `migrate` after a restore is important: it re-creates the
> least-privilege `aidlog_app` role grants and the append-only trigger if the
> restored snapshot predates them. It is idempotent.

If you dumped with plain SQL (`pg_dump` without `-Fc`) restore with `psql -f`
instead of `pg_restore`.

---

## 2. MinIO blob bucket — object backup (`mc mirror`)

Blob ciphertext lives in the `${S3_BUCKET}` bucket. Mirror it out with the MinIO
client. Easiest is a throwaway `mc` container on the stack's internal network:

```bash
$COMPOSE run --rm --entrypoint /bin/sh -T \
  -v "$PWD/backups/$TS:/backup" minio-setup -c '
    set -e
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc mirror --overwrite "local/$S3_BUCKET" "/backup/minio-$S3_BUCKET"
  '
```

(The `minio-setup` service already has `mc` and the MinIO root creds + `S3_BUCKET`
in its environment, and is attached to the internal network, so it can reach
`minio:9000`.)

### Restore

Mirror the saved objects back into the bucket (create the bucket first if the
MinIO volume was wiped):

```bash
$COMPOSE run --rm --entrypoint /bin/sh -T \
  -v "$PWD/backups/<timestamp>:/backup" minio-setup -c '
    set -e
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc mb --ignore-existing "local/$S3_BUCKET"
    mc mirror --overwrite "/backup/minio-$S3_BUCKET" "local/$S3_BUCKET"
  '
```

> Restore Postgres and MinIO **together** from the **same** backup timestamp.
> Records in Postgres reference blob IDs in MinIO; mismatched snapshots leave
> dangling references.

---

## 3. Cadence, off-site, and restore tests

- **Cadence:** run both backups together on a schedule (cron / systemd timer).
  Daily is a sane baseline; tighten for higher write volume.
- **Off-site:** copy each backup off the host, **separately encrypted at rest**
  (e.g. `age`, `gpg`, or `restic` to an object store). The backup is ciphertext,
  but encryption-at-rest + access control is still required for defence in depth
  and to satisfy GDPR storage obligations.
- **Retention:** apply a retention policy; don't keep dumps forever.
- **Test restores:** a backup you've never restored is a hypothesis. On a
  schedule (e.g. quarterly), restore the latest backup into a **throwaway**
  stack and confirm the api comes up and `GET /api/health/ready` returns
  `{"status":"ready",...}`. Also confirm a known record decrypts with the org
  key — this is the only check that proves the key + ciphertext still match.
