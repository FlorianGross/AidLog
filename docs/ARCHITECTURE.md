# Architecture

This document is the shared contract for everyone (humans and agents) working on
Aidlog. If you change a cross-cutting decision here, update
[`@aidlog/contracts`](../packages/contracts/src/index.ts) in the same change.

## 1. Principle: the server is a blind sync store

Encryption and decryption happen **only on the client**. The server stores
ciphertext blobs + minimal routing metadata (ids, sequence numbers, signatures,
hashes) and enforces append-only semantics. It can verify integrity (signatures,
hash chain) **without** being able to read content.

```
        ┌─────────── client (PWA) ───────────┐         ┌──── server (api) ────┐
form →  │ validate vs JSON-Schema             │         │                      │
        │ DEK = random()                      │         │  Postgres: records   │
        │ payload_ct = AEAD(form, DEK)        │  HTTPS  │   (append-only)      │
        │ blob_ct    = secretstream(img, DEK) │ ──────► │  MinIO: blob_ct      │
        │ sealedKeys = seal(DEK → org_pub,    │         │  verifies sig+chain  │
        │                   DEK → helper_pub) │         │  CANNOT decrypt      │
        │ sign(recordHash) with helper_sign   │         │                      │
        └─────────────────────────────────────┘         └──────────────────────┘
```

## 2. Key hierarchy

- **Organisation**: one X25519 box keypair + one Ed25519 sign keypair. The
  **public** keys ship to every client. The **secret** keys are encrypted under
  a key derived from the **org password** (Argon2id) and stored only as
  ciphertext (`OrgKeyset.wrappedSecret`). Losing the org password loses the data
  — documented prominently; an optional separate _backup-key wrapper_ is
  supported (`recoveryWrappers`) and Shamir/WebAuthn can be added later as
  additional wrappers without changing the data model.
- **Helper**: own X25519 + Ed25519 pairs, secret keys wrapped under the helper
  password.

## 3. Per-record envelope encryption

1. Client generates a random 32-byte **DEK**.
2. `payload` (canonical JSON of the form data) → XChaCha20-Poly1305 with the DEK.
3. Each attachment → secretstream (chunked AEAD) with the same DEK.
4. **DEK is sealed** with `crypto_box_seal` to the **org box public key** (always)
   and to the **helper box public key** (while the shift is open). `crypto_box_seal`
   needs only the recipient's public key, so a helper can write records the org
   can later read **without ever holding an org secret**.
5. The record is signed (Ed25519) and hash-chained (see §4).

Reading: org lead unlocks the org secret key with the org password → opens the
org-sealed DEK → decrypts payload + blobs.

## 4. Immutability & integrity

A _deployment_ (Einsatz) is an ordered chain of `ProtocolRecord`s.

- `recordHash = BLAKE2b-256( canonicalize(record_without_hash_and_sig) )`, where
  the canonical form includes `prevHash`, linking each record to its predecessor.
- `signature = Ed25519(recordHash)` by the author helper key.
- The server **rejects** any UPDATE/DELETE of existing records (enforced by DB
  privileges + triggers). Corrections append a new record with `supersedes` set.
- Anyone can later verify the whole chain offline: contiguous `seq`, matching
  `prevHash`, valid signatures.

## 5. Shift-end "soft revocation" (helper read-back)

Per product decision, helpers read their own entries until shift close. On
`POST /api/shifts/close` the server deletes the **helper-sealed** `SealedKey`
entries for that deployment, leaving only the org wrapper. The client also wipes
its local plaintext/DEK cache.

**Honest limitation:** this cannot retroactively erase data a helper already
viewed or copied during the open shift. It removes future decryption capability,
not past knowledge. This is inherent to client-side decryption and is documented
in the threat model.

## 6. Configurable protocol schema

`SchemaDefinition` carries a JSON-Schema (draft 2020-12) + optional uiSchema. The
web client renders the data-entry form from it and validates the payload
client-side _before_ encryption. New fields → new schema version; existing
records keep their `schemaVersion`, so old data stays renderable.

## 7. Transport & auth

- TLS everywhere (Caddy terminates with automatic certificates).
- Auth is **proof-of-possession** of the signing key: server issues a challenge,
  client signs it, server verifies against the registered public key and issues a
  short-lived session token. No password ever reaches the server.

## 8. Boundaries for agents

- **Only `crypto-core` may import a crypto primitive library.** `api` and `web`
  call `crypto-core`; they must never `import 'libsodium'`/`node:crypto` for
  content crypto. The crypto-lint CI gate enforces this.
- **The server must never receive plaintext payloads, DEKs, passwords, or
  unwrapped secret keys.** The privacy-lint gate scans for violations.
- All three packages depend on `@aidlog/contracts` for types; none re-declare the
  wire shapes.

## 9. Out of scope for the first scaffold (tracked for later)

- Multi-device key sync for a single helper.
- WebAuthn/YubiKey unlocking (architecture-ready via `recoveryWrappers`).
- Shamir-split org recovery.
- Full audit-log export & retention automation.
