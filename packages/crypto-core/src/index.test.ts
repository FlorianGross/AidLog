/**
 * crypto-core test suite (Vitest).
 *
 * Covers every method on the CryptoCore interface plus the security-critical
 * behaviours: AEAD round-trips, sealed-box key wrapping, wrong-password
 * rejection, signature verify pass/fail, canonicalization stability across key
 * insertion order, and hash-chain construction + tamper detection.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ENVELOPE_VERSION,
  type ProtocolRecord,
  type PublicIdentity,
  type SignableRecord,
} from '@aidlog/contracts';

import {
  crypto,
  CryptoError,
  DecryptionError,
  type AeadCiphertext,
  type IdentityKeyPair,
  type ShamirShare,
} from './index.js';

beforeAll(async () => {
  await crypto.ready();
});

// ---------------------------------------------------------------------------
// Helpers for building chained records
// ---------------------------------------------------------------------------

interface BuiltRecord {
  record: ProtocolRecord;
  prevHash: string | null;
}

function buildRecord(
  author: IdentityKeyPair,
  authorPublic: PublicIdentity,
  deploymentId: string,
  seq: number,
  prevHash: string | null,
  payloadText: string,
): BuiltRecord {
  const dek = crypto.randomDek();
  const payloadCt = crypto.encryptPayload(crypto.utf8(payloadText), dek);

  const signable: SignableRecord = {
    envelopeVersion: ENVELOPE_VERSION,
    id: `id-${seq}`,
    deploymentId,
    seq,
    createdAt: new Date(1700000000000 + seq * 1000).toISOString(),
    authorKeyId: authorPublic.keyId,
    payload: {
      alg: 'xchacha20poly1305-ietf',
      nonce: crypto.toBase64(payloadCt.nonce),
      ciphertext: crypto.toBase64(payloadCt.ciphertext),
      schemaId: 'protocol.basic',
      schemaVersion: 1,
    },
    blobs: [],
    sealedKeys: crypto.buildSealedKeys(dek, [{ type: 'org', identity: authorPublic }]),
    prevHash,
    alg: { aead: 'xchacha20poly1305-ietf', sign: 'ed25519', hash: 'blake2b-256' },
  };

  const recordHash = crypto.computeRecordHash(signable);
  const signature = crypto.sign(recordHash, author.sign.secretKey);

  const record: ProtocolRecord = {
    ...signable,
    recordHash: crypto.toBase64(recordHash),
    signature: crypto.toBase64(signature),
  };
  return { record, prevHash };
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

describe('encoding helpers', () => {
  it('base64 round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 127, 128]);
    expect(crypto.fromBase64(crypto.toBase64(bytes))).toEqual(bytes);
  });

  it('utf8 round-trips unicode strings', () => {
    const s = 'Einsatz: Müller — 42°C 🚑';
    expect(crypto.fromUtf8(crypto.utf8(s))).toBe(s);
  });

  it('base64 uses standard (padded) variant', () => {
    // 1 byte → 2 base64 chars + '==' padding in the ORIGINAL variant.
    expect(crypto.toBase64(new Uint8Array([0]))).toBe('AA==');
  });
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('identity', () => {
  it('generates distinct box and sign keypairs', () => {
    const id = crypto.generateIdentity();
    expect(id.box.publicKey).toHaveLength(32);
    expect(id.sign.publicKey).toHaveLength(32);
    expect(id.sign.secretKey).toHaveLength(64); // Ed25519 secret = 64 bytes
    const id2 = crypto.generateIdentity();
    expect(crypto.toBase64(id.box.publicKey)).not.toBe(crypto.toBase64(id2.box.publicKey));
  });

  it('toPublicIdentity derives keyId = base64(signPublicKey)', () => {
    const id = crypto.generateIdentity();
    const pub = crypto.toPublicIdentity(id);
    expect(pub.keyId).toBe(crypto.toBase64(id.sign.publicKey));
    expect(pub.boxPublicKey).toBe(crypto.toBase64(id.box.publicKey));
    expect(pub.signPublicKey).toBe(crypto.toBase64(id.sign.publicKey));
  });
});

// ---------------------------------------------------------------------------
// KDF + identity wrapping
// ---------------------------------------------------------------------------

describe('KDF and identity wrapping', () => {
  it('defaultKdfParams returns argon2id with a fresh 16+ byte salt each call', () => {
    const a = crypto.defaultKdfParams();
    const b = crypto.defaultKdfParams();
    expect(a.alg).toBe('argon2id');
    expect(crypto.fromBase64(a.salt).length).toBeGreaterThanOrEqual(16);
    expect(a.salt).not.toBe(b.salt); // freshly random
    expect(a.opsLimit).toBeGreaterThan(0);
    expect(a.memLimit).toBeGreaterThan(0);
  });

  it('deriveKey is deterministic for the same password+params', async () => {
    const params = crypto.defaultKdfParams();
    const k1 = await crypto.deriveKey('correct horse', params);
    const k2 = await crypto.deriveKey('correct horse', params);
    expect(k1).toEqual(k2);
    expect(k1).toHaveLength(32);
  });

  it('deriveKey differs for a different password', async () => {
    const params = crypto.defaultKdfParams();
    const k1 = await crypto.deriveKey('password-a', params);
    const k2 = await crypto.deriveKey('password-b', params);
    expect(k1).not.toEqual(k2);
  });

  it('wrap then unwrap recovers the same identity', async () => {
    const id = crypto.generateIdentity();
    const wrapped = await crypto.wrapIdentity(id, 'hunter2');
    expect(wrapped.alg).toBe('xchacha20poly1305-ietf');
    expect(wrapped.kdf.alg).toBe('argon2id');

    const restored = await crypto.unwrapIdentity(wrapped, 'hunter2');
    expect(restored.box.secretKey).toEqual(id.box.secretKey);
    expect(restored.sign.secretKey).toEqual(id.sign.secretKey);
    // public keys are re-derived from the secret keys and must match
    expect(restored.box.publicKey).toEqual(id.box.publicKey);
    expect(restored.sign.publicKey).toEqual(id.sign.publicKey);
  });

  it('unwrap with the WRONG password throws DecryptionError', async () => {
    const id = crypto.generateIdentity();
    const wrapped = await crypto.wrapIdentity(id, 'right-password');
    await expect(crypto.unwrapIdentity(wrapped, 'wrong-password')).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('wrapIdentity honours explicit KdfParams', async () => {
    const id = crypto.generateIdentity();
    const params = crypto.defaultKdfParams();
    const wrapped = await crypto.wrapIdentity(id, 'pw', params);
    expect(wrapped.kdf.salt).toBe(params.salt);
    const restored = await crypto.unwrapIdentity(wrapped, 'pw');
    expect(restored.sign.secretKey).toEqual(id.sign.secretKey);
  });
});

// ---------------------------------------------------------------------------
// DEK sealing
// ---------------------------------------------------------------------------

describe('DEK sealing (crypto_box_seal)', () => {
  it('seal to org + helper; each recipient opens it; the DEK matches', () => {
    const org = crypto.generateIdentity();
    const helper = crypto.generateIdentity();
    const orgPub = crypto.toPublicIdentity(org);
    const helperPub = crypto.toPublicIdentity(helper);

    const dek = crypto.randomDek();
    const sealedKeys = crypto.buildSealedKeys(dek, [
      { type: 'org', identity: orgPub },
      { type: 'helper', identity: helperPub },
    ]);
    expect(sealedKeys).toHaveLength(2);
    expect(sealedKeys[0]!.recipientType).toBe('org');
    expect(sealedKeys[0]!.recipientKeyId).toBe(orgPub.keyId);
    expect(sealedKeys[0]!.alg).toBe('x25519-sealedbox');
    expect(sealedKeys[1]!.recipientType).toBe('helper');

    const orgOpened = crypto.openSealedDek(crypto.fromBase64(sealedKeys[0]!.ciphertext), org.box);
    const helperOpened = crypto.openSealedDek(
      crypto.fromBase64(sealedKeys[1]!.ciphertext),
      helper.box,
    );
    expect(orgOpened).toEqual(dek);
    expect(helperOpened).toEqual(dek);
  });

  it('sealDek/openSealedDek round-trips directly', () => {
    const r = crypto.generateIdentity();
    const dek = crypto.randomDek();
    const sealed = crypto.sealDek(dek, r.box.publicKey);
    expect(crypto.openSealedDek(sealed, r.box)).toEqual(dek);
  });

  it('opening with the wrong recipient key throws DecryptionError', () => {
    const r = crypto.generateIdentity();
    const wrong = crypto.generateIdentity();
    const sealed = crypto.sealDek(crypto.randomDek(), r.box.publicKey);
    expect(() => crypto.openSealedDek(sealed, wrong.box)).toThrow(DecryptionError);
  });
});

// ---------------------------------------------------------------------------
// Payload AEAD
// ---------------------------------------------------------------------------

describe('payload encryption', () => {
  it('round-trips a payload under the DEK', () => {
    const dek = crypto.randomDek();
    const plaintext = crypto.utf8(JSON.stringify({ patient: 'A', bp: '120/80' }));
    const ct = crypto.encryptPayload(plaintext, dek);
    expect(ct.alg).toBe('xchacha20poly1305-ietf');
    expect(ct.nonce).toHaveLength(24); // XChaCha20 nonce
    expect(crypto.decryptPayload(ct, dek)).toEqual(plaintext);
  });

  it('fails to decrypt with the wrong DEK', () => {
    const ct = crypto.encryptPayload(crypto.utf8('secret'), crypto.randomDek());
    expect(() => crypto.decryptPayload(ct, crypto.randomDek())).toThrow(DecryptionError);
  });

  it('detects tampered ciphertext', () => {
    const dek = crypto.randomDek();
    const ct = crypto.encryptPayload(crypto.utf8('secret'), dek);
    const tampered: AeadCiphertext = { ...ct, ciphertext: new Uint8Array(ct.ciphertext) };
    tampered.ciphertext[0]! ^= 0xff;
    expect(() => crypto.decryptPayload(tampered, dek)).toThrow(DecryptionError);
  });
});

// ---------------------------------------------------------------------------
// Blob secretstream
// ---------------------------------------------------------------------------

describe('blob encryption (secretstream)', () => {
  it('round-trips a binary blob', () => {
    const dek = crypto.randomDek();
    const data = new Uint8Array(5000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff;
    const { header, ciphertext } = crypto.encryptBlob(data, dek);
    expect(header.length).toBeGreaterThan(0);
    expect(crypto.decryptBlob(header, ciphertext, dek)).toEqual(data);
  });

  it('round-trips an empty blob', () => {
    const dek = crypto.randomDek();
    const { header, ciphertext } = crypto.encryptBlob(new Uint8Array(0), dek);
    expect(crypto.decryptBlob(header, ciphertext, dek)).toEqual(new Uint8Array(0));
  });

  it('fails with the wrong DEK', () => {
    const { header, ciphertext } = crypto.encryptBlob(
      new Uint8Array([1, 2, 3]),
      crypto.randomDek(),
    );
    expect(() => crypto.decryptBlob(header, ciphertext, crypto.randomDek())).toThrow(
      DecryptionError,
    );
  });

  it('detects a tampered ciphertext byte', () => {
    const dek = crypto.randomDek();
    const { header, ciphertext } = crypto.encryptBlob(new Uint8Array([9, 8, 7, 6]), dek);
    const bad = new Uint8Array(ciphertext);
    bad[0]! ^= 0x01;
    expect(() => crypto.decryptBlob(header, bad, dek)).toThrow(DecryptionError);
  });
});

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

describe('hash', () => {
  it('produces a 32-byte BLAKE2b digest', () => {
    const h = crypto.hash(crypto.utf8('abc'));
    expect(h).toHaveLength(32);
  });

  it('is deterministic and collision-sensitive', () => {
    expect(crypto.hash(crypto.utf8('x'))).toEqual(crypto.hash(crypto.utf8('x')));
    expect(crypto.hash(crypto.utf8('x'))).not.toEqual(crypto.hash(crypto.utf8('y')));
  });
});

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

describe('canonicalize', () => {
  it('is stable regardless of key insertion order', () => {
    const base = {
      envelopeVersion: ENVELOPE_VERSION,
      id: 'r1',
      deploymentId: 'd1',
      seq: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      authorKeyId: 'k',
      payload: {
        alg: 'xchacha20poly1305-ietf',
        nonce: 'n',
        ciphertext: 'c',
        schemaId: 's',
        schemaVersion: 1,
      },
      blobs: [],
      sealedKeys: [],
      prevHash: null,
      alg: { aead: 'xchacha20poly1305-ietf', sign: 'ed25519', hash: 'blake2b-256' },
    } as unknown as SignableRecord;

    // Same data, different key insertion order at every level.
    const reordered = {
      alg: { hash: 'blake2b-256', sign: 'ed25519', aead: 'xchacha20poly1305-ietf' },
      prevHash: null,
      sealedKeys: [],
      blobs: [],
      payload: {
        schemaVersion: 1,
        schemaId: 's',
        ciphertext: 'c',
        nonce: 'n',
        alg: 'xchacha20poly1305-ietf',
      },
      authorKeyId: 'k',
      createdAt: '2026-01-01T00:00:00.000Z',
      seq: 0,
      deploymentId: 'd1',
      id: 'r1',
      envelopeVersion: ENVELOPE_VERSION,
    } as unknown as SignableRecord;

    expect(crypto.canonicalize(base)).toEqual(crypto.canonicalize(reordered));
    // and the hashes therefore match
    expect(crypto.computeRecordHash(base)).toEqual(crypto.computeRecordHash(reordered));
  });

  it('omits undefined optional fields so they do not change the hash', () => {
    const withUndef = { a: 1, b: undefined } as unknown as SignableRecord;
    const without = { a: 1 } as unknown as SignableRecord;
    expect(crypto.canonicalize(withUndef)).toEqual(crypto.canonicalize(without));
  });

  it('distinguishes different values', () => {
    const a = { x: 1 } as unknown as SignableRecord;
    const b = { x: 2 } as unknown as SignableRecord;
    expect(crypto.canonicalize(a)).not.toEqual(crypto.canonicalize(b));
  });
});

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

describe('sign / verify', () => {
  it('verifies a valid signature', () => {
    const id = crypto.generateIdentity();
    const msg = crypto.utf8('attest');
    const sig = crypto.sign(msg, id.sign.secretKey);
    expect(crypto.verify(sig, msg, id.sign.publicKey)).toBe(true);
  });

  it('rejects a signature over a different message', () => {
    const id = crypto.generateIdentity();
    const sig = crypto.sign(crypto.utf8('a'), id.sign.secretKey);
    expect(crypto.verify(sig, crypto.utf8('b'), id.sign.publicKey)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const id = crypto.generateIdentity();
    const other = crypto.generateIdentity();
    const msg = crypto.utf8('a');
    const sig = crypto.sign(msg, id.sign.secretKey);
    expect(crypto.verify(sig, msg, other.sign.publicKey)).toBe(false);
  });

  it('returns false (not throw) for a malformed signature', () => {
    const id = crypto.generateIdentity();
    expect(crypto.verify(new Uint8Array(3), crypto.utf8('a'), id.sign.publicKey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyRecord + hash chain
// ---------------------------------------------------------------------------

describe('verifyRecord and the hash chain', () => {
  it('verifies a single well-formed record', () => {
    const author = crypto.generateIdentity();
    const pub = crypto.toPublicIdentity(author);
    const { record } = buildRecord(author, pub, 'dep', 0, null, 'first');
    expect(crypto.verifyRecord(record, null)).toBe(true);
  });

  it('builds and verifies a 3-record chain end to end', () => {
    const author = crypto.generateIdentity();
    const pub = crypto.toPublicIdentity(author);

    const r0 = buildRecord(author, pub, 'dep', 0, null, 'r0');
    const r1 = buildRecord(author, pub, 'dep', 1, r0.record.recordHash, 'r1');
    const r2 = buildRecord(author, pub, 'dep', 2, r1.record.recordHash, 'r2');

    const chain = [r0.record, r1.record, r2.record];
    let expectedPrev: string | null = null;
    for (const rec of chain) {
      expect(crypto.verifyRecord(rec, expectedPrev)).toBe(true);
      expectedPrev = rec.recordHash;
    }
  });

  it('detects a flipped payload byte (recordHash mismatch)', () => {
    const author = crypto.generateIdentity();
    const pub = crypto.toPublicIdentity(author);
    const { record } = buildRecord(author, pub, 'dep', 0, null, 'r0');

    // Tamper with the ciphertext but leave recordHash/signature intact.
    const ctBytes = crypto.fromBase64(record.payload.ciphertext);
    ctBytes[0]! ^= 0xff;
    const tampered: ProtocolRecord = {
      ...record,
      payload: { ...record.payload, ciphertext: crypto.toBase64(ctBytes) },
    };
    expect(crypto.verifyRecord(tampered, null)).toBe(false);
  });

  it('detects a broken chain link (wrong prevHash)', () => {
    const author = crypto.generateIdentity();
    const pub = crypto.toPublicIdentity(author);
    const r0 = buildRecord(author, pub, 'dep', 0, null, 'r0');
    const r1 = buildRecord(author, pub, 'dep', 1, r0.record.recordHash, 'r1');
    // Verify r1 against the WRONG expected prevHash.
    expect(crypto.verifyRecord(r1.record, 'not-the-real-prev')).toBe(false);
  });

  it('detects a forged signature', () => {
    const author = crypto.generateIdentity();
    const attacker = crypto.generateIdentity();
    const pub = crypto.toPublicIdentity(author);
    const { record } = buildRecord(author, pub, 'dep', 0, null, 'r0');

    // Re-sign the same hash with the attacker's key but keep the real authorKeyId.
    const forged: ProtocolRecord = {
      ...record,
      signature: crypto.toBase64(
        crypto.sign(crypto.fromBase64(record.recordHash), attacker.sign.secretKey),
      ),
    };
    expect(crypto.verifyRecord(forged, null)).toBe(false);
  });

  it('accepts an explicit signPublicKey override (future hashed-keyId path)', () => {
    const author = crypto.generateIdentity();
    const pub = crypto.toPublicIdentity(author);
    const { record } = buildRecord(author, pub, 'dep', 0, null, 'r0');
    // Pass the signing pubkey explicitly; should still verify.
    expect(crypto.verifyRecord(record, null, author.sign.publicKey)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: encrypt a record for org + helper, org decrypts
// ---------------------------------------------------------------------------

describe('end-to-end envelope', () => {
  it('helper writes a record sealed to org+helper; org reads it back', () => {
    const org = crypto.generateIdentity();
    const helper = crypto.generateIdentity();
    const orgPub = crypto.toPublicIdentity(org);
    const helperPub = crypto.toPublicIdentity(helper);

    // Helper-side: encrypt payload + seal DEK to both recipients.
    const dek = crypto.randomDek();
    const payload = crypto.utf8(JSON.stringify({ note: 'patient stable' }));
    const ct = crypto.encryptPayload(payload, dek);
    const sealedKeys = crypto.buildSealedKeys(dek, [
      { type: 'org', identity: orgPub },
      { type: 'helper', identity: helperPub },
    ]);

    // Org-side: find its sealed key, open it, decrypt payload.
    const orgSealed = sealedKeys.find((k) => k.recipientType === 'org')!;
    const orgDek = crypto.openSealedDek(crypto.fromBase64(orgSealed.ciphertext), org.box);
    const recovered = crypto.decryptPayload(ct, orgDek);
    expect(crypto.fromUtf8(recovered)).toBe(JSON.stringify({ note: 'patient stable' }));
  });
});

// ---------------------------------------------------------------------------
// Identity secret export / import
// ---------------------------------------------------------------------------

describe('identity secret export/import', () => {
  it('exportIdentitySecret → importIdentitySecret round-trips an identity', () => {
    const id = crypto.generateIdentity();
    const bytes = crypto.exportIdentitySecret(id);
    const restored = crypto.importIdentitySecret(bytes);
    expect(restored.box.secretKey).toEqual(id.box.secretKey);
    expect(restored.sign.secretKey).toEqual(id.sign.secretKey);
    // public keys re-derived from the secret keys must match
    expect(restored.box.publicKey).toEqual(id.box.publicKey);
    expect(restored.sign.publicKey).toEqual(id.sign.publicKey);
  });

  it('export serialization is consistent with wrapIdentity (same bundle layout)', async () => {
    // The bytes export produces must be exactly what unwrap reconstructs from,
    // i.e. wrap(export-then-rewrap) and unwrap agree. We verify by wrapping the
    // identity and confirming unwrap yields the same keys export gives us.
    const id = crypto.generateIdentity();
    const exported = crypto.importIdentitySecret(crypto.exportIdentitySecret(id));
    const wrapped = await crypto.wrapIdentity(id, 'pw');
    const unwrapped = await crypto.unwrapIdentity(wrapped, 'pw');
    expect(unwrapped.box.secretKey).toEqual(exported.box.secretKey);
    expect(unwrapped.sign.secretKey).toEqual(exported.sign.secretKey);
  });

  it('imported identity is fully functional (sign/verify + seal/open)', () => {
    const id = crypto.generateIdentity();
    const restored = crypto.importIdentitySecret(crypto.exportIdentitySecret(id));
    // sign with the restored key, verify with the restored public key
    const msg = crypto.utf8('attestation');
    const sig = crypto.sign(msg, restored.sign.secretKey);
    expect(crypto.verify(sig, msg, restored.sign.publicKey)).toBe(true);
    // seal to the restored box public key, open with the restored box secret
    const dek = crypto.randomDek();
    const sealed = crypto.sealDek(dek, restored.box.publicKey);
    expect(crypto.openSealedDek(sealed, restored.box)).toEqual(dek);
  });

  it('importIdentitySecret rejects malformed bytes', () => {
    expect(() => crypto.importIdentitySecret(new Uint8Array([1, 2, 3]))).toThrow(CryptoError);
  });
});

// ---------------------------------------------------------------------------
// Shamir secret sharing (GF(256))
// ---------------------------------------------------------------------------

describe('Shamir secret sharing', () => {
  /** Deterministic-ish random secret of a given length. */
  function randomSecret(len: number): Uint8Array {
    const s = new Uint8Array(len);
    for (let i = 0; i < len; i++) s[i] = (i * 131 + 7) & 0xff;
    // mix in real randomness so we exercise full byte range incl. zeros
    const r = crypto.randomDek();
    for (let i = 0; i < len; i++) s[i]! ^= r[i % r.length]!;
    return s;
  }

  /** All k-element subsets of [0..n) (n small in tests). */
  function combinations<T>(arr: T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (k > arr.length) return [];
    const [head, ...rest] = arr;
    const withHead = combinations(rest, k - 1).map((c) => [head!, ...c]);
    const withoutHead = combinations(rest, k);
    return [...withHead, ...withoutHead];
  }

  it('split/combine round-trips a random secret (3-of-5)', () => {
    const secret = randomSecret(40);
    const shares = crypto.splitSecret(secret, 5, 3);
    expect(shares).toHaveLength(5);
    for (const sh of shares) expect(sh.data).toHaveLength(secret.length);
    // distinct indices in 1..255
    expect(new Set(shares.map((s) => s.index)).size).toBe(5);
    for (const sh of shares) {
      expect(sh.index).toBeGreaterThanOrEqual(1);
      expect(sh.index).toBeLessThanOrEqual(255);
    }
    const combined = crypto.combineSecret(shares.slice(0, 3));
    expect(combined).toEqual(secret);
  });

  it('ANY threshold-sized subset reconstructs the secret', () => {
    const secret = randomSecret(33);
    const shares = crypto.splitSecret(secret, 5, 3);
    for (const subset of combinations(shares, 3)) {
      expect(crypto.combineSecret(subset)).toEqual(secret);
    }
    // a larger subset (4 and all 5) also works
    expect(crypto.combineSecret(shares.slice(0, 4))).toEqual(secret);
    expect(crypto.combineSecret(shares)).toEqual(secret);
  });

  it('fewer than threshold shares do NOT reconstruct the secret', () => {
    const secret = randomSecret(48);
    const shares = crypto.splitSecret(secret, 5, 3);
    // With only 2 of the 3 required, combineSecret produces SOMETHING, but it
    // must not equal the real secret (Shamir's information-theoretic property:
    // threshold-1 points leave the constant term undetermined).
    let everEqual = false;
    for (const subset of combinations(shares, 2)) {
      const wrong = crypto.combineSecret(subset);
      expect(wrong).toHaveLength(secret.length);
      if (wrong.every((b, i) => b === secret[i])) everEqual = true;
    }
    expect(everEqual).toBe(false);
  });

  it('a single share reveals nothing (combine of <2 throws)', () => {
    const shares = crypto.splitSecret(randomSecret(16), 3, 2);
    expect(() => crypto.combineSecret([shares[0]!])).toThrow(CryptoError);
  });

  it('round-trips the org IDENTITY secret: export → split → combine → import', () => {
    const org = crypto.generateIdentity();
    const secret = crypto.exportIdentitySecret(org);
    const shares = crypto.splitSecret(secret, 5, 3);

    // Reconstruct from a non-prefix subset (indices 2,4,5) to prove any subset.
    const subset = [shares[1]!, shares[3]!, shares[4]!];
    const rebuiltBytes = crypto.combineSecret(subset);
    expect(rebuiltBytes).toEqual(secret);

    const rebuilt = crypto.importIdentitySecret(rebuiltBytes);
    expect(rebuilt.sign.secretKey).toEqual(org.sign.secretKey);
    expect(rebuilt.box.secretKey).toEqual(org.box.secretKey);

    // The rebuilt org key still works end-to-end: sign/verify + seal/open.
    const msg = crypto.utf8('org recovery attestation');
    const sig = crypto.sign(msg, rebuilt.sign.secretKey);
    expect(crypto.verify(sig, msg, org.sign.publicKey)).toBe(true);
    const dek = crypto.randomDek();
    const sealed = crypto.sealDek(dek, org.box.publicKey);
    expect(crypto.openSealedDek(sealed, rebuilt.box)).toEqual(dek);

    // And it can be re-wrapped under a NEW password (the recovery end state).
    return crypto.wrapIdentity(rebuilt, 'new-org-password').then(async (w) => {
      const reunwrapped = await crypto.unwrapIdentity(w, 'new-org-password');
      expect(reunwrapped.sign.secretKey).toEqual(org.sign.secretKey);
    });
  });

  it('handles 2-of-2 and the maximum (T = N)', () => {
    const secret = randomSecret(20);
    const two = crypto.splitSecret(secret, 2, 2);
    expect(crypto.combineSecret(two)).toEqual(secret);
    const tn = crypto.splitSecret(secret, 7, 7);
    expect(crypto.combineSecret(tn)).toEqual(secret);
    expect(() => crypto.combineSecret(tn.slice(0, 6))).not.toThrow(); // 6 points → wrong, not throw
  });

  it('validates parameters', () => {
    const secret = randomSecret(8);
    expect(() => crypto.splitSecret(secret, 5, 1)).toThrow(CryptoError); // threshold < 2
    expect(() => crypto.splitSecret(secret, 2, 3)).toThrow(CryptoError); // threshold > shareCount
    expect(() => crypto.splitSecret(secret, 256, 2)).toThrow(CryptoError); // shareCount > 255
    expect(() => crypto.splitSecret(new Uint8Array(0), 3, 2)).toThrow(CryptoError); // empty secret
    expect(() => crypto.splitSecret(secret, 5, 2.5)).toThrow(CryptoError); // non-integer
  });

  it('combineSecret rejects duplicate or mismatched shares', () => {
    const shares = crypto.splitSecret(randomSecret(12), 4, 3);
    expect(() => crypto.combineSecret([shares[0]!, shares[0]!, shares[1]!])).toThrow(CryptoError);
    const bad: ShamirShare = { index: 9, data: new Uint8Array(3) };
    expect(() => crypto.combineSecret([shares[0]!, shares[1]!, bad])).toThrow(CryptoError);
  });
});

