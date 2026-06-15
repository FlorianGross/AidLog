-- 0010_qualifications.sql
-- Personal & Qualifikationen module: Sanitätsdienst qualification per account +
-- a per-deployment Anwesenheit/Dienst ROSTER.
--
-- See packages/contracts/src/index.ts (Qualification/QUALIFICATIONS,
-- SetQualificationRequest, OwnAccountResponse, RosterEntry/RosterListResponse/
-- RosterUpsertRequest, ROUTES.account / userQualification / deploymentRoster)
-- and apps/api/src/routes/users.ts + apps/api/src/routes/roster.ts.
--
-- PRIVACY: both the helpers.qualification column and the deployment_roster table
-- carry ONLY OPERATIONAL personnel/duty metadata (an Ausbildungsstand, who is on
-- duty, check-in/out times) — NEVER patient/health data. This is NOT GDPR Art. 9
-- data and may be stored in clear. NEVER add a patient/health column here.

-- ---------------------------------------------------------------------------
-- (1) Qualification attribute on the account (`helpers`). Nullable = unset.
-- helpers is already mutable config (aidlog_app has UPDATE from 0001), so no new
-- grant is required to write this column.
-- ---------------------------------------------------------------------------
ALTER TABLE helpers ADD COLUMN IF NOT EXISTS qualification text;

-- ---------------------------------------------------------------------------
-- (2) Per-deployment roster (Anwesenheit/Dienst). MUTABLE operational state:
-- a helper checks themselves in/out; an admin/lead manages others. PRIMARY KEY
-- (deployment_id, helper_key_id) makes each helper appear at most once per
-- deployment and lets an upsert be an ON CONFLICT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deployment_roster (
  deployment_id   uuid NOT NULL,
  org_id          uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  helper_key_id   text NOT NULL,
  display_name    text NOT NULL,
  qualification   text,
  role_at_event   text,
  checked_in_at   timestamptz,
  checked_out_at  timestamptz,
  PRIMARY KEY (deployment_id, helper_key_id)
);
CREATE INDEX IF NOT EXISTS deployment_roster_org_idx
  ON deployment_roster(org_id, deployment_id);

-- ---------------------------------------------------------------------------
-- Grants: deployment_roster is mutable operational config — SELECT/INSERT/
-- UPDATE/DELETE for aidlog_app (no append-only trigger; the roster is editable).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON deployment_roster TO aidlog_app;
