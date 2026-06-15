-- 0001_init.sql
-- Aidlog BLIND sync store schema. See ARCHITECTURE.md §1, §4, §5.
--
-- Append-only guarantee is enforced at TWO independent layers:
--   (a) a BEFORE UPDATE OR DELETE trigger on `records` that RAISES EXCEPTION, and
--   (b) a least-privilege DB role (`aidlog_app`) granted only INSERT/SELECT on
--       `records` (no UPDATE/DELETE privilege at all).
-- Either layer alone stops mutation; together they are defence in depth. An
-- attacker who somehow acquires UPDATE privilege still hits the trigger; the
-- trigger cannot be bypassed by the app role because it cannot DROP it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orgs (
  org_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name          text NOT NULL,
  key_id            text NOT NULL UNIQUE,
  identity          jsonb NOT NULL,
  wrapped_secret    jsonb NOT NULL,
  recovery_wrappers jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS helpers (
  helper_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  display_name   text NOT NULL,
  key_id         text NOT NULL UNIQUE,
  identity       jsonb NOT NULL,
  wrapped_secret jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS helpers_org_idx ON helpers(org_id);

CREATE TABLE IF NOT EXISTS records (
  ingest_seq       bigint GENERATED ALWAYS AS IDENTITY,
  id               uuid PRIMARY KEY,
  org_id           uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  deployment_id    uuid NOT NULL,
  seq              integer NOT NULL,
  envelope_version integer NOT NULL,
  author_key_id    text NOT NULL,
  payload          jsonb NOT NULL,
  blobs            jsonb NOT NULL,
  prev_hash        text,
  record_hash      text NOT NULL,
  signature        text NOT NULL,
  alg              jsonb NOT NULL,
  supersedes       uuid,
  created_at       text NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT records_deployment_seq_unique UNIQUE (deployment_id, seq)
);
CREATE INDEX IF NOT EXISTS records_deployment_idx ON records(deployment_id, seq);
CREATE INDEX IF NOT EXISTS records_org_ingest_idx ON records(org_id, ingest_seq);
CREATE INDEX IF NOT EXISTS records_author_idx ON records(author_key_id);

CREATE TABLE IF NOT EXISTS sealed_keys (
  record_id      uuid NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  deployment_id  uuid NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('org', 'helper')),
  recipient_key_id text NOT NULL,
  alg            text NOT NULL,
  ciphertext     text NOT NULL,
  PRIMARY KEY (record_id, recipient_key_id)
);
CREATE INDEX IF NOT EXISTS sealed_keys_deployment_recipient_idx
  ON sealed_keys(deployment_id, recipient_type, recipient_key_id);
CREATE INDEX IF NOT EXISTS sealed_keys_record_idx ON sealed_keys(record_id);

CREATE TABLE IF NOT EXISTS schemas (
  schema_id     text NOT NULL,
  version       integer NOT NULL,
  org_id        uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  title         text NOT NULL,
  description   text,
  json_schema   jsonb NOT NULL,
  ui_schema     jsonb,
  signature     text,
  author_key_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schema_id, version)
);
CREATE INDEX IF NOT EXISTS schemas_org_idx ON schemas(org_id);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  key_id     text NOT NULL,
  org_id     uuid NOT NULL,
  role       text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_key_idx ON sessions(key_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge  text PRIMARY KEY,
  key_id     text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Append-only enforcement layer (a): trigger
-- ---------------------------------------------------------------------------
-- Any UPDATE or DELETE against `records` aborts the transaction. Corrections
-- are made by INSERTing a NEW record with `supersedes` set (never by mutation).

CREATE OR REPLACE FUNCTION records_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'records is append-only: % is not permitted (use a new record with supersedes set)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS records_no_update_delete ON records;
CREATE TRIGGER records_no_update_delete
  BEFORE UPDATE OR DELETE ON records
  FOR EACH ROW
  EXECUTE FUNCTION records_reject_mutation();

-- ---------------------------------------------------------------------------
-- Append-only enforcement layer (b): least-privilege application role
-- ---------------------------------------------------------------------------
-- The migration runs as a privileged role (owner). The app connects as
-- `aidlog_app`, which gets only INSERT/SELECT on `records` — never UPDATE or
-- DELETE — so even a logic bug or SQL-injection can't mutate history.
-- sealed_keys keeps DELETE (needed for shift-close soft revocation).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    CREATE ROLE aidlog_app LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO aidlog_app;

-- records: append-only. INSERT + SELECT only. No UPDATE, no DELETE.
GRANT SELECT, INSERT ON records TO aidlog_app;

-- Mutable / operational tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, helpers, schemas, sessions, auth_challenges TO aidlog_app;
-- sealed_keys: INSERT for writes, DELETE for shift-close soft revocation, SELECT for sync.
GRANT SELECT, INSERT, DELETE ON sealed_keys TO aidlog_app;

-- Identity sequence usage (records.ingest_seq is GENERATED ALWAYS, so no grant
-- needed for it; gen_random_uuid needs pgcrypto which is built-in on PG13+).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aidlog_app;