// ---------------------------------------------------------------------------
// Share encoding (human-transferable text + checksum)
// ---------------------------------------------------------------------------

describe('share encoding/decoding', () => {
  it('encode → decode round-trips a share', () => {
    const shares = crypto.splitSecret(crypto.exportIdentitySecret(crypto.generateIdentity()), 5, 3);
    for (const sh of shares) {
      const text = crypto.encodeShare(sh);
      const back = crypto.decodeShare(text);
      expect(back.index).toBe(sh.index);
      expect(back.data).toEqual(sh.data);
    }
  });

  it('encoded shares decode and then reconstruct the secret', () => {
    const secret = crypto.exportIdentitySecret(crypto.generateIdentity());
    const encoded = crypto.splitSecret(secret, 4, 2).map((s) => crypto.encodeShare(s));
    const decoded = [encoded[3]!, encoded[1]!].map((t) => crypto.decodeShare(t));
    expect(crypto.combineSecret(decoded)).toEqual(secret);
  });

  it('decode rejects a corrupted share (checksum mismatch)', () => {
    const sh = crypto.splitSecret(crypto.exportIdentitySecret(crypto.generateIdentity()), 3, 2)[0]!;
    const text = crypto.encodeShare(sh);
    const parts = text.split('.');
    // Flip a character in the base64 data field (parts[3]).
    const data = parts[3]!;
    const flipped = (data[0] === 'A' ? 'B' : 'A') + data.slice(1);
    const corrupted = [parts[0], parts[1], parts[2], flipped, parts[4]].join('.');
    expect(() => crypto.decodeShare(corrupted)).toThrow(CryptoError);
  });

  it('decode rejects a tampered index (checksum binds the index too)', () => {
    const sh = crypto.splitSecret(crypto.exportIdentitySecret(crypto.generateIdentity()), 3, 2)[0]!;
    const parts = crypto.encodeShare(sh).split('.');
    const wrongIndex = String((Number(parts[2]) % 255) + 1);
    const tampered = [parts[0], parts[1], wrongIndex, parts[3], parts[4]].join('.');
    expect(() => crypto.decodeShare(tampered)).toThrow(CryptoError);
  });

  it('decode rejects an unrecognised format', () => {
    expect(() => crypto.decodeShare('not-a-share')).toThrow(CryptoError);
    expect(() => crypto.decodeShare('aidlog-share.9.1.AAAA.xxxx')).toThrow(CryptoError); // bad version
  });
});

