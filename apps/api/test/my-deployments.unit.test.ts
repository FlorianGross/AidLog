/**
 * Offline unit tests for the "Meine Einsätze" feature (no database):
 *   - migration 0013 relaxes the sealed_keys recipient_type CHECK to admit the
 *     persistent 'author' wrapper (the full 5-member set), touches no records
 *     grant, and adds no table.
 *   - the shared `sealedKey` zod schema (appendRecordSchema + cosign-style POSTs)
 *     accepts an 'author' wrapper, so a record carrying one validates.
 *   - the ROUTES.myDeployments path + DTO contract shape.
 *
 * The DB-backed behaviour (the route grouping the caller's own records by
 * deploymentId, scoped to org + author_key_id; the CHECK accepting 'author';
 * sync delivering the author wrapper in self scope) is covered by the
 * integration suite when TEST_DATABASE_URL is set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROUTES } from '@aidlog/contracts';
import type { MyDeploymentsResponse } from '@aidlog/contracts';
import { appendRecordSchema, addSealedKeysSchema } from '../src/validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0013_author_recipient.sql'),
  'utf8',
);

describe('0013 migration SQL', () => {
  it("relaxes the recipient_type CHECK to the 5-member set incl. 'author'", () => {
    expect(migration).toMatch(
      /recipient_type IN \('org', 'helper', 'cosigner', 'supervisor', 'author'\)/i,
    );
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

describe('sealedKey validation admits an author wrapper', () => {
  const authorKey = {
    recipientType: 'author' as const,
    recipientKeyId: 'author-key-id',
    alg: 'x25519-sealedbox' as const,
    ciphertext: 'AAAA',
  };

  it('appendRecordSchema accepts a record with an author sealedKey', () => {
    const parsed = appendRecordSchema.safeParse({
      record: {
        envelopeVersion: 1,
        id: '11111111-1111-1111-1111-111111111111',
        deploymentId: '22222222-2222-2222-2222-222222222222',
        seq: 0,
        createdAt: '2026-06-14T10:00:00.000Z',
        authorKeyId: 'author-key-id',
        payload: {
          alg: 'xchacha20poly1305-ietf',
          nonce: 'AAAA',
          ciphertext: 'AAAA',
          schemaId: 'default',
          schemaVersion: 1,
        },
        blobs: [],
        sealedKeys: [
          {
            recipientType: 'org',
            recipientKeyId: 'org-key-id',
            alg: 'x25519-sealedbox',
            ciphertext: 'AAAA',
          },
          authorKey,
        ],
        prevHash: null,
        recordHash: 'AAAA',
        signature: 'AAAA',
        alg: { aead: 'xchacha20poly1305-ietf', sign: 'ed25519', hash: 'blake2b-256' },
        supersedes: null,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('addSealedKeysSchema accepts an author wrapper', () => {
    const parsed = addSealedKeysSchema.safeParse({
      recordId: '11111111-1111-1111-1111-111111111111',
      sealedKeys: [authorKey],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('ROUTES.myDeployments contract', () => {
  it('exposes the /api/my/deployments path', () => {
    expect(ROUTES.myDeployments).toBe('/api/my/deployments');
  });

  it('the response DTO is a list of id+count+timestamp summaries (no ciphertext)', () => {
    const res: MyDeploymentsResponse = {
      deployments: [
        {
          deploymentId: '22222222-2222-2222-2222-222222222222',
          recordCount: 3,
          firstCreatedAt: '2026-06-14T08:00:00.000Z',
          lastCreatedAt: '2026-06-14T10:00:00.000Z',
        },
      ],
    };
    const summary = res.deployments[0]!;
    expect(Object.keys(summary).sort()).toEqual([
      'deploymentId',
      'firstCreatedAt',
      'lastCreatedAt',
      'recordCount',
    ]);
    // No payload/ciphertext/title field leaks into the summary shape.
    expect(summary).not.toHaveProperty('payload');
    expect(summary).not.toHaveProperty('title');
  });
});
