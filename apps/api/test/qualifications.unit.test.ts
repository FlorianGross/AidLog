/**
 * Offline unit tests for the Personal & Qualifikationen module that do NOT need
 * a database:
 *   - the ordered Qualification model in @aidlog/contracts (ranks ascending,
 *     unset ranks below every named level, label lookup).
 *   - migration 0010 ships the helpers.qualification column, the mutable
 *     deployment_roster table + its grants, and never touches patient/health
 *     data or the append-only records table.
 *   - the setQualification / rosterUpsert zod schemas guard SHAPE.
 *
 * DB-backed happy paths (admin sets a qualification, self check-in/out, cross-org
 * rejection) would live in a qualifications.integration.test.ts gated on
 * TEST_DATABASE_URL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  QUALIFICATIONS,
  qualificationRank,
  qualificationLabel,
  isQualification,
} from '@aidlog/contracts';
import { setQualificationSchema, rosterUpsertSchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0010_qualifications.sql'),
  'utf8',
);

describe('Qualification model (contracts)', () => {
  it('is ordered lowest → highest with ascending ranks', () => {
    const ranks = QUALIFICATIONS.map((q) => q.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // strictly increasing (no ties)
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
  });

  it('pins the canonical Sanitätsdienst ladder', () => {
    expect(QUALIFICATIONS.map((q) => q.value)).toEqual(['sanh', 'san', 'rs', 'notsan', 'arzt']);
  });

  it('ranks an unset (null/undefined) qualification below every named level', () => {
    expect(qualificationRank(null)).toBe(0);
    expect(qualificationRank(undefined)).toBe(0);
    expect(qualificationRank('sanh')).toBeGreaterThan(qualificationRank(null));
    expect(qualificationRank('arzt')).toBeGreaterThan(qualificationRank('sanh'));
  });

  it('orders sanh < san < rs < notsan < arzt by rank', () => {
    expect(qualificationRank('sanh')).toBeLessThan(qualificationRank('san'));
    expect(qualificationRank('san')).toBeLessThan(qualificationRank('rs'));
    expect(qualificationRank('rs')).toBeLessThan(qualificationRank('notsan'));
    expect(qualificationRank('notsan')).toBeLessThan(qualificationRank('arzt'));
  });

  it('labels values (German) and falls back to a dash for unset/unknown', () => {
    expect(qualificationLabel('notsan')).toBe('Notfallsanitäter');
    expect(qualificationLabel(null)).toBe('—');
  });

  it('validates membership via isQualification', () => {
    expect(isQualification('rs')).toBe(true);
    expect(isQualification('paramedic')).toBe(false);
    expect(isQualification(null)).toBe(false);
  });
});

describe('migration 0010_qualifications.sql', () => {
  it('adds the nullable qualification column to helpers', () => {
    expect(migration).toMatch(/ALTER TABLE helpers ADD COLUMN IF NOT EXISTS qualification text/);
  });

  it('creates the mutable deployment_roster table with the composite PK', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS deployment_roster/);
    expect(migration).toMatch(/PRIMARY KEY \(deployment_id, helper_key_id\)/);
    expect(migration).toMatch(/org_id\s+uuid NOT NULL REFERENCES orgs\(org_id\)/);
  });

  it('grants deployment_roster full mutable privileges (it is editable, not append-only)', () => {
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON deployment_roster TO aidlog_app/,
    );
    // No append-only reject trigger on the roster (unlike records/deletion_log).
    expect(migration).not.toMatch(/deployment_roster_reject_mutation/);
  });

  it('never declares a patient/health column and never touches append-only records', () => {
    // Inspect only column DEFINITION lines (the privacy comment legitimately
    // mentions "patient/health"); no column may be named with a health term.
    const columnLines = migration
      .split(/\r?\n/)
      .filter((l) => /^\s+(?!--)\w+\s+(?:text|uuid|timestamptz|integer|boolean)\b/.test(l));
    for (const line of columnLines) {
      expect(line).not.toMatch(/\b(patient|diagnos|vital|symptom|anamnes|medic)\w*/i);
    }
    expect(migration).not.toMatch(/(?:UPDATE|DELETE|DROP)\s+(?:FROM\s+)?records\b/i);
  });
});

describe('setQualificationSchema', () => {
  it('accepts a known qualification value', () => {
    expect(setQualificationSchema.safeParse({ qualification: 'rs' }).success).toBe(true);
  });

  it('accepts null to clear the qualification', () => {
    expect(setQualificationSchema.safeParse({ qualification: null }).success).toBe(true);
  });

  it('rejects an unknown value, extra fields, or a missing key', () => {
    expect(setQualificationSchema.safeParse({ qualification: 'paramedic' }).success).toBe(false);
    expect(setQualificationSchema.safeParse({ qualification: 'rs', extra: 1 }).success).toBe(false);
    expect(setQualificationSchema.safeParse({}).success).toBe(false);
  });
});

describe('rosterUpsertSchema', () => {
  it('accepts a self check-in (no helperKeyId)', () => {
    expect(rosterUpsertSchema.safeParse({ action: 'in' }).success).toBe(true);
  });

  it('accepts targeting another helper with a role-at-event', () => {
    expect(
      rosterUpsertSchema.safeParse({ helperKeyId: 'abc', roleAtEvent: 'Zugführer', action: 'out' })
        .success,
    ).toBe(true);
  });

  it('accepts clearing roleAtEvent with null and an empty body', () => {
    expect(rosterUpsertSchema.safeParse({ roleAtEvent: null }).success).toBe(true);
    expect(rosterUpsertSchema.safeParse({}).success).toBe(true);
  });

  it('rejects an unknown action and extra fields (strict)', () => {
    expect(rosterUpsertSchema.safeParse({ action: 'pause' }).success).toBe(false);
    expect(rosterUpsertSchema.safeParse({ smuggle: 'x' }).success).toBe(false);
  });
});