// ---------------------------------------------------------------------------
// Raw-key identity wrapping (no Argon2) — passkey / device-transfer path
// ---------------------------------------------------------------------------

describe('raw-key identity wrapping (wrapIdentityWithKey / unwrapIdentityWithKey)', () => {
  /** A deterministic 32-byte high-entropy stand-in for a PRF / transfer key. */
  function rawKey(seed: number): Uint8Array {
    const k = new Uint8Array(32);
    for (let i = 0; i < 32; i++) k[i] = (seed * 31 + i * 7) & 0xff;
    return k;
  }

  it('wrap then unwrap recovers a WORKING identity (sign/verify + seal/open)', () => {
    const id = crypto.generateIdentity();
    const key = rawKey(1);
    const wrapped = crypto.wrapIdentityWithKey(id, key);

    expect(wrapped.alg).toBe('xchacha20poly1305-ietf');

    const restored = crypto.unwrapIdentityWithKey(wrapped, key);
    expect(restored.box.secretKey).toEqual(id.box.secretKey);
    expect(restored.sign.secretKey).toEqual(id.sign.secretKey);
    expect(restored.box.publicKey).toEqual(id.box.publicKey);
    expect(restored.sign.publicKey).toEqual(id.sign.publicKey);

    // Functional check: the restored identity can sign+verify ...
    const msg = crypto.utf8('hello device');
    const sig = crypto.sign(msg, restored.sign.secretKey);
    expect(crypto.verify(sig, msg, id.sign.publicKey)).toBe(true);

    // ... and open a sealed DEK addressed to its box public key.
    const dek = crypto.randomDek();
    const sealed = crypto.sealDek(dek, id.box.publicKey);
    expect(crypto.openSealedDek(sealed, restored.box)).toEqual(dek);
  });

  it('unwrap with the WRONG key throws DecryptionError', () => {
    const id = crypto.generateIdentity();
    const wrapped = crypto.wrapIdentityWithKey(id, rawKey(2));
    expect(() => crypto.unwrapIdentityWithKey(wrapped, rawKey(3))).toThrow(DecryptionError);
  });

  it('rejects a non-32-byte key on both wrap and unwrap', () => {
    const id = crypto.generateIdentity();
    expect(() => crypto.wrapIdentityWithKey(id, new Uint8Array(16))).toThrow(CryptoError);
    const wrapped = crypto.wrapIdentityWithKey(id, rawKey(4));
    expect(() => crypto.unwrapIdentityWithKey(wrapped, new Uint8Array(31))).toThrow(CryptoError);
  });

  it('marks a key-wrap with the passthrough-KDF sentinel (distinct from a password wrap)', async () => {
    const id = crypto.generateIdentity();
    const keyWrapped = crypto.wrapIdentityWithKey(id, rawKey(5));
    // Passthrough sentinel: empty salt, zero limits.
    expect(keyWrapped.kdf.salt).toBe('');
    expect(keyWrapped.kdf.opsLimit).toBe(0);
    expect(keyWrapped.kdf.memLimit).toBe(0);

    // A password wrap is the opposite (real salt + positive limits).
    const pwWrapped = await crypto.wrapIdentity(id, 'a-real-password');
    expect(pwWrapped.kdf.salt).not.toBe('');
    expect(pwWrapped.kdf.opsLimit).toBeGreaterThan(0);
    expect(pwWrapped.kdf.memLimit).toBeGreaterThan(0);
  });

  it('does NOT confuse a key-wrapped blob with a password-wrapped one', async () => {
    const id = crypto.generateIdentity();

    // A password wrap fed to the raw-key unwrap path is refused (not a wrong-key
    // DecryptionError — a structural CryptoError about the KDF marker).
    const pwWrapped = await crypto.wrapIdentity(id, 'pw');
    expect(() => crypto.unwrapIdentityWithKey(pwWrapped, rawKey(6))).toThrow(CryptoError);
    expect(() => crypto.unwrapIdentityWithKey(pwWrapped, rawKey(6))).not.toThrow(DecryptionError);

    // A key wrap fed to the password unwrap path fails too (empty salt is not a
    // valid Argon2 salt length).
    const keyWrapped = crypto.wrapIdentityWithKey(id, rawKey(7));
    await expect(crypto.unwrapIdentity(keyWrapped, 'pw')).rejects.toBeInstanceOf(CryptoError);
  });
});
