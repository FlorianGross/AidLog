/**
 * Offline unit tests for CIRS — the ANONYMOUS critical-incident reporting module
 * that do NOT need a database:
 *   - migration 0012 ships both tables, the append-only trigger + grants for
 *     cirs_reports, mutable grants for cirs_status, and — CRITICALLY — declares
 *     NO submitter/author/session/IP column on cirs_reports (anonymity), and
 *     coarsens created_at to DATE precision.
 *   - the submission zod schema guards SHAPE and, with `.strict()`, REJECTS any
 *     author/submitter/keyId/signature field so reporter attribution can NEVER be
 *     smuggled in.
 *
 * DB-backed happy paths (insert + status seed, org-scoping, role guards, the
 * append-only trigger firing) would live in a cirs.integration.test.ts gated on
 * TEST_DATABASE_URL, mirroring categories.integration.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cirsSubmissionSchema, setCirsStatusSchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0012_cirs.sql'),
  'utf8',
);

// The migration's PROSE comments mention "submitter"/"IP" to document the rule.
// For "no such COLUMN" assertions we scan only the executable SQL (comments out).
const migrationSql = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('0012 migration SQL', () => {
  it('creates both tables', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS cirs_reports/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS cirs_status/i);
  });

  it('cirs_reports holds only ciphertext + the org-sealed DEK', () => {
    expect(migration).toMatch(/alg\s+jsonb NOT NULL/i);
    expect(migration).toMatch(/nonce\s+text NOT NULL/i);
    expect(migration).toMatch(/ciphertext\s+text NOT NULL/i);
    expect(migration).toMatch(/sealed_key\s+text NOT NULL/i);
  });

  it('coarsens created_at to DATE precision (no time component)', () => {
    expect(migrationSql).toMatch(/created_at\s+date NOT NULL DEFAULT CURRENT_DATE/i);
    // It must NOT be a fine-grained timestamp on cirs_reports.
    const reportsBlock = migrationSql.slice(
      migrationSql.indexOf('cirs_reports'),
      migrationSql.indexOf('cirs_status'),
    );
    expect(reportsBlock).not.toMatch(/created_at\s+timestamptz/i);
  });

  it('has NO submitter / author / session / IP column on cirs_reports (anonymity)', () => {
    const reportsBlock = migrationSql.slice(
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS cirs_reports'),
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS cirs_status'),
    );
    expect(reportsBlock).not.toMatch(/submitter/i);
    expect(reportsBlock).not.toMatch(/author/i);
    expect(reportsBlock).not.toMatch(/session/i);
    expect(reportsBlock).not.toMatch(/\bip\b|ip_address/i);
    expect(reportsBlock).not.toMatch(/reporter/i);
    expect(reportsBlock).not.toMatch(/key_id/i);
    expect(reportsBlock).not.toMatch(/signature/i);
  });

  it('enforces append-only on cirs_reports (trigger + SELECT/INSERT-only grant)', () => {
    expect(migration).toMatch(/cirs_reports_reject_mutation/i);
    expect(migration).toMatch(
      /CREATE TRIGGER cirs_reports_no_update_delete\s+BEFORE UPDATE OR DELETE ON cirs_reports/i,
    );
    expect(migrationSql).toMatch(/GRANT SELECT, INSERT ON cirs_reports TO aidlog_app/i);
    // No UPDATE/DELETE grant on the content table (single GRANT line, no cross-line match).
    expect(migrationSql).not.toMatch(/GRANT[^;\n]*UPDATE[^;\n]*ON cirs_reports/i);
    expect(migrationSql).not.toMatch(/GRANT[^;\n]*DELETE[^;\n]*ON cirs_reports/i);
  });

  it('grants the mutable workflow table SELECT/INSERT/UPDATE (no DELETE)', () => {
    expect(migrationSql).toMatch(/GRANT SELECT, INSERT, UPDATE ON cirs_status TO aidlog_app/i);
    expect(migrationSql).not.toMatch(/GRANT[^;\n]*DELETE[^;\n]*ON cirs_status/i);
  });

  it('records only the REVIEWER on cirs_status (reviewer is non-anonymous; reporter is not stored)', () => {
    expect(migration).toMatch(/reviewer_key_id\s+text/i);
    expect(migration).toMatch(
      /status\s+text NOT NULL DEFAULT 'neu'[\s\S]*CHECK \(status IN \('neu', 'in_bearbeitung', 'abgeschlossen'\)\)/i,
    );
  });

  it('leaves the records table untouched (no DDL/DML or grant against bare `records`)', () => {
    // Scan executable SQL only (prose comments mention `records` to document the
    // mirrored append-only design). `cirs_reports` does not match \brecords\b.
    expect(migrationSql).not.toMatch(/\b(ALTER|DROP)\s+TABLE\s+records\b/i);
    expect(migrationSql).not.toMatch(/\bON\s+records\b/i);
    expect(migrationSql).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+records\b/i);
  });
});

describe('CIRS submission validation enforces anonymity at the wire layer', () => {
  const valid = {
    alg: 'xchacha20poly1305-ietf' as const,
    nonce: 'AAAA',
    ciphertext: 'BBBB',
    sealedKey: 'CCCC',
  };

  it('accepts exactly { alg, nonce, ciphertext, sealedKey }', () => {
    const parsed = cirsSubmissionSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data).sort()).toEqual(['alg', 'ciphertext', 'nonce', 'sealedKey']);
    }
  });

  it.each(['authorKeyId', 'submitterKeyId', 'keyId', 'signature', 'reporterId', 'sessionId', 'ip'])(
    'REJECTS a smuggled attribution field: %s',
    (field) => {
      const parsed = cirsSubmissionSchema.safeParse({ ...valid, [field]: 'x' });
      expect(parsed.success).toBe(false);
    },
  );

  it('rejects a non-base64 / wrong-alg submission', () => {
    expect(cirsSubmissionSchema.safeParse({ ...valid, nonce: '!!!' }).success).toBe(false);
    expect(cirsSubmissionSchema.safeParse({ ...valid, alg: 'aes-gcm' }).success).toBe(false);
  });
});

describe('CIRS status validation', () => {
  it('accepts the three workflow statuses only', () => {
    for (const status of ['neu', 'in_bearbeitung', 'abgeschlossen']) {
      expect(setCirsStatusSchema.safeParse({ status }).success).toBe(true);
    }
    expect(setCirsStatusSchema.safeParse({ status: 'erledigt' }).success).toBe(false);
    expect(setCirsStatusSchema.safeParse({ status: 'neu', reviewerKeyId: 'x' }).success).toBe(
      false,
    );
  });
});
