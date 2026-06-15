/**
 * Offline unit tests for the Material-/Verbrauchsmaterial-Verwaltung (inventory)
 * module that do NOT need a database:
 *   - migration 0011 ships the expected tables/indexes/grants, stores LOGISTICS
 *     only (no patient-data / record-link columns), and leaves `records` alone.
 *   - the upsert/log zod schemas guard SHAPE (positive quantities, ISO expiry,
 *     strict no-extra-fields so a patient/record link can't be smuggled in).
 *
 * DB-backed happy paths (create/update/soft-delete, stock decrement clamp,
 * org-scoping, role guards) would live in a material.integration.test.ts gated on
 * TEST_DATABASE_URL, mirroring categories.integration.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { upsertMaterialItemSchema, logConsumptionSchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0011_material.sql'),
  'utf8',
);

// The migration's PROSE comments intentionally mention "patient"/"record" to
// document the privacy rule. For the "no patient/record-link COLUMN" assertions
// we scan only the executable SQL (comment lines stripped), not the commentary.
const migrationSql = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('0011 migration SQL', () => {
  it('creates both tables', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS material_items/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS material_consumption/i);
  });

  it('declares the documented material_items columns', () => {
    expect(migration).toMatch(/id\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/i);
    expect(migration).toMatch(/org_id\s+uuid NOT NULL REFERENCES orgs\(org_id\)/i);
    expect(migration).toMatch(/name\s+text NOT NULL/i);
    expect(migration).toMatch(/unit\s+text NOT NULL/i);
    expect(migration).toMatch(/stock_quantity\s+integer NOT NULL DEFAULT 0/i);
    expect(migration).toMatch(/min_quantity\s+integer/i);
    expect(migration).toMatch(/expires_at\s+date/i);
    expect(migration).toMatch(/active\s+boolean NOT NULL DEFAULT true/i);
    expect(migration).toMatch(/updated_by_key_id\s+text NOT NULL/i);
  });

  it('consumption FK to material_items uses ON DELETE RESTRICT', () => {
    expect(migration).toMatch(
      /item_id\s+uuid NOT NULL REFERENCES material_items\(id\) ON DELETE RESTRICT/i,
    );
  });

  it('indexes both tables', () => {
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS material_items_org_idx/i);
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS material_consumption_deployment_idx/i);
  });

  it('grants the app role full CRUD on both (mutable, no append-only trigger)', () => {
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON material_items TO aidlog_app/i,
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON material_consumption TO aidlog_app/i,
    );
  });

  it('leaves the append-only records table untouched', () => {
    expect(migration).not.toMatch(
      /\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\s+(TABLE\s+)?records\b/i,
    );
  });

  it('stores NO patient-data / secret / record-link columns (logistics only)', () => {
    // Scan executable SQL only — the prose comments document the privacy rule.
    expect(migrationSql).not.toMatch(/\bciphertext\b/i);
    expect(migrationSql).not.toMatch(/\bwrapped_secret\b/i);
    expect(migrationSql).not.toMatch(/\bsealed_key\w*\b/i);
    // No FK/column tying consumption to a patient or a protocol record.
    expect(migrationSql).not.toMatch(/\bpatient\w*\b/i);
    expect(migrationSql).not.toMatch(/\brecord_id\b/i);
    expect(migrationSql).not.toMatch(/REFERENCES records\b/i);
  });
});

describe('UpsertMaterialItemRequest validation', () => {
  const valid = { name: 'Mullbinde', unit: 'Stk', stockQuantity: 10 };

  it('accepts a minimal create', () => {
    expect(upsertMaterialItemSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts the full optional field set', () => {
    expect(
      upsertMaterialItemSchema.safeParse({
        ...valid,
        category: 'Verbandmaterial',
        minQuantity: 5,
        expiresAt: '2026-12-31',
        location: 'Rucksack 2',
        active: true,
      }).success,
    ).toBe(true);
  });

  it('allows nullable optionals to be null', () => {
    expect(
      upsertMaterialItemSchema.safeParse({
        ...valid,
        category: null,
        minQuantity: null,
        expiresAt: null,
        location: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a blank name and a blank unit', () => {
    expect(upsertMaterialItemSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(upsertMaterialItemSchema.safeParse({ ...valid, unit: '' }).success).toBe(false);
  });

  it('rejects negative or non-integer stock', () => {
    expect(upsertMaterialItemSchema.safeParse({ ...valid, stockQuantity: -1 }).success).toBe(false);
    expect(upsertMaterialItemSchema.safeParse({ ...valid, stockQuantity: 1.5 }).success).toBe(
      false,
    );
  });

  it('rejects a malformed expiry date', () => {
    expect(upsertMaterialItemSchema.safeParse({ ...valid, expiresAt: '31.12.2026' }).success).toBe(
      false,
    );
    expect(upsertMaterialItemSchema.safeParse({ ...valid, expiresAt: '2026-13-40' }).success).toBe(
      true, // regex-only shape check; calendar validity is enforced by the date column
    );
  });

  it('STRICTLY rejects unknown fields (so no patient/record link can be smuggled in)', () => {
    expect(upsertMaterialItemSchema.safeParse({ ...valid, patientId: 'x' }).success).toBe(false);
    expect(upsertMaterialItemSchema.safeParse({ ...valid, recordId: 'x' }).success).toBe(false);
  });
});

describe('LogConsumptionRequest validation', () => {
  const item = '11111111-1111-1111-1111-111111111111';

  it('accepts a positive integer quantity', () => {
    expect(logConsumptionSchema.safeParse({ itemId: item, quantity: 3 }).success).toBe(true);
    expect(
      logConsumptionSchema.safeParse({ itemId: item, quantity: 1, note: 'Wundversorgung' }).success,
    ).toBe(true);
  });

  it('rejects zero / negative / non-integer quantities', () => {
    expect(logConsumptionSchema.safeParse({ itemId: item, quantity: 0 }).success).toBe(false);
    expect(logConsumptionSchema.safeParse({ itemId: item, quantity: -2 }).success).toBe(false);
    expect(logConsumptionSchema.safeParse({ itemId: item, quantity: 2.5 }).success).toBe(false);
  });

  it('rejects a non-uuid itemId', () => {
    expect(logConsumptionSchema.safeParse({ itemId: 'nope', quantity: 1 }).success).toBe(false);
  });

  it('STRICTLY rejects a patient/record link field', () => {
    expect(
      logConsumptionSchema.safeParse({ itemId: item, quantity: 1, patientId: 'x' }).success,
    ).toBe(false);
    expect(
      logConsumptionSchema.safeParse({ itemId: item, quantity: 1, recordId: 'x' }).success,
    ).toBe(false);
  });
});
