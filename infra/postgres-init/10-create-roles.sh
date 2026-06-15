#!/usr/bin/env bash
# Postgres init hook — runs ONCE, on first cluster initialisation (empty data
# dir), via the official postgres image's /docker-entrypoint-initdb.d mechanism.
#
# Responsibilities:
#   1. Ensure the application database exists (created by POSTGRES_DB already).
#   2. Create the least-privilege application role `aidlog_app` WITH A PASSWORD.
#
# Why here and not only in the SQL migration:
#   migrations/0001_init.sql creates `aidlog_app` as `CREATE ROLE aidlog_app
#   LOGIN` *without a password*, guarded by `IF NOT EXISTS`. A role with no
#   password cannot authenticate over TCP (md5/scram). By pre-creating the role
#   here WITH a password, the migration's IF-NOT-EXISTS guard skips creation and
#   only applies the GRANTs. Result: the app can log in as aidlog_app, and the
#   append-only privilege model from the migration is preserved.
#
# The migration OWNER is the superuser (POSTGRES_USER) — privileged, used only by
# the one-shot `migrate` service, never by the running api.
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${AIDLOG_APP_DB_PASSWORD:?AIDLOG_APP_DB_PASSWORD must be set (password for the least-privilege aidlog_app role)}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
      CREATE ROLE aidlog_app LOGIN PASSWORD '${AIDLOG_APP_DB_PASSWORD}';
    ELSE
      ALTER ROLE aidlog_app LOGIN PASSWORD '${AIDLOG_APP_DB_PASSWORD}';
    END IF;
  END
  \$\$;

  -- pgcrypto provides gen_random_uuid() used by the schema defaults. Built-in
  -- on PG13+, but the extension must be enabled in this database.
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

echo "[postgres-init] aidlog_app role ensured with password; pgcrypto enabled."
