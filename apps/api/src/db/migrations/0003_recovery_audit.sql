-- 0003_recovery_audit.sql
-- Adds organisation-key RECOVERY METADATA (Shamir) and an administrative
-- AUDIT LOG for offboarding/administrative actions.
-- See packages/contracts/src/index.ts (RecoveryConfig, AuditEntry) and
-- packages/crypto-core (splitSecret/combineSecret).
--
-- Invariants preserved:
--   * The server stays BLIND. CRITICAL: `recovery_config` stores ONLY
--     non-secret METADATA (threshold, share count, trustee labels, a public-key
--     check value). It MUST NEVER store a Shamir share, the org secret key, or
--     any password. Shares are exported to human trustees client-side and are
--     never transmitted to the server. This is enforced in the route code as
--     well (no share/secret field is ever read from the request or written).
--   * `records` stays append-only and is UNTOUCHED by this migration.
--   * `audit_log` is operational/administrative state only: it records WHO did
--     WHAT and WHEN (key ids + action + timestamp + a short free-text detail),
--     NEVER patient data, ciphertext, DEKs, secrets, or invitation codes.

-- ---------------------------------------------------------------------------
-- recovery_config: ONE row per org. METADATA ONLY — never a share or secret.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recovery_config (
  org_id              uuid PRIMARY KEY REFERENCES orgs(org_id) ON DELETE RESTRICT,
  -- T shares required to reconstruct; 2 <= threshold <= share_count <= 255.
  threshold           integer NOT NULL CHECK (threshold >= 2 AND threshold <= 255),
  -- N shares issued.
  share_count         integer NOT NULL CHECK (share_count >= threshold AND share_count <= 255),
  -- RecoveryTrustee[] : [{ id, label }] — labels only, NO share material.
  trustees            jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_key_id   text NOT NULL,
  -- Optional BLAKE2b of the org PUBLIC box key, so a client can verify a
  -- reconstruction rebuilt the correct key. Public, non-secret.
  org_key_check       text
);

-- ---------------------------------------------------------------------------
-- audit_log: append-mostly administrative event log (offboarding & admin).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  -- keyId of the actor who performed the action (admin/lead/system).
  actor_key_id    text NOT NULL,
  action          text NOT NULL CHECK (action IN (
    'user.invited',
    'user.redeemed',
    'user.disabled',
    'user.enabled',
    'user.role-changed',
    'recovery.configured',
    'shift.closed'
  )),
  -- keyId of the subject of the action, when applicable (e.g. the disabled user).
  target_key_id   text,
  at              timestamptz NOT NULL DEFAULT now(),
  -- short, non-sensitive free text (e.g. "helper -> lead"). NEVER patient data.
  detail          text
);
CREATE INDEX IF NOT EXISTS audit_log_org_at_idx ON audit_log(org_id, at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- Least-privilege grants for the application role.
-- ---------------------------------------------------------------------------
-- recovery_config: upserted on (re)configuration -> SELECT/INSERT/UPDATE.
--                  No DELETE (a configured recovery policy is not silently removed).
-- audit_log:       INSERT to record events, SELECT to read them back for admins.
--                  No UPDATE/DELETE: audit entries are immutable once written.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    GRANT SELECT, INSERT, UPDATE ON recovery_config TO aidlog_app;
    GRANT SELECT, INSERT ON audit_log TO aidlog_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aidlog_app;
  END IF;
END
$$;
