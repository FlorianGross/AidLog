/**
 * Offline unit tests for the org-key RECOVERY metadata + AUDIT log that do NOT
 * need a database:
 *   - migration 0003 ships the expected tables/grants and stores NO secret/share.
 *   - the SetRecoveryConfigRequest zod schema enforces the policy invariants and
 *     rejects any attempt to smuggle a share/secret into the request body.
 *
 * DB-backed happy paths (HTTP get/set recovery, audit listing, offboarding audit
 * entries) live in recovery-audit.integration.test.ts and run when
 * TEST_DATABASE_URL is set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setRecoveryConfigSchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0003_recovery_audit.sql'),
  'utf8',
);

describe('0003 migration SQL', () => {
  it('creates recovery_config and audit_log tables', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS recovery_config/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS audit_log/i);
  });

  it('recovery_config holds METADATA ONLY — no share/secret/password columns', () => {
    // Positively: threshold/share_count/trustees/org_key_check are present.
    expect(migration).toMatch(/threshold\s+integer NOT NULL/i);
    expect(migration).toMatch(/share_count\s+integer NOT NULL/i);
    expect(migration).toMatch(/trustees\s+jsonb NOT NULL/i);
    expect(migration).toMatch(/org_key_check\s+text/i);
    // Negatively: no column that could hold a share or secret material.
    expect(migration).not.toMatch(/\bshare\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bsecret(_key)?\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bpassword\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bwrapped_secret\b/i);
  });

  it('constrains threshold/share_count to the Shamir 2..255 range', () => {
    expect(migration).toMatch(/threshold >= 2 AND threshold <= 255/i);
    expect(migration).toMatch(/share_count >= threshold AND share_count <= 255/i);
  });

  it('audit_log records WHO/WHAT/WHEN and is INSERT/SELECT only for the app role', () => {
    expect(migration).toMatch(/actor_key_id\s+text NOT NULL/i);
    expect(migration).toMatch(/action\s+text NOT NULL CHECK/i);
    expect(migration).toMatch(/target_key_id\s+text/i);
    // Immutable: app role granted INSERT/SELECT only (no UPDATE/DELETE).
    expect(migration).toMatch(/GRANT SELECT, INSERT ON audit_log TO aidlog_app/i);
    expect(migration).not.toMatch(/UPDATE.*ON audit_log/i);
    expect(migration).not.toMatch(/DELETE.*ON audit_log/i);
  });

  it('does NOT issue any DDL/DML against the append-only records table', () => {
    // Prose mentions of "records" in comments are fine; assert no statement
    // targets the records table.
    expect(migration).not.toMatch(
      /\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\s+(TABLE\s+)?records\b/i,
    );
    expect(migration).not.toMatch(/\bGRANT[\s\S]*\bON\b[\s\S]*\brecords\b/i);
  });
});

describe('SetRecoveryConfigRequest validation', () => {
  const valid = {
    threshold: 3,
    shareCount: 5,
    trustees: [
      { label: 'Leitung' },
      { label: 'Stellv.' },
      { label: 'Kasse' },
      { label: 'IT' },
      { label: 'Archiv' },
    ],
  };

  it('accepts a well-formed policy (trustees length == shareCount)', () => {
    const r = setRecoveryConfigSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('rejects threshold > shareCount', () => {
    const r = setRecoveryConfigSchema.safeParse({ ...valid, threshold: 6 });
    expect(r.success).toBe(false);
  });

  it('rejects threshold < 2 and shareCount > 255', () => {
    expect(setRecoveryConfigSchema.safeParse({ ...valid, threshold: 1 }).success).toBe(false);
    expect(
      setRecoveryConfigSchema.safeParse({
        threshold: 2,
        shareCount: 256,
        trustees: valid.trustees,
      }).success,
    ).toBe(false);
  });

  it('rejects a trustee count that does not equal shareCount', () => {
    const r = setRecoveryConfigSchema.safeParse({ ...valid, trustees: valid.trustees.slice(0, 4) });
    expect(r.success).toBe(false);
  });

  it('STRICTLY rejects any extra field (no share/secret can be smuggled in)', () => {
    const withShare = { ...valid, share: 'AAAA', secret: 'BBBB' };
    const r = setRecoveryConfigSchema.safeParse(withShare);
    expect(r.success).toBe(false);
  });

  it('rejects a trustee object carrying anything beyond a label', () => {
    const r = setRecoveryConfigSchema.safeParse({
      ...valid,
      trustees: [{ label: 'X', share: 'AAAA' }, ...valid.trustees.slice(1)],
    });
    expect(r.success).toBe(false);
  });
});
