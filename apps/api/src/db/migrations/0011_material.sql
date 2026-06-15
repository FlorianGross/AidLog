-- 0011_material.sql
-- Material-/Verbrauchsmaterial-Verwaltung (inventory) module: a plain
-- consumables/equipment catalog plus a PER-DEPLOYMENT-AGGREGATE consumption log.
--
-- See packages/contracts/src/index.ts (MaterialItem, UpsertMaterialItemRequest,
-- MaterialListResponse, ConsumptionEntry, ConsumptionListResponse,
-- LogConsumptionRequest, MATERIAL_UNITS, ROUTES.orgMaterial / orgMaterialItem /
-- deploymentConsumption) and apps/api/src/routes/material.ts.
--
-- PRIVACY: both tables carry ONLY OPERATIONAL, NON-health LOGISTICS metadata —
-- stock levels, units, expiry, low-stock thresholds, and AGGREGATE consumption
-- per deployment ("3× Mullbinde used in event X"). This is NOT GDPR Art. 9 data
-- and is stored in clear. NEVER add a patient/health column here, and NEVER link
-- consumption to an individual patient or `records` row. Patient-specific
-- medication stays inside the encrypted protocol payload (`medikamente` group),
-- not here. This is a NORMAL inventory — NOT a Betäubungsmittel (BtM) /
-- controlled-substance ledger.
--
-- Invariants preserved:
--   * The server stays BLIND to patient data: these tables hold only logistics.
--   * `records` stays append-only and is UNTOUCHED by this migration.
--   * Both tables are MUTABLE operational state (normal grants; no append-only
--     trigger) so stock can be corrected and catalog items edited.

-- ---------------------------------------------------------------------------
-- material_items: the catalog. Many rows per org. Soft-deletable via `active`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  -- Display name, e.g. "Mullbinde 8cm".
  name                text NOT NULL,
  -- Free/coded grouping (Verbandmaterial / Verbrauch / Gerät / Sonstiges). NULL = ungrouped.
  category            text,
  -- Unit of measure (Stk / Pkg / Paar / ml / l / Set). Free string; UI offers presets.
  unit                text NOT NULL DEFAULT 'Stk',
  -- Current on-hand quantity. Clamped >= 0 by the application on consumption.
  stock_quantity      integer NOT NULL DEFAULT 0,
  -- Optional low-stock threshold; stock <= this raises a warning. NULL = none.
  min_quantity        integer,
  -- Optional expiry as a calendar date (no time). NULL = no expiry tracked.
  expires_at          date,
  -- Optional free-text storage location ("Rucksack 2", "Lager Regal B").
  location            text,
  active              boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- keyId of the admin/lead who last saved this item.
  updated_by_key_id   text NOT NULL
);
-- List a caller-org's catalog (active filter + name order live in the query).
CREATE INDEX IF NOT EXISTS material_items_org_idx ON material_items(org_id, active);

-- ---------------------------------------------------------------------------
-- material_consumption: PER-DEPLOYMENT-AGGREGATE consumption log. Mutable so an
-- admin/lead may delete/correct an entry (restoring stock). FK to the item uses
-- ON DELETE RESTRICT so a referenced item cannot be hard-deleted out from under
-- its history (the app soft-deletes items via `active` instead). `item_name` is
-- a snapshot so the log stays readable. NO patient/record linkage column exists.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_consumption (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  deployment_id       uuid NOT NULL,
  item_id             uuid NOT NULL REFERENCES material_items(id) ON DELETE RESTRICT,
  -- Snapshot of the item name at log time (readable even if the item is renamed).
  item_name           text NOT NULL,
  -- Aggregate quantity consumed in this deployment. Application validates > 0.
  quantity            integer NOT NULL,
  note                text,
  recorded_by_key_id  text NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);
-- List a deployment's consumption (org-scoped), newest first.
CREATE INDEX IF NOT EXISTS material_consumption_deployment_idx
  ON material_consumption(org_id, deployment_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Least-privilege grants. Both tables are MUTABLE operational config:
-- SELECT/INSERT/UPDATE/DELETE for the application role. No append-only trigger.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON material_items TO aidlog_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON material_consumption TO aidlog_app;
  END IF;
END
$$;
