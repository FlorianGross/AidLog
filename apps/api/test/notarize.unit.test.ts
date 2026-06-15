/**
 * Offline unit tests for ARCHIVAL ANCHORING that do NOT need a database:
 *   - the Merkle tree is DETERMINISTIC and order-independent (sorts by
 *     (deploymentId, seq)); recomputation from the same leaves matches.
 *   - the leaf/node domain prefixes are applied (a single record's root differs
 *     from the bare record-hash digest) and odd-level duplication is stable.
 *   - the server signature is deterministic and key-dependent.
 *   - migration 0006 ships the notarization_anchors table + perf indices and is
 *     METADATA-ONLY / append-only, and never issues DML against `records`.
 *
 * DB-backed happy paths (POST creates + GET lists an anchor) live in
 * notarize.integration.test.ts and run when TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { crypto as cryptoCore } from '@aidlog/crypto-core';
import {
  ANCHOR_ALGORITHM,
  buildMerkleRoot,
  canonicalAnchorString,
  compareLeaves,
  deriveAnchorKey,
  signAnchorRoot,
  type AnchorLeaf,
} from '../src/anchor.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0006_notarization_perf.sql'),
  'utf8',
);

/** Deterministic fake recordHash: base64 of BLAKE2b('rec:'+label). */
function rh(label: string): string {
  return cryptoCore.toBase64(cryptoCore.hash(cryptoCore.utf8(`rec:${label}`)));
}

describe('Merkle anchor — determinism & rules', () => {
  let leaves: AnchorLeaf[];

  beforeAll(async () => {
    await cryptoCore.ready();
    leaves = [
      { recordHash: rh('a0'), deploymentId: 'd1', seq: 0 },
      { recordHash: rh('a1'), deploymentId: 'd1', seq: 1 },
      { recordHash: rh('b0'), deploymentId: 'd2', seq: 0 },
    ];
  });

  it('is deterministic: same leaves -> same root + count', () => {
    const a = buildMerkleRoot(leaves);
    const b = buildMerkleRoot(leaves);
    expect(a.merkleRoot).toBe(b.merkleRoot);
    expect(a.recordCount).toBe(3);
  });

  it('is INDEPENDENT of input order (sorts by (deploymentId, seq))', () => {
    const shuffled = [leaves[2]!, leaves[0]!, leaves[1]!];
    expect(buildMerkleRoot(shuffled).merkleRoot).toBe(buildMerkleRoot(leaves).merkleRoot);
  });

  it('the total order is (deploymentId, seq)', () => {
    expect(compareLeaves(leaves[0]!, leaves[1]!)).toBeLessThan(0); // d1/0 < d1/1
    expect(compareLeaves(leaves[1]!, leaves[2]!)).toBeLessThan(0); // d1/1 < d2/0
    expect(compareLeaves(leaves[2]!, leaves[2]!)).toBe(0);
  });

  it('changing a single recordHash changes the root (tamper-evident)', () => {
    const root1 = buildMerkleRoot(leaves).merkleRoot;
    const tampered = [{ ...leaves[1]!, recordHash: rh('a1-tampered') }, leaves[0]!, leaves[2]!];
    expect(buildMerkleRoot(tampered).merkleRoot).not.toBe(root1);
  });

  it('a single-leaf root is domain-separated (not the bare record digest)', () => {
    const single = [{ recordHash: rh('only'), deploymentId: 'd', seq: 0 }];
    const root = buildMerkleRoot(single).merkleRoot;
    expect(root).not.toBe(single[0]!.recordHash);
  });

  it('odd-level duplication: 3 leaves produce a stable, reproducible root', () => {
    // Recompute the expected root by hand using the documented rule.
    const order = [...leaves].sort(compareLeaves);
    const leafHash = (h: string) =>
      cryptoCore.hash(concat(Uint8Array.of(0x00), cryptoCore.fromBase64(h)));
    const node = (l: Uint8Array, r: Uint8Array) =>
      cryptoCore.hash(concat(Uint8Array.of(0x01), l, r));
    const l0 = leafHash(order[0]!.recordHash);
    const l1 = leafHash(order[1]!.recordHash);
    const l2 = leafHash(order[2]!.recordHash);
    const n01 = node(l0, l1);
    const n22 = node(l2, l2); // last node duplicated
    const expected = cryptoCore.toBase64(node(n01, n22));
    expect(buildMerkleRoot(leaves).merkleRoot).toBe(expected);
  });

  it('rejects an empty record set', () => {
    expect(() => buildMerkleRoot([])).toThrow();
  });
});

describe('anchor signature', () => {
  it('canonical string pins algorithm:root:count', () => {
    expect(canonicalAnchorString(ANCHOR_ALGORITHM, 'ROOT', 7)).toBe(`${ANCHOR_ALGORITHM}:ROOT:7`);
  });

  it('is deterministic and key-dependent', () => {
    const s1 = signAnchorRoot('key-aaaa-1234567', ANCHOR_ALGORITHM, 'ROOT', 7);
    const s1b = signAnchorRoot('key-aaaa-1234567', ANCHOR_ALGORITHM, 'ROOT', 7);
    const s2 = signAnchorRoot('key-bbbb-7654321', ANCHOR_ALGORITHM, 'ROOT', 7);
    expect(s1).toBe(s1b);
    expect(s1).not.toBe(s2);
  });

  it('derives a dedicated key from SESSION_SECRET when ANCHOR_SECRET is absent', () => {
    const fromSession = deriveAnchorKey({ SESSION_SECRET: 'session-secret-abcdef' });
    // Not equal to the raw session secret (domain-separated derivation).
    expect(fromSession).not.toBe('session-secret-abcdef');
    // Explicit ANCHOR_SECRET wins.
    expect(deriveAnchorKey({ SESSION_SECRET: 'x', ANCHOR_SECRET: 'explicit-anchor-key' })).toBe(
      'explicit-anchor-key',
    );
  });
});

describe('0006 migration SQL', () => {
  it('creates notarization_anchors with a server signature + nullable TSA token', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS notarization_anchors/i);
    expect(migration).toMatch(/merkle_root\s+text NOT NULL/i);
    expect(migration).toMatch(/record_count\s+integer NOT NULL CHECK \(record_count > 0\)/i);
    expect(migration).toMatch(/server_signature\s+text NOT NULL/i);
    expect(migration).toMatch(/tsa_token\s+bytea/i);
  });

  it('holds METADATA ONLY — no content/secret COLUMNS', () => {
    // Assert no COLUMN of these names (prose mentions in comments are fine).
    expect(migration).not.toMatch(/\bpayload\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bciphertext\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bsecret(_key)?\s+(text|bytea|jsonb)/i);
    expect(migration).not.toMatch(/\bpassword\s+(text|bytea|jsonb)/i);
  });

  it('anchors are append-only: app role gets INSERT/SELECT only', () => {
    expect(migration).toMatch(/GRANT SELECT, INSERT ON notarization_anchors TO aidlog_app/i);
    expect(migration).not.toMatch(/UPDATE.*ON notarization_anchors/i);
    expect(migration).not.toMatch(/DELETE.*ON notarization_anchors/i);
  });

  it('adds the documented perf indices', () => {
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS records_org_deployment_seq_idx/i);
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS notarization_anchors_org_created_idx/i);
  });

  it('does NOT issue DDL/DML against the append-only records table', () => {
    expect(migration).not.toMatch(
      /\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\s+(TABLE\s+)?records\b/i,
    );
  });
});

// Local concat mirroring anchor.ts (test-only).
function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
