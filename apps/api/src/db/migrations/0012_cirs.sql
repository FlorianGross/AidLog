-- 0012_cirs.sql
-- CIRS — Critical Incident Reporting System: ANONYMOUS critical-incident reports
-- for quality management.
--
-- See packages/contracts/src/index.ts (CirsSubmission, CirsReport,
-- CirsListResponse, SetCirsStatusRequest, CirsStatus, ROUTES.cirs /
-- ROUTES.cirsStatus) and apps/api/src/routes/cirs.ts.
--
-- ANONYMITY IS THE CORE PROPERTY — DO NOT VIOLATE:
--   * `cirs_reports` holds ONLY ciphertext + the single ORG-sealed DEK
--     (crypto_box_seal — anonymous sender). There is DELIBERATELY NO submitter /
--     author / session / IP column: the report is NOT attributable to its
--     reporter. NEVER add such a column. The report is NEVER signed.
--   * The payload DEK is sealed to the ORG box public key ONLY; only QM/admin can
--     decrypt it with the org secret (org-password unlock), exactly like the
--     admin "Auswertung" path. The server stays BLIND to the content.
--   * `created_at` is a coarse calendar DATE (no time) to blunt timing-based
--     correlation of a report back to a submission moment. (Residual limit: a
--     malicious operator could still correlate the authenticated request / IP /
--     timing of the live submit; true network anonymity is out of scope — this is
--     documented to the reporter in the UI.)
--
-- Append-only: `cirs_reports` is INSERT-ONLY, enforced at TWO layers exactly like
-- `records` (0001): (a) a BEFORE UPDATE OR DELETE trigger that RAISES, and (b) a
-- least-privilege grant of SELECT, INSERT only. A report's CONTENT can never be
-- mutated; the mutable QM workflow lives in a SEPARATE `cirs_status` table.
--
-- Only the REVIEWER is identified (reviewer_key_id on cirs_status) — that is fine;
-- only the REPORTER must stay anonymous.

-- ---------------------------------------------------------------------------
-- cirs_reports: the ANONYMOUS, append-only encrypted report content.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cirs_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  -- { aead } algorithm pin (jsonb to mirror records.alg shape; opaque).
  alg         jsonb NOT NULL,
  -- base64 AEAD nonce.
  nonce       text NOT NULL,
  -- base64 AEAD payload (XChaCha20-Poly1305 over canonical JSON of the form).
  ciphertext  text NOT NULL,
  -- base64 crypto_box_seal(DEK, org box public key). The ONLY recipient; an
  -- anonymous-sender sealed box (no author/reporter key is involved).
  sealed_key  text NOT NULL,
  -- COARSENED to date precision (no time) to reduce timing correlation. There is
  -- intentionally NO submitter/session/IP column on this table.
  created_at  date NOT NULL DEFAULT CURRENT_DATE
);
-- List a caller-org's reports (newest first by id ordering is done in the query;
-- created_at is coarse so it is not a tiebreaker for anonymity).
CREATE INDEX IF NOT EXISTS cirs_reports_org_idx ON cirs_reports(org_id);

-- ---------------------------------------------------------------------------
-- cirs_status: the MUTABLE QM workflow. ONE row per report. Only the REVIEWER is
-- identified here (reviewer_key_id) — never the reporter.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cirs_status (
  report_id       uuid PRIMARY KEY REFERENCES cirs_reports(id) ON DELETE RESTRICT,
  org_id          uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'neu'
                    CHECK (status IN ('neu', 'in_bearbeitung', 'abgeschlossen')),
  -- keyId of the admin/QM reviewer who last changed the status. NON-anonymous by
  -- design (reviewer accountability); null until first touched.
  reviewer_key_id text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cirs_status_org_idx ON cirs_status(org_id, status);

-- ---------------------------------------------------------------------------
-- Append-only enforcement for cirs_reports (mirrors records_reject_mutation).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cirs_reports_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'cirs_reports is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS cirs_reports_no_update_delete ON cirs_reports;
CREATE TRIGGER cirs_reports_no_update_delete
  BEFORE UPDATE OR DELETE ON cirs_reports
  FOR EACH ROW
  EXECUTE FUNCTION cirs_reports_reject_mutation();

-- ---------------------------------------------------------------------------
-- Least-privilege grants.
--   * cirs_reports: append-only — SELECT, INSERT only (no UPDATE, no DELETE),
--     mirroring `records`.
--   * cirs_status:  mutable workflow — SELECT, INSERT, UPDATE (no DELETE).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    GRANT SELECT, INSERT ON cirs_reports TO aidlog_app;
    GRANT SELECT, INSERT, UPDATE ON cirs_status TO aidlog_app;
  END IF;
END
$$;
