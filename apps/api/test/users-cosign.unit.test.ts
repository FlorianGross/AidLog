/**
 * Offline unit tests for the user/role system, invitations, and co-signature
 * that do NOT need a database:
 *   - migration 0002 ships the expected tables/constraints (BLIND invariants).
 *   - invitation codes are only ever stored hashed; the hash is deterministic.
 *   - the last-admin guard predicate.
 *   - co-signature Ed25519 verification: a good signature over the recordHash is
 *     accepted, a tampered signature/hash is rejected (via @aidlog/crypto-core).
 *
 * DB-backed happy paths (HTTP create→redeem, role enforcement, sealedKeys append
 * not mutating records) live in integration.test.ts and run when
 * TEST_DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashInvitationCode, generateInvitationCode } from '../src/invite.js';
import { REDACT_PATHS } from '../src/redact.js';
import type { CryptoCore, IdentityKeyPair } from '@aidlog/crypto-core';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'src', 'db', 'migrations', '0002_users_cosign.sql'),
  'utf8',
);

describe('0002 migration SQL', () => {
  it('extends helpers with role + status columns (constrained)', () => {
    expect(migration).toMatch(/ALTER TABLE helpers[\s\S]*ADD COLUMN IF NOT EXISTS role text/i);
    expect(migration).toMatch(/role IN \('admin', 'lead', 'helper'\)/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS status text/i);
    expect(migration).toMatch(/status IN \('active', 'disabled'\)/i);
  });

  it('stores only a HASH of the invitation code, never the code', () => {
    expect(migration).toMatch(/code_hash\s+text NOT NULL UNIQUE/i);
    // No column literally named "code" (without _hash) is created.
    expect(migration).not.toMatch(/\bcode\s+text NOT NULL\b(?!_)/i);
  });

  it('creates invitations, cosignature_requests and cosignatures tables', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS invitations/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS cosignature_requests/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS cosignatures/i);
  });

  it('allows recipient_type cosigner on sealed_keys', () => {
    expect(migration).toMatch(/recipient_type IN \('org', 'helper', 'cosigner'\)/i);
  });

  it('does not grant the app role UPDATE/DELETE on records (append-only intact)', () => {
    // 0002 must never touch the records grants.
    expect(migration).not.toMatch(/ON\s+records\s+TO\s+aidlog_app/i);
  });
});

describe('invitation code hashing', () => {
  const secret = 'unit-test-secret-which-is-long-enough';

  it('generates a high-entropy url-safe code', () => {
    const code = generateInvitationCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeGreaterThanOrEqual(24);
  });

  it('hashes deterministically and the hash is not the code', () => {
    const code = generateInvitationCode();
    const h1 = hashInvitationCode(secret, code);
    const h2 = hashInvitationCode(secret, code);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(code);
  });

  it('a different code yields a different hash', () => {
    expect(hashInvitationCode(secret, 'aaa')).not.toBe(hashInvitationCode(secret, 'bbb'));
  });

  it('redaction config covers the invitation code field', () => {
    expect(REDACT_PATHS).toContain('*.code');
    expect(REDACT_PATHS).toContain('code');
  });
});

// last-admin guard predicate, mirroring routes/users.ts logic.
function wouldOrphanLastAdmin(
  target: { role: string; status: string },
  change: { role?: string; status?: string },
  activeAdminCount: number,
): boolean {
  const demotes = target.role === 'admin' && change.role !== undefined && change.role !== 'admin';
  const disables = target.role === 'admin' && change.status === 'disabled';
  if (!demotes && !disables) return false;
  const targetIsActiveAdmin = target.status === 'active';
  return targetIsActiveAdmin && activeAdminCount <= 1;
}

describe('last-admin guard', () => {
  it('blocks demoting the last active admin', () => {
    expect(wouldOrphanLastAdmin({ role: 'admin', status: 'active' }, { role: 'helper' }, 1)).toBe(
      true,
    );
  });
  it('blocks disabling the last active admin', () => {
    expect(
      wouldOrphanLastAdmin({ role: 'admin', status: 'active' }, { status: 'disabled' }, 1),
    ).toBe(true);
  });
  it('allows demoting an admin when others remain', () => {
    expect(wouldOrphanLastAdmin({ role: 'admin', status: 'active' }, { role: 'lead' }, 2)).toBe(
      false,
    );
  });
  it('does not block changes to non-admins', () => {
    expect(
      wouldOrphanLastAdmin({ role: 'helper', status: 'active' }, { status: 'disabled' }, 1),
    ).toBe(false);
  });
});

describe('co-signature signature verification (crypto-core)', () => {
  let cc: CryptoCore;
  let signer: IdentityKeyPair;
  let recordHash: Uint8Array;

  beforeAll(async () => {
    ({ crypto: cc } = await import('@aidlog/crypto-core'));
    await cc.ready();
    signer = cc.generateIdentity();
    // a stand-in 32-byte record hash (what the server stores per record).
    recordHash = cc.hash(cc.utf8('a finalised record'));
  });

  it('accepts a valid co-signature over the recordHash', () => {
    const sig = cc.sign(recordHash, signer.sign.secretKey);
    const ok = cc.verify(sig, recordHash, signer.sign.publicKey);
    expect(ok).toBe(true);
  });

  it('rejects a co-signature over a DIFFERENT hash (tampered record)', () => {
    const sig = cc.sign(recordHash, signer.sign.secretKey);
    const tamperedHash = cc.hash(cc.utf8('a tampered record'));
    expect(cc.verify(sig, tamperedHash, signer.sign.publicKey)).toBe(false);
  });

  it('rejects a co-signature whose bytes were flipped', () => {
    const sig = cc.sign(recordHash, signer.sign.secretKey);
    const forged = new Uint8Array(sig);
    forged[0] ^= 0xff;
    expect(cc.verify(forged, recordHash, signer.sign.publicKey)).toBe(false);
  });

  it('rejects a co-signature made by a different signer', () => {
    const other = cc.generateIdentity();
    const sig = cc.sign(recordHash, other.sign.secretKey);
    expect(cc.verify(sig, recordHash, signer.sign.publicKey)).toBe(false);
  });
});
