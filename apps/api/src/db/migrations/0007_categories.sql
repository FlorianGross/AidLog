-- 0007_categories.sql
-- Adds PROTOCOL CATEGORIES (Sanitätsdienst / HvO / EGB …).
-- See packages/contracts/src/index.ts (ProtocolCategory, UpsertCategoryRequest,
-- CategoryListResponse, CategoryCreatePermission, ROUTES.orgCategories) and
-- apps/api/src/routes/categories.ts.
--
-- WHAT THIS STORES — and why it is NOT patient data:
--   A category is ORGANISATION CONFIGURATION: a name + its OWN DocSchema (the
--   sections/fields that drive how a deployment's documentation form renders,
--   exactly like `org_schema.schema`) + a permission deciding WHO may create a
--   deployment under it. These are FIELD DEFINITIONS / labels / form config — the
--   SHAPE of the form, never any value a helper enters. No ciphertext, no DEK, no
--   secret, and (by design) NO PATIENT DATA. It is therefore fine to store in
--   clear, unlike the append-only `records` table whose payloads stay opaque.
--
-- Invariants preserved:
--   * The server stays BLIND to patient data: this table holds only form config.
--   * `records` stays append-only and is UNTOUCHED by this migration.
--   * Categories are NEVER hard-deleted (old deployments may reference one); the
--     application soft-deletes by setting active = false.

-- ---------------------------------------------------------------------------
-- categories: many rows per org. The admin defines each category, its schema,
-- and its create permission. Soft-deleted via `active`, never DELETEd.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  -- Display name, e.g. "Sanitätsdienst", "HvO", "EGB".
  name                text NOT NULL,
  description         text,
  -- Singular UI term for a deployment of this category ("Veranstaltung" | "Einsatz").
  deployment_label    text,
  -- Who may create a deployment under this category: 'all' | 'lead' | 'admin'.
  create_permission   text NOT NULL DEFAULT 'all'
                        CHECK (create_permission IN ('all','lead','admin')),
  -- The category's own DocSchema (sections/fields), FORM CONFIG ONLY — never
  -- patient data. NULL means the client falls back to its ABCDE default.
  schema              jsonb,
  sort_order          integer NOT NULL DEFAULT 0,
  color               text,
  icon                text,
  active              boolean NOT NULL DEFAULT true,
  -- Monotonic version; the app bumps it on each update / soft-delete.
  version             integer NOT NULL DEFAULT 1,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- keyId of the admin who last saved this category.
  updated_by_key_id   text NOT NULL
);
-- List a caller-org's categories ordered by sort_order.
CREATE INDEX IF NOT EXISTS categories_org_sort_idx ON categories(org_id, sort_order);

-- ---------------------------------------------------------------------------
-- Extend the audit_log action whitelist with 'category.updated' so creating or
-- updating a category can be recorded (WHO/WHAT/WHEN; never content). We replace
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
  'archive.anchored',
  'category.updated'
));

-- ---------------------------------------------------------------------------
-- Least-privilege grants for the application role.
-- categories is upserted and soft-deleted in place -> SELECT/INSERT/UPDATE.
-- No DELETE: a category is never hard-deleted (old deployments may reference it).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    GRANT SELECT, INSERT, UPDATE ON categories TO aidlog_app;
  END IF;
END
$$;
