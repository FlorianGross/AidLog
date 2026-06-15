-- 0009_retention.sql
-- GDPR Löschkonzept: org-wide RETENTION policy + tamper-evident ERASURE log.
--
-- See packages/contracts/src/index.ts (RetentionPolicy, SetRetentionRequest,
-- PurgeRequest/PurgeResponse, DeletionLogEntry, ROUTES.orgRetention /
-- orgRetentionPurge / deletionLog) and apps/api/src/routes/retention.ts.
--
-- ERASURE = CRYPTO-SHREDDING: the actual deletion of personal data is performed
-- by DELETEing rows from the existing `sealed_keys` table (already GRANTed
-- DELETE to aidlog_app in 0001) — never from the append-only `records` table.
-- This migration only adds (a) the retention POLICY store and (b) the append-
-- only deletion AUDIT log; the shredding itself reuses sealed_keys.
--
-- Append-only audit is enforced exactly like `records` in 0001: a BEFORE
-- UPDATE OR DELETE trigger raises an exception, AND the app role is granted
-- SELECT + INSERT only (no UPDATE/DELETE privilege). Defence in depth.

-- ---------------------------------------------------------------------------
-- Retention policy (one row per org). Mutable config (admin CRUD): SELECT /
-- INSERT / UPDATE. retention_days measured from records.received_at.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_policies (
  org_id             uuid PRIMARY KEY REFERENCES orgs(org_id) ON DELETE RESTRICT,
  retention_days     integer NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by_key_id  text
);

-- ---------------------------------------------------------------------------
-- Deletion log (append-only erasure audit). NON-secret metadata only: WHO/
-- WHAT/WHEN of a crypto-shredding action — never patient data, ciphertext, a
-- DEK, or a secret key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deletion_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  scope               text NOT NULL CHECK (scope IN ('policy', 'deployment')),
  deployment_id       uuid,
  records_affected    integer NOT NULL,
  sealed_keys_deleted integer NOT NULL,
  cutoff              text,
  reason              text,
  executed_by_key_id  text NOT NULL,
  executed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deletion_log_org_at_idx
  ON deletion_log(org_id, executed_at, id);

-- ---------------------------------------------------------------------------
-- Append-only enforcement (a): trigger. Mirrors records_reject_mutation()
-- from 0001 — any UPDATE or DELETE against deletion_log aborts the transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deletion_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'deletion_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS deletion_log_no_update_delete ON deletion_log;
CREATE TRIGGER deletion_log_no_update_delete
  BEFORE UPDATE OR DELETE ON deletion_log
  FOR EACH ROW
  EXECUTE FUNCTION deletion_log_reject_mutation();

-- ---------------------------------------------------------------------------
-- Append-only enforcement (b): least-privilege grants.
--   retention_policies: mutable config — SELECT/INSERT/UPDATE (no DELETE).
--   deletion_log: append-only audit — SELECT/INSERT only (no UPDATE/DELETE).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON retention_policies TO aidlog_app;
GRANT SELECT, INSERT ON deletion_log TO aidlog_app;
