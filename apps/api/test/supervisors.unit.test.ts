/**
 * Offline unit tests for SUPERVISOR read access (no database):
 *   - migration 0008 relaxes the sealed_keys recipient_type CHECK to admit
 *     'supervisor' (the full 4-member set), and does NOT touch records grants.
 *   - the shared `sealedKey` zod schema (used by appendRecordSchema and the
 *     cosign-style sealed-key POSTs) accepts a 'supervisor' wrapper.
 *
 * The DB-backed behaviours (the /api/org/supervisors endpoint returning only
 * active admins+leads with PUBLIC identities; scope=org now including the
 * caller's own supervisor wrapper while excluding others'; the CHECK accepting
 * 'supervisor') live in supervisors.integration.test.ts and run when
 * TEST_DATABASE_URL is set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appendRecordSchema, addSealedKeysSchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0008_supervisor_recipient.sql'),
  'utf8',
);

describe('0008 migration SQL', () => {
  it("relaxes the sealed_keys recipient_type CHECK to the 4-member set incl. 'supervisor'", () => {
    expect(migration).toMatch(/recipient_type IN \('org', 'helper', 'cosigner', 'supervisor'\)/i);
  });

  it('drops the old constraint IF EXISTS before re-adding it (idempotent re-add)', () => {
    expect(migration).toMatch(
      /ALTER TABLE sealed_keys DROP CONSTRAINT IF EXISTS sealed_keys_recipient_type_check/i,
    );
  });

  it('does not touch the records grants (append-only intact) and adds no table', () => {
    expect(migration).not.toMatch(/ON\s+records\s+TO\s+aidlog_app/i);
    expect(migration).not.toMatch(/CREATE TABLE/i);
  });
});

describe('sealedKey validation admits a supervisor wrapper', () => {
  const supervisorKey = {
    recipientType: 'supervisor' as const,
    recipientKeyId: 'super-key-id',
    alg: 'x25519-sealedbox' as const,
    ciphertext: 'AAAA',
  };

  function record(sealedKeys: unknown[]) {
    return {
      record: {
        envelopeVersion: 1,
        id: '11111111-1111-1111-1111-111111111111',
        deploymentId: '22222222-2222-2222-2222-222222222222',
        seq: 0,
        createdAt: '2026-06-12T10:00:00.000Z',
        authorKeyId: 'author-key-id',
        payload: {
          alg: 'xchacha20poly1305-ietf',
          nonce: 'AAAA',
          ciphertext: 'AAAA',
          schemaId: 'default',
          schemaVersion: 1,
        },
        blobs: [],
        sealedKeys,
        prevHash: null,
        recordHash: 'AAAA',
        signature: 'AAAA',
        alg: { aead: 'xchacha20poly1305-ietf', sign: 'ed25519', hash: 'blake2b-256' },
        supersedes: null,
      },
    };
  }

  it('appendRecordSchema accepts a record with a supervisor sealedKey', () => {
    const parsed = appendRecordSchema.safeParse(
      record([
        {
          recipientType: 'org',
          recipientKeyId: 'org-key-id',
          alg: 'x25519-sealedbox',
          ciphertext: 'AAAA',
        },
        supervisorKey,
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it('addSealedKeysSchema accepts a supervisor wrapper (cosign-style POST)', () => {
    const parsed = addSealedKeysSchema.safeParse({
      recordId: '11111111-1111-1111-1111-111111111111',
      sealedKeys: [supervisorKey],
    });
    expect(parsed.success).toBe(true);
  });

  it('still rejects an unknown recipientType', () => {
    const parsed = addSealedKeysSchema.safeParse({
      recordId: '11111111-1111-1111-1111-111111111111',
      sealedKeys: [{ ...supervisorKey, recipientType: 'bogus' }],
    });
    expect(parsed.success).toBe(false);
  });
});
