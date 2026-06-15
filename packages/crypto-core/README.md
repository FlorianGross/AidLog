# @aidlog/crypto-core

The end-to-end encryption core for **Aidlog** — an open, self-hosted,
zero-knowledge documentation app for emergency-medical deployments.

This is the **only** package permitted to import a cryptographic primitive
library (`libsodium-wrappers-sumo`). `api` and `web` consume this module; they
must never import crypto primitives directly. The crypto-lint CI gate enforces
that boundary.

It implements envelope encryption (per-record data keys sealed to recipients),
password-protected identities, detached signatures, and BLAKE2b hash-chaining,
exactly as specified in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) and
typed by [`@aidlog/contracts`](../contracts/src/index.ts).

## Threat model (3 bullets)

- **The server is a blind sync store.** It holds only ciphertext + routing
  metadata (ids, seq, hashes, signatures). Anyone who steals the database or
  compromises the server sees no plaintext, no DEKs, no passwords, and no
  unwrapped secret keys. Decryption happens only on the client.
- **Only the org password unlocks org data.** Org/helper secret keys are stored
  only as Argon2id-wrapped ciphertext. Losing the org password loses the data
  (an optional separate recovery wrapper is supported). Helpers can read their
  own entries until shift close (soft revocation removes the helper key-wrapper).
- **Integrity is publicly verifiable, tampering is detectable.** Every record is
  Ed25519-signed and BLAKE2b hash-chained to its predecessor. Anyone can verify
  the whole chain offline; flipping a single byte breaks `verifyRecord`. What it
  cannot undo: data a helper already viewed during an open shift (inherent to
  client-side decryption — documented honestly).

## Primitive choices

| Concern                    | Primitive                                    | libsodium call                                         |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| Password → key (KDF)       | Argon2id (`ALG_ARGON2ID13`), MODERATE limits | `crypto_pwhash`                                        |
| Payload / DEK AEAD         | XChaCha20-Poly1305 IETF                      | `crypto_aead_xchacha20poly1305_ietf_*`                 |
| Blob AEAD (chunked, large) | secretstream XChaCha20-Poly1305              | `crypto_secretstream_xchacha20poly1305_*`              |
| DEK wrapping to recipient  | X25519 anonymous sealed box                  | `crypto_box_seal` / `crypto_box_seal_open`             |
| Secret keys at rest        | XChaCha20-Poly1305 under the Argon2id key    | `crypto_aead_xchacha20poly1305_ietf_*`                 |
| Signatures                 | Ed25519 (detached)                           | `crypto_sign_detached` / `crypto_sign_verify_detached` |
| Hashing / chaining         | BLAKE2b-256                                  | `crypto_generichash` (32 bytes)                        |
| Identity (box)             | X25519 keypair                               | `crypto_box_keypair`                                   |
| Identity (sign)            | Ed25519 keypair                              | `crypto_sign_keypair`                                  |

All binary values that cross the wire are standard padded base64
(`base64_variants.ORIGINAL`).

### Canonicalization

`canonicalize(record)` produces deterministic, platform-independent UTF-8 bytes:
object keys are recursively sorted, `undefined`-valued properties omitted,
numbers serialised via ECMAScript Number-to-String, strings via RFC-8259
escaping. It does **not** rely on `JSON.stringify` key ordering. Signatures
depend on this stability — see the doc comment in `src/index.ts`.

### `authorKeyId` convention (CONTRACT-NOTE)

`PublicIdentity.keyId === base64(signPublicKey)`. A record carries only
`authorKeyId`, so `verifyRecord` base64-decodes it back into the Ed25519 signing
public key. If the contracts owner later switches `keyId` to a _hash_, pass the
signing public key explicitly via the optional 3rd argument
`verifyRecord(record, expectedPrevHash, signPublicKey)`. See the file-header
CONTRACT-NOTE in `src/index.ts` for the full rationale.

## Example

```ts
import { crypto } from '@aidlog/crypto-core';

await crypto.ready(); // once, before anything else

// --- Setup: org + helper identities -----------------------------------
const org = crypto.generateIdentity();
const helper = crypto.generateIdentity();
const orgPub = crypto.toPublicIdentity(org);
const helperPub = crypto.toPublicIdentity(helper);

// --- Helper encrypts a record for org + helper ------------------------
const dek = crypto.randomDek();
const payload = crypto.utf8(JSON.stringify({ patient: 'A', bp: '120/80' }));
const ct = crypto.encryptPayload(payload, dek);

const sealedKeys = crypto.buildSealedKeys(dek, [
  { type: 'org', identity: orgPub }, // org can always read
  { type: 'helper', identity: helperPub }, // helper reads until shift close
]);
// `ct` + `sealedKeys` go into a ProtocolRecord, which is then signed:
//   const hash = crypto.computeRecordHash(signableRecord);
//   const signature = crypto.sign(hash, helper.sign.secretKey);

// --- Org decrypts it --------------------------------------------------
const orgSealed = sealedKeys.find((k) => k.recipientType === 'org')!;
const orgDek = crypto.openSealedDek(crypto.fromBase64(orgSealed.ciphertext), org.box);
const recovered = crypto.decryptPayload(ct, orgDek);
console.log(JSON.parse(crypto.fromUtf8(recovered))); // { patient: 'A', bp: '120/80' }
```

## Memory hygiene

Derived symmetric keys and unwrapped intermediate plaintext are `memzero`'d once
their lifetime is fully under our control. We **cannot** zero secret keys we
_return_ to the caller (the caller owns their lifetime) nor immutable JS strings
such as passwords — both are inherent limits of a managed runtime and are
documented at the top of `src/index.ts`.

## Errors

- `DecryptionError` — AEAD/sealed-box authentication failed. For
  `unwrapIdentity` this almost always means a **wrong password**.
- `NotReadyError` — a primitive was used before `await crypto.ready()`.
- `CryptoError` — base class; other invariant violations (bad salt length, etc.).

Error messages never contain secret material.

## Scripts

```bash
pnpm --filter @aidlog/crypto-core test       # vitest
pnpm --filter @aidlog/crypto-core typecheck  # tsc --noEmit
pnpm --filter @aidlog/crypto-core build      # tsc → dist/
```
