-- 0006_notarization_perf.sql
-- Adds LEGALLY-ROBUST ARCHIVAL ANCHORING (tamper-evident Merkle anchor + trusted
-- timestamp over the record hash-chain) and a handful of PERFORMANCE INDICES.
--
-- See packages/contracts/src/index.ts (NotarizationAnchor, ROUTES.notarize) and
-- apps/api/src/anchor.ts / routes/notarize.ts.
--
-- Invariants preserved:
--   * The server stays BLIND. CRITICAL: `notarization_anchors` stores ONLY
--     non-secret INTEGRITY METADATA: a Merkle root over PUBLIC `records.record_hash`
--     values, a server signature over that root, and (optionally) an RFC 3161
--     timestamp token. It MUST NEVER hold patient data, ciphertext, a DEK, a
--     password, or any secret key. The Merkle tree is computed over metadata the
--     server already stores (record_hash / prev_hash / seq) — NOTHING is decrypted.
--   * `records` stays append-only and is UNTOUCHED by this migration (no DDL/DML
--     against it; we only ADD read indices via CREATE INDEX IF NOT EXISTS, which
--     does not alter the table's append-only trigger or grants).
--   * Anchors are append-only-ish: the app role gets INSERT/SELECT only (an anchor,
--     once written, is durable evidence and is never updated or deleted in place).

-- ---------------------------------------------------------------------------
-- notarization_anchors: one row per anchoring event for an org.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notarization_anchors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  -- base64 BLAKE2b-256 Merkle root over the org's record_hash leaves, ordered by
  -- (deployment_id, seq). PUBLIC integrity metadata — never content.
  merkle_root       text NOT NULL,
  -- Number of record leaves the root was built from (> 0).
  record_count      integer NOT NULL CHECK (record_count > 0),
  -- Pinned Merkle/signature scheme identifier (e.g. 'merkle-blake2b-256/v1').
  algorithm         text NOT NULL,
  -- base64 server signature (HMAC-SHA256) over the canonical anchor string.
  -- Authenticates the anchor to this server; NOT a content key.
  server_signature  text NOT NULL,
  -- RFC 3161 TSA-asserted time, NULL when no TSA is configured (baseline anchor).
  tsa_time          timestamptz,
  -- RFC 3161 timestamp token (DER), NULL when no TSA is configured. Opaque, public.
  tsa_token         bytea,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- List anchors for an org, newest first (GET /api/notarize).
CREATE INDEX IF NOT EXISTS notarization_anchors_org_created_idx
  ON notarization_anchors(org_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Performance indices (additive). We REVIEWED the existing query paths and the
-- indices already shipped in 0001/0003; the ones below are the genuinely missing
-- ones. Existing indices we did NOT duplicate:
--   * records(deployment_id, seq)        — 0001 records_deployment_idx
--   * records(org_id, ingest_seq)        — 0001 records_org_ingest_idx (drives sync)
--   * sealed_keys(record_id)             — 0001 sealed_keys_record_idx
--   * audit_log(org_id, at DESC, id DESC)— 0003 audit_log_org_at_idx
-- ---------------------------------------------------------------------------

-- The anchor build scans every record of an org ORDERED BY (deployment_id, seq)
-- to lay out the Merkle leaves deterministically. The existing
-- records_deployment_idx is (deployment_id, seq) only (no org_id leading column),
-- so an org-scoped ordered scan still filters by org_id first. This composite
-- index serves the exact (org_id, deployment_id, seq) ordered read the anchor
-- builder issues, avoiding a sort.
CREATE INDEX IF NOT EXISTS records_org_deployment_seq_idx
  ON records(org_id, deployment_id, seq);

-- ---------------------------------------------------------------------------
-- Extend the audit_log action whitelist with the new 'archive.anchored' event so
-- creating an anchor can be recorded (WHO/WHAT/WHEN; never content). We replace
-- the CHECK in place — audit_log rows are untouched, only the constraint grows.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.table_constraints
    WHERE table_name = 'audit_log' AND constraint_name = 'audit_log_action_check'
  ) THEN
    ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
  END IF;
END
$$;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'user.invited',
  'user.redeemed',
  'user.disabled',
  'user.enabled',
  'user.role-changed',
  'recovery.configured',
  'shift.closed',
  'archive.anchored'
));

-- ---------------------------------------------------------------------------
-- Least-privilege grants for the application role.
--   notarization_anchors: INSERT to create an anchor, SELECT to list/verify.
--                         No UPDATE/DELETE — an anchor is immutable evidence.
-- The records indices above need no grant (CREATE INDEX runs as the owner here).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    GRANT SELECT, INSERT ON notarization_anchors TO aidlog_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aidlog_app;
  END IF;
END
$$;
