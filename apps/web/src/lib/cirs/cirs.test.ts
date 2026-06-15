// @vitest-environment node
// crypto-core's libsodium rejects jsdom's cross-realm Uint8Array; run in node like
// crypto-core itself (same as record.test.ts).
//
// These tests pin the TWO anonymity-critical crypto properties of a CIRS report,
// exercising the SAME crypto-core primitives that $lib/cirs/submit.ts +
// decrypt.ts use, without importing the store-heavy app modules:
//   1. The submission carries ONLY { alg, nonce, ciphertext, sealedKey } — NO
//      author / submitter / signature field of any kind.
//   2. The org-sealed DEK round-trips: a report encrypted under a fresh DEK +
//      sealed to the ORG box public key ONLY decrypts back with the ORG SECRET
//      key (the QM path), and NOT with any other identity.
import { describe, it, expect, beforeAll } from 'vitest';
import { crypto } from '@aidlog/crypto-core';
import { ALGORITHMS, type CirsSubmission } from '@aidlog/contracts';
import { stableStringify } from '$lib/crypto';

/** Mirror of submit.ts's anonymous build, parameterised on the org public key. */
function buildAnonymousSubmission(payload: unknown, orgBoxPublicKey: Uint8Array): CirsSubmission {
  const dek = crypto.randomDek();
  try {
    const aead = crypto.encryptPayload(crypto.utf8(stableStringify(payload)), dek);
    const sealed = crypto.sealDek(dek, orgBoxPublicKey);
    return {
      alg: ALGORITHMS.aead,
      nonce: crypto.toBase64(aead.nonce),
      ciphertext: crypto.toBase64(aead.ciphertext),
      sealedKey: crypto.toBase64(sealed),
    };
  } finally {
    dek.fill(0);
  }
}

describe('CIRS anonymous submission crypto', () => {
  beforeAll(async () => {
    await crypto.ready();
  });

  it('produces a submission with NO author/submitter/signature fields', () => {
    const org = crypto.generateIdentity();
    const sub = buildAnonymousSubmission({ ereignis: 'Beinahe-Verwechslung' }, org.box.publicKey);

    expect(Object.keys(sub).sort()).toEqual(['alg', 'ciphertext', 'nonce', 'sealedKey']);
    // Belt-and-braces: none of the attribution keys exist on the wire object.
    for (const forbidden of [
      'authorKeyId',
      'author',
      'submitterKeyId',
      'keyId',
      'signature',
      'recipientKeyId',
      'sealedKeys',
      'reporterId',
    ]) {
      expect(forbidden in sub).toBe(false);
    }
  });

  it('round-trips: org SECRET key opens the org-sealed DEK and decrypts the payload', () => {
    const org = crypto.generateIdentity();
    const payload = {
      ereignis: 'Materialfehler',
      kontext: 'Sanitätsdienst',
      vorschlag: 'Doppelkontrolle einführen',
    };
    const sub = buildAnonymousSubmission(payload, org.box.publicKey);

    // QM path: open the org-sealed DEK with the ORG secret box key, then decrypt.
    const dek = crypto.openSealedDek(crypto.fromBase64(sub.sealedKey), org.box);
    const plain = crypto.decryptPayload(
      {
        alg: sub.alg,
        nonce: crypto.fromBase64(sub.nonce),
        ciphertext: crypto.fromBase64(sub.ciphertext),
      },
      dek,
    );
    expect(JSON.parse(crypto.fromUtf8(plain))).toEqual(payload);
  });

  it('cannot be opened by any identity other than the org (sealed to org ONLY)', () => {
    const org = crypto.generateIdentity();
    const stranger = crypto.generateIdentity();
    const sub = buildAnonymousSubmission({ ereignis: 'x' }, org.box.publicKey);

    // crypto_box_seal to the org pubkey is undecryptable by a different box key.
    expect(() => crypto.openSealedDek(crypto.fromBase64(sub.sealedKey), stranger.box)).toThrow();
  });
});
