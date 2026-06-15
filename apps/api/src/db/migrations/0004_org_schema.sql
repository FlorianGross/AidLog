-- 0004_org_schema.sql
-- Adds the org's CONFIGURABLE PROTOCOL SCHEMA (the in-app schema editor).
-- See packages/contracts/src/index.ts (OrgSchemaDocument, SetOrgSchemaRequest,
-- ROUTES.orgSchema) and apps/web/src/lib/schemas (DocSchema/DocSection/DocField).
--
-- WHAT THIS STORES — and why it is NOT patient data:
--   `org_schema.schema` holds the protocol FIELD DEFINITIONS (sections with a
--   badge/title, fields with key/label/type/options/unit/required/span). This is
--   ORGANISATION CONFIGURATION that drives how the documentation form renders —
--   it is the SHAPE of the form, never any value a helper enters. No ciphertext,
--   no DEK, no secret, and (by design) NO PATIENT DATA. It is therefore fine to
--   store in clear, unlike the append-only `records` table whose payloads stay
--   opaque. Patient values are encrypted client-side into `records.payload`.
--
-- Invariants preserved:
--   * The server stays BLIND to patient data: this table holds only form config.
--   * `records` stays append-only and is UNTOUCHED by this migration.

-- ---------------------------------------------------------------------------
-- org_schema: ONE row per org — the currently active protocol schema. Upserted
-- on every save with version bumped by the application. Field DEFINITIONS only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_schema (
  org_id              uuid PRIMARY KEY REFERENCES orgs(org_id) ON DELETE RESTRICT,
  -- Monotonic version; the app sets it to (previous version + 1) on each save.
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- keyId of the admin who last saved the schema.
  updated_by_key_id   text NOT NULL,
  -- DocSchema JSON (sections/fields). FORM CONFIG ONLY — never patient data.
  schema              jsonb NOT NULL
);

-- ---------------------------------------------------------------------------
-- Least-privilege grants for the application role.
-- org_schema is upserted on each save -> SELECT/INSERT/UPDATE. No DELETE
-- (an org always keeps its last active schema; resetting just upserts a new one).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    GRANT SELECT, INSERT, UPDATE ON org_schema TO aidlog_app;
  END IF;
END
$$;
