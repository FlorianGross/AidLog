/**
 * Offline unit tests for GDPR RETENTION / ERASURE that do NOT need a database:
 *   - migration 0009 ships the expected tables, the append-only trigger on
 *     deletion_log (mirroring the records pattern), and the least-privilege
 *     grants (retention_policies SELECT/INSERT/UPDATE; deletion_log
 *     SELECT/INSERT only — never DELETE/UPDATE).
 *   - the setRetention / purge zod schemas guard SHAPE + bounds + the
 *     scope/deploymentId refinement.
 *
 * DB-backed happy paths (upsert policy, dry-run counts, crypto-shred of
 * sealed_keys + deletion_log append, cross-org rejection) would live in a
 * retention.integration.test.ts and run only when TEST_DATABASE_URL is set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setRetentionSchema, purgeSchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0009_retention.sql'),
  'utf8',
);

describe('migration 0009_retention.sql', () => {
  it('creates both tables', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS retention_policies/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS deletion_log/);
  });

  it('measures retention via a retention_days integer and references orgs', () => {
    expect(migration).toMatch(/retention_days\s+integer NOT NULL/);
    expect(migration).toMatch(/org_id\s+uuid PRIMARY KEY REFERENCES orgs\(org_id\)/);
  });

  it('makes deletion_log append-only with a reject-UPDATE/DELETE trigger', () => {
    expect(migration).toMatch(/FUNCTION deletion_log_reject_mutation\(\)/);
    expect(migration).toMatch(/RAISE EXCEPTION/);
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON deletion_log/);
  });

  it('grants least privilege: deletion_log INSERT/SELECT only (no UPDATE/DELETE)', () => {
    expect(migration).toMatch(/GRANT SELECT, INSERT ON deletion_log TO aidlog_app/);
    // deletion_log must never receive UPDATE or DELETE privilege.
    expect(migration).not.toMatch(/GRANT[^;]*\b(?:UPDATE|DELETE)\b[^;]*ON deletion_log/);
  });

  it('grants retention_policies SELECT/INSERT/UPDATE (mutable config, no DELETE)', () => {
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON retention_policies TO aidlog_app/);
    expect(migration).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*ON retention_policies/);
  });

  it('does NOT touch the append-only records table', () => {
    expect(migration).not.toMatch(/(?:UPDATE|DELETE|DROP)\s+(?:FROM\s+)?records\b/i);
  });
});

describe('setRetentionSchema', () => {
  it('accepts a positive integer day count', () => {
    expect(setRetentionSchema.safeParse({ retentionDays: 3653 }).success).toBe(true);
    expect(setRetentionSchema.safeParse({ retentionDays: 1 }).success).toBe(true);
  });

  it('rejects zero, negative, non-integer, or absurd values', () => {
    expect(setRetentionSchema.safeParse({ retentionDays: 0 }).success).toBe(false);
    expect(setRetentionSchema.safeParse({ retentionDays: -1 }).success).toBe(false);
    expect(setRetentionSchema.safeParse({ retentionDays: 1.5 }).success).toBe(false);
    expect(setRetentionSchema.safeParse({ retentionDays: 10_000_000 }).success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    expect(setRetentionSchema.safeParse({ retentionDays: 100, secret: 'x' }).success).toBe(false);
  });
});

describe('purgeSchema', () => {
  const dep = '11111111-1111-4111-8111-111111111111';

  it("accepts scope 'policy' without a deploymentId", () => {
    expect(purgeSchema.safeParse({ scope: 'policy', dryRun: true }).success).toBe(true);
  });

  it("requires a deploymentId for scope 'deployment'", () => {
    expect(purgeSchema.safeParse({ scope: 'deployment' }).success).toBe(false);
    expect(purgeSchema.safeParse({ scope: 'deployment', deploymentId: dep }).success).toBe(true);
  });

  it('rejects a non-uuid deploymentId', () => {
    expect(purgeSchema.safeParse({ scope: 'deployment', deploymentId: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown scope and extra fields (strict)', () => {
    expect(purgeSchema.safeParse({ scope: 'everything' }).success).toBe(false);
    expect(purgeSchema.safeParse({ scope: 'policy', wipeKeys: true }).success).toBe(false);
  });

  it('treats dryRun as optional (omitted is valid)', () => {
    expect(purgeSchema.safeParse({ scope: 'policy' }).success).toBe(true);
  });
});
