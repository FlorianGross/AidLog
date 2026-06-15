/**
 * Offline unit tests for PROTOCOL CATEGORIES that do NOT need a database:
 *   - migration 0007 ships the expected table/index/grants and stores form
 *     config only (no patient-data columns), and extends the audit CHECK.
 *   - the UpsertCategoryRequest zod schema guards SHAPE (non-empty name,
 *     createPermission enum) while staying tolerant of opaque `schema` props.
 *
 * DB-backed happy paths (lazy seed, upsert + version bump, soft-delete, the
 * last-active guard, role guard) live in categories.integration.test.ts and run
 * only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { upsertCategorySchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0007_categories.sql'),
  'utf8',
);

describe('0007 migration SQL', () => {
  it('creates the categories table', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS categories/i);
  });

  it('declares the documented columns, including the create_permission CHECK', () => {
    expect(migration).toMatch(/id\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/i);
    expect(migration).toMatch(/org_id\s+uuid NOT NULL REFERENCES orgs\(org_id\)/i);
    expect(migration).toMatch(/name\s+text NOT NULL/i);
    expect(migration).toMatch(
      /create_permission\s+text NOT NULL DEFAULT 'all'[\s\S]*?CHECK \(create_permission IN \('all','lead','admin'\)\)/i,
    );
    expect(migration).toMatch(/active\s+boolean NOT NULL DEFAULT true/i);
    expect(migration).toMatch(/version\s+integer NOT NULL DEFAULT 1/i);
    expect(migration).toMatch(/updated_by_key_id\s+text NOT NULL/i);
    expect(migration).toMatch(/schema\s+jsonb/i);
  });

  it('indexes (org_id, sort_order)', () => {
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS categories_org_sort_idx\s+ON categories\(org_id, sort_order\)/i,
    );
  });

  it('extends the audit_log CHECK with category.updated', () => {
    expect(migration).toMatch(/'category\.updated'/);
  });

  it('grants the app role SELECT/INSERT/UPDATE (no DELETE) and leaves records alone', () => {
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON categories TO aidlog_app/i);
    expect(migration).not.toMatch(/DELETE.*ON categories/i);
    expect(migration).not.toMatch(
      /\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\s+(TABLE\s+)?records\b/i,
    );
  });

  it('stores no patient-data / secret columns (config only)', () => {
    expect(migration).not.toMatch(/\bciphertext\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bwrapped_secret\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bsealed_key\w*\s+(text|bytea|jsonb)/i);
  });
});

describe('UpsertCategoryRequest validation', () => {
  const valid = {
    name: 'Sanitätsdienst',
    createPermission: 'all' as const,
  };

  it('accepts a minimal create (name + createPermission)', () => {
    expect(upsertCategorySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an update (id present) with an opaque schema', () => {
    const r = upsertCategorySchema.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'HvO',
      createPermission: 'lead',
      deploymentLabel: 'Einsatz',
      schema: { schemaId: 'x', sections: [{ key: 'a' }], somethingNew: 1 },
      sortOrder: 3,
      active: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a blank name', () => {
    expect(upsertCategorySchema.safeParse({ ...valid, name: '' }).success).toBe(false);
  });

  it('rejects an invalid createPermission', () => {
    expect(
      upsertCategorySchema.safeParse({ name: 'X', createPermission: 'everyone' }).success,
    ).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(upsertCategorySchema.safeParse({ ...valid, id: 'nope' }).success).toBe(false);
  });

  it('STRICTLY rejects unknown top-level fields', () => {
    expect(upsertCategorySchema.safeParse({ ...valid, hacker: true }).success).toBe(false);
  });

  it('keeps `schema` opaque (passthrough) but typed as an object', () => {
    expect(
      upsertCategorySchema.safeParse({ ...valid, schema: { anything: { nested: [1, 2] } } })
        .success,
    ).toBe(true);
    expect(upsertCategorySchema.safeParse({ ...valid, schema: 'nope' }).success).toBe(false);
  });
});
