/**
 * Offline unit tests for the org's CONFIGURABLE PROTOCOL SCHEMA (in-app schema
 * editor) that do NOT need a database:
 *   - migration 0004 ships the expected table/grants and stores form config only.
 *   - the SetOrgSchemaRequest zod schema guards SHAPE (non-empty sections +
 *     schemaId string) while staying tolerant of new field props.
 *
 * DB-backed happy paths (GET null default, PUT upsert + version bump, admin-only
 * write) belong in an integration test that runs when TEST_DATABASE_URL is set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setOrgSchemaSchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0004_org_schema.sql'),
  'utf8',
);

describe('0004 migration SQL', () => {
  it('creates the org_schema table', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS org_schema/i);
  });

  it('stores form config only: version/updated_by/schema, one row per org', () => {
    expect(migration).toMatch(/org_id\s+uuid PRIMARY KEY REFERENCES orgs\(org_id\)/i);
    expect(migration).toMatch(/version\s+integer NOT NULL/i);
    expect(migration).toMatch(/updated_by_key_id\s+text NOT NULL/i);
    expect(migration).toMatch(/schema\s+jsonb NOT NULL/i);
    // No ciphertext/secret/DEK COLUMNS — this is form config, not patient data.
    // (the word may appear in prose comments; assert no column declaration).
    expect(migration).not.toMatch(/\bciphertext\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bwrapped_secret\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bsealed_key\w*\s+(text|bytea|jsonb)/i);
  });

  it('grants the app role SELECT/INSERT/UPDATE (no DELETE) and leaves records alone', () => {
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON org_schema TO aidlog_app/i);
    expect(migration).not.toMatch(/DELETE.*ON org_schema/i);
    expect(migration).not.toMatch(
      /\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\s+(TABLE\s+)?records\b/i,
    );
  });
});

describe('SetOrgSchemaRequest validation', () => {
  const valid = {
    schema: {
      schemaId: 'abcde-rd',
      version: 1,
      title: 'Patientenprotokoll',
      sections: [{ key: 'a', title: 'A', fields: [{ key: 'x', label: 'X', type: 'text' }] }],
    },
  };

  it('accepts a well-formed schema (non-empty sections + schemaId)', () => {
    expect(setOrgSchemaSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty sections array', () => {
    const r = setOrgSchemaSchema.safeParse({ schema: { schemaId: 'x', sections: [] } });
    expect(r.success).toBe(false);
  });

  it('rejects a missing/blank schemaId', () => {
    expect(setOrgSchemaSchema.safeParse({ schema: { sections: [{}] } }).success).toBe(false);
    expect(setOrgSchemaSchema.safeParse({ schema: { schemaId: '', sections: [{}] } }).success).toBe(
      false,
    );
  });

  it('rejects a non-object schema', () => {
    expect(setOrgSchemaSchema.safeParse({ schema: 'nope' }).success).toBe(false);
    expect(setOrgSchemaSchema.safeParse({ schema: null }).success).toBe(false);
  });

  it('stays tolerant of new/unknown field props (passthrough)', () => {
    const withExtras = {
      schema: {
        schemaId: 'abcde-rd',
        sections: [
          {
            key: 'a',
            title: 'A',
            badge: 'A',
            fields: [{ key: 'x', label: 'X', type: 'text', span: 2, futureProp: true }],
          },
        ],
        somethingNew: { nested: 1 },
      },
    };
    expect(setOrgSchemaSchema.safeParse(withExtras).success).toBe(true);
  });

  it('STRICTLY rejects extra top-level fields beyond `schema`', () => {
    const r = setOrgSchemaSchema.safeParse({ ...valid, version: 9, hacker: true });
    expect(r.success).toBe(false);
  });
});
