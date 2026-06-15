-- 0002_users_cosign.sql
-- Adds the user/role system, admin-only invitations, and co-signature.
-- See ARCHITECTURE.md §4, §5, §8 and packages/contracts/src/index.ts.
--
-- Invariants preserved:
--   * `records` stays append-only (untouched here; cosign grants land in the
--     SEPARATE `sealed_keys` table, never mutating an immutable record).
--   * The server stays BLIND: it stores only public identities, opaque
--     password-wrapped secrets, hashes of invitation codes, and signatures —
--     never plaintext, DEKs, passwords, secret keys, or invitation codes in clear.
--   * `users` (the former `helpers` table) MAY be UPDATEd for role/status — it is
--     operational account state, NOT the immutable record log.

-- ---------------------------------------------------------------------------
-- helpers → users: add role + status + invitedByKeyId + lastSeenAt
-- ---------------------------------------------------------------------------
-- We extend the existing `helpers` table in place (rather than renaming, to keep
-- all existing FKs from `records`/`sealed_keys` lookups working) and treat it as
-- the `users` table going forward. Role defaults to 'helper'; existing rows
-- become active helpers.

ALTER TABLE helpers
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'helper'
    CHECK (role IN ('admin', 'lead', 'helper'));
ALTER TABLE helpers
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled'));
ALTER TABLE helpers
  ADD COLUMN IF NOT EXISTS invited_by_key_id text;
ALTER TABLE helpers
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS helpers_role_idx ON helpers(org_id, role);

-- ---------------------------------------------------------------------------
-- invitations: single-use, admin-issued. ONLY a hash of the code is stored.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invitations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  role               text NOT NULL CHECK (role IN ('admin', 'lead', 'helper')),
  display_name       text,
  -- base64url HMAC/SHA-256 of the single-use code. The code itself is NEVER
  -- stored; it is returned to the admin exactly once on creation.
  code_hash          text NOT NULL UNIQUE,
  status             text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'redeemed', 'revoked', 'expired')),
  created_by_key_id  text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  redeemed_by_key_id text,
  redeemed_at        timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_org_idx ON invitations(org_id, status);

-- ---------------------------------------------------------------------------
-- cosignature_requests: ask one or more signers to counter-sign a record.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cosignature_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id           uuid NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  deployment_id       uuid NOT NULL,
  org_id              uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  requested_by_key_id text NOT NULL,
  -- KeyId[] of the requested signers (public signing identities).
  requested_signers   jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partially-signed', 'complete', 'rejected')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  note                text
);
CREATE INDEX IF NOT EXISTS cosign_requests_org_idx ON cosignature_requests(org_id, status);
CREATE INDEX IF NOT EXISTS cosign_requests_record_idx ON cosignature_requests(record_id);

-- ---------------------------------------------------------------------------
-- cosignatures: one decision (signed/rejected) per signer per request.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cosignatures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES cosignature_requests(id) ON DELETE RESTRICT,
  record_id       uuid NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  signer_key_id   text NOT NULL,
  decision        text NOT NULL CHECK (decision IN ('signed', 'rejected')),
  -- base64 Ed25519 signature over the record's recordHash by the co-signer.
  signature       text NOT NULL,
  -- optional hand-drawn signature image: EncryptedBlobRef descriptor (opaque).
  signature_image jsonb,
  signed_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cosignatures_request_signer_unique UNIQUE (request_id, signer_key_id)
);
CREATE INDEX IF NOT EXISTS cosignatures_request_idx ON cosignatures(request_id);

-- ---------------------------------------------------------------------------
-- sealed_keys: allow recipientType 'cosigner' (co-sign read grants).
-- ---------------------------------------------------------------------------
-- Drop the old 2-value CHECK and re-add it with the 'cosigner' member so a
-- co-sign grant can be appended without mutating the immutable record.

ALTER TABLE sealed_keys DROP CONSTRAINT IF EXISTS sealed_keys_recipient_type_check;
ALTER TABLE sealed_keys
  ADD CONSTRAINT sealed_keys_recipient_type_check
  CHECK (recipient_type IN ('org', 'helper', 'cosigner'));

-- ---------------------------------------------------------------------------
-- Least-privilege grants for the new operational tables.
-- ---------------------------------------------------------------------------
-- invitations / cosignature_requests / cosignatures are operational (not the
-- immutable record log): the app may INSERT/SELECT/UPDATE them. We do NOT grant
-- DELETE (status transitions are UPDATEs; rows are kept for audit).

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    GRANT SELECT, INSERT, UPDATE ON invitations TO aidlog_app;
    GRANT SELECT, INSERT, UPDATE ON cosignature_requests TO aidlog_app;
    GRANT SELECT, INSERT, UPDATE ON cosignatures TO aidlog_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aidlog_app;
  END IF;
END
$$;
