# Security & Threat-Model Review

> **Status:** Internal review of an _unaudited_ scaffold. This document is a
> structured, file-grounded security review intended to (a) summarise the
> protected assets, trust boundaries, and adversaries; (b) state — honestly — the
> residual risk that survives each mitigation; and (c) hand an independent
> crypto/pentest auditor a concrete checklist. It complements, and does not
> replace, [`THREAT_MODEL.md`](./THREAT_MODEL.md) (the design-level threat model)
> and [`ARCHITECTURE.md`](./ARCHITECTURE.md) (the cryptographic contract).
>
> **This is not an attestation.** No independent cryptographic audit and no DPIA
> sign-off has been performed. **Do not process real GDPR Art. 9 patient data**
> until the review checklist in §5 — at minimum the crypto review and the DPIA —
> is complete. See §6.

> **Kurzfassung (DE):** Aidlog ist eine zero-knowledge-Dokumentations-App für
> Gesundheitsdaten (Art. 9 DSGVO). Der Server sieht nur Chiffretext und
> Metadaten. Diese Prüfung fasst Werte, Vertrauensgrenzen und Angreifer zusammen,
> benennt **ehrlich** die Restrisiken (Verlust des Org-Passworts = Datenverlust,
> sofern keine Shamir-Wiederherstellung eingerichtet wurde; entsperrtes Gerät und
> kompromittierter Client heben E2E auf; Metadaten/Timing/IP sind serverseitig
> sichtbar; Supervisor-/Lead-Zugriff erweitert den Lesekreis) und liefert eine
> Prüf-Checkliste für ein unabhängiges Audit. Dieses Gerüst ist **nicht** auditiert.

---

## 1. Scope of this review

| Component            | Path                                                                                                               | What it does                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Crypto core          | [`packages/crypto-core/src`](../packages/crypto-core/src)                                                          | The **only** module allowed to touch crypto primitives (libsodium) |
| Wire/algorithm types | `packages/contracts/src`                                                                                           | Pinned algorithm IDs, envelope shapes (`ALGORITHMS`, `KdfParams`)  |
| Blind-sync API       | `apps/api/src`                                                                                                     | Stores ciphertext + routing metadata; PoP auth; append-only DB     |
| Web client (PWA)     | `apps/web/src`                                                                                                     | All plaintext + crypto happen here, on-device                      |
| Self-host infra      | `infra/`                                                                                                           | Caddy (TLS), Postgres, MinIO, docker-compose                       |
| CI security gates    | [`scripts/crypto-lint.mjs`](../scripts/crypto-lint.mjs), [`scripts/privacy-lint.mjs`](../scripts/privacy-lint.mjs) | Enforce the crypto boundary and PII/secret-leak hygiene            |

Pinned primitives (from `crypto-core/src/interface.ts` and `ALGORITHMS` in
contracts): XChaCha20-Poly1305 (payload/blob AEAD, secretstream for blobs),
`crypto_box_seal` / X25519 (DEK wrapping), Argon2id (`crypto_pwhash`, password →
key), Ed25519 (signatures), BLAKE2b-256 (`crypto_generichash`, hashing/chaining),
Shamir T-of-N over the org secret (client-side recovery).

---

## 2. Assets

| #   | Asset                                                                    | Why it matters                     | Where it lives                                                                                      |
| --- | ------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| A1  | **Patient health data** (protocol payloads)                              | GDPR Art. 9 special category       | Ciphertext on server; plaintext only transiently in client memory                                   |
| A2  | **Attachments / images** (photos, scans, signatures)                     | Art. 9                             | secretstream ciphertext in MinIO; plaintext only in client memory                                   |
| A3  | **Org / helper secret keys + passwords + per-record DEKs**               | Compromise breaks confidentiality  | Secret keys only as Argon2id-`WrappedSecretKey`; DEKs only sealed; passwords never leave the device |
| A4  | **Audit-chain integrity** — Ed25519-signed, BLAKE2b hash-chained records | Tampering must be detectable       | `ProtocolRecord.{prevHash,recordHash,signature,seq}` in Postgres                                    |
| A5  | **Availability** of records & blobs                                      | Legal/medical continuity           | Postgres + MinIO + operator backups                                                                 |
| A6  | **Metadata** — timestamps, seq, sizes, author key ids, IP/SNI            | Re-identification risk (not zero)  | Plaintext routing fields on the server                                                              |
| A7  | **Org-key recovery shares** (Shamir T-of-N)                              | ≥ T shares reconstruct the org key | Human trustees only; never on the server (only T/N + labels + `orgKeyCheck`)                        |
| A8  | **Administrative audit log**                                             | Reveals org structure & staffing   | `audit_log` in Postgres (plaintext admin events)                                                    |

(Condensed from `THREAT_MODEL.md` §2, which additionally enumerates passkey/PRF
wrappers, the multi-device transfer payload, push subscriptions, and client-side
analytics state.)

---

## 3. Trust boundaries & adversaries — mitigation vs. **residual risk**

The central claim: a **compromised or curious server operator** sees only
ciphertext + metadata. Everything below is honest about where that claim stops.

### 3.1 Malicious / compromised server operator (honest-but-curious or hostile host)

- **Mitigation:** end-to-end encryption — the server holds only ciphertext and
  wrapped/sealed keys. Append-only is enforced by DB privileges/triggers; any
  tampering breaks the Ed25519 signature or the BLAKE2b hash chain and is
  detectable on offline `verifyRecord`.
- **Residual risk:** **metadata (A6) is fully visible** — timestamps, record
  counts/sequence, deployment/blob sizes, author key ids, IP/SNI. The operator
  can **withhold or delete** records (confidentiality holds, but
  **availability/completeness are not cryptographically guaranteed** — only
  chain-gap detection reveals missing records to a verifier who already holds an
  earlier state). **Most important:** a hostile server can **serve tampered client
  JS** to the browser, which defeats E2E (see 3.2). This is the headline residual
  risk of any web-delivered E2E app.

### 3.2 Network attacker / client (browser) compromise

- **Mitigation:** TLS everywhere (Caddy). Strict CSP, no third-party
  trackers/analytics (enforced by `privacy-lint.mjs`), no `{@html}` /
  `dangerouslySetInnerHTML`, same-origin PWA over TLS. `crypto-core` is the sole
  crypto surface (small audit area, enforced by `crypto-lint.mjs`).
- **Residual risk:** **client/browser compromise is unmitigable by cryptography**
  — malware, a malicious extension, XSS, or hostile served JS captures plaintext
  and passwords at the one place they exist. TLS metadata (SNI, IPs, sizes,
  timing) remains observable. Operational mitigations only: reproducible builds,
  SRI/pinning, review of the served bundle.

### 3.3 Lost / stolen device — **unlocked** vs. **locked**

- **Mitigation:** secret keys at rest are Argon2id-wrapped (`WrappedSecretKey`);
  DEK/plaintext caches are wiped on shift close; **no secrets in
  `localStorage`/`sessionStorage`** (enforced by `privacy-lint.mjs`); idle
  auto-lock (`$lib/security`).
- **Residual risk:** a device **lost while a shift is open and unlocked** exposes
  currently-cached plaintext/DEKs — auto-lock narrows but does not close this
  window. A **locked** device exposes only ciphertext, reducing the attacker to
  an **offline Argon2id-hardened password guess** against `WrappedSecretKey`
  (strong only if the password is strong and KDF params are tuned). Operational
  mitigations: FDE, screen lock, short shift windows, MDM/remote wipe.

### 3.4 Malicious insider helper

- **Mitigation:** helpers seal DEKs to the **org public key** and can read **only
  their own entries**, and only **until shift close**, after which the
  helper-sealed `SealedKey` wrapper is deleted server-side and the local cache is
  wiped (**soft revocation / crypto-shredding** of forward read access).
- **Residual risk:** soft revocation **cannot erase what a helper already saw or
  copied** (screenshots, photos of the screen, local copies) during the open
  shift — it removes _future_ decryption, not _past_ knowledge. Inherent to
  client-side decryption; address insiders organisationally (need-to-know,
  device policy).

### 3.5 Lead / admin over-reach (supervisor sealing & analytics)

- **Mitigation:** the org-key holder can _already_ read everything by design;
  client-side analytics grant no new capability and read an explicit **code-level
  whitelist** of non-identifying fields, exporting only aggregates
  (`analytics/types.ts`). Org secret + plaintext are memory-only for the run.
- **Residual risk:** **supervisor-sealing widens the read circle** — every record
  whose DEK is additionally sealed to a lead/org key is readable by that
  principal, which is exactly the point but enlarges the set of humans who can
  read patient data. A malicious key-holder is an **organisational** problem
  (vetting, audit, need-to-know), not a cryptographic one. Re-verify the
  analytics whitelist contains no identifiers after every schema change.

### 3.6 Backup theft / database-or-blob-store exfiltration

- **Mitigation:** storage holds only ciphertext + wrapped keys; without an
  org/helper password (Argon2id, never stored) the thief derives no keys.
- **Residual risk:** **offline password guessing** against `WrappedSecretKey` for
  weak org passwords (Argon2id raises cost, does not eliminate). Metadata (A6) is
  fully present in any dump. **Backups retain crypto-shredded key material until
  rotation:** a "shredded" (deleted) org key or helper-sealed wrapper still exists
  in older backups, so erasure-by-key-destruction is only complete once backups
  age out / are rotated.

### 3.7 Lost org password (continuity, not an attacker)

- **Mitigation:** Shamir **T-of-N** org-key recovery (client-side split/combine,
  verified against `orgKeyCheck` before re-wrap under a new org password).
- **Residual risk:** recovery works **only if configured beforehand** — otherwise
  **org-password loss = permanent data loss** (the zero-knowledge trade-off).
  Recovery also **shifts trust**: any party gathering **T shares** reconstructs
  the org secret and reads everything (escrow). Choose T ≥ 3; store shares
  separately; rotate after any suspected exposure or trustee offboarding.

### 3.8 Notification / CIRS-style anonymity caveats

- **Mitigation:** push is **content-free by construction** — a fixed
  `{title, body, url}` of generic strings; patient/record data is never threaded
  through it. VAPID only authenticates the app server; push is optional (off
  unless all three VAPID values are set).
- **Residual risk:** the push service (and anyone reading `push_subscriptions`)
  learns **timing metadata** — that a keyId's device is reachable and _when_ it
  is pinged. In a small org this is an activity side-channel. **Anonymity caveat:**
  any "anonymous"/CIRS-style report is only as anonymous as A6 allows — authorship
  key ids, timing, and sizes can re-identify a reporter in a small organisation.

---

## 4. Cross-cutting honest limitations (summary)

1. **Org-password loss = permanent data loss** unless Shamir recovery was set up
   first; recovery is **escrow** (T trustees read everything).
2. **Soft revocation ≠ erasure** of what was already seen/copied.
3. **Client/browser compromise defeats E2E**; a hostile server can deliver hostile JS.
4. **Metadata (timing, sizes, authorship, routing, admin/audit events, recovery
   config, push endpoints) is visible to the server.**
5. **Unlocked device** exposes decrypted data; a **locked** device only ciphertext.
6. **Supervisor/lead sealing widens read access**; analytics bound the _export_, not the _capability_.
7. **Backups retain crypto-shredded keys** until rotation/ageing-out.
8. **Availability/completeness are not cryptographically guaranteed** against a malicious host.
9. **This scaffold is not independently audited.**

---

## 5. Review checklist for an independent crypto / pentest auditor

A concrete, file-anchored checklist. Each item should be confirmed by reading the
named code and, where applicable, by an active test.

### 5.1 Key generation & storage

- [ ] `generateIdentity()` uses libsodium CSPRNG keygen (X25519 box + Ed25519
      sign); no `Math.random()` anywhere near keys (asserted by `crypto-lint.mjs`).
- [ ] Secret keys exist at rest **only** as `WrappedSecretKey` ciphertext; confirm
      no plaintext secret key is persisted to IndexedDB or web storage
      (`privacy-lint.mjs` storage rule).
- [ ] `wrapIdentityWithKey` / `unwrapIdentityWithKey` enforce the passthrough-KDF
      sentinel (`opsLimit==0 && memLimit==0 && salt==''`) so a raw-key (PRF /
      transfer) wrap can never be fed to the password unwrap path, and vice-versa.
- [ ] Secret-key buffers are zeroed after use (transfer key, PRF secret,
      identity export); verify `fill(0)` on the documented paths.

### 5.2 KDF parameters (Argon2id)

- [ ] `defaultKdfParams()` opsLimit/memLimit are tuned to deployment hardware and
      re-benchmarked; document the chosen interactive/moderate/sensitive profile.
- [ ] Salt is freshly generated per wrap (never reused); confirm in `wrapIdentity`.
- [ ] An org-password strength policy is enforced/encouraged client-side (the
      design relies on Argon2id _plus_ a strong password against offline guessing).

### 5.3 Nonce / IV handling

- [ ] Every `AeadCiphertext` carries a fresh random XChaCha20 nonce (24-byte space
      makes random nonces safe); confirm no fixed/derived nonce reuse across
      payloads under the same DEK.
- [ ] secretstream blob headers are per-blob; chunk sequencing is integrity-checked.
- [ ] `crypto_box_seal` (DEK wrapping) uses libsodium's ephemeral-sender sealing
      (no caller-supplied nonce) — confirm `sealDek`/`openSealedDek` are the only path.

### 5.4 Replay / proof-of-possession authentication

- [ ] Challenge/response (ARCHITECTURE.md §7): server-issued challenge is
      single-use, sufficiently random, and time-bounded; the signed challenge is
      bound to the session and cannot be replayed across sessions/orgs.
- [ ] Session tokens are short-lived; verify server-side expiry + rotation.
- [ ] No password material ever reaches the server on any auth path.

### 5.5 Integrity (signatures & hash chain)

- [ ] `canonicalize()` is deterministic (stable key ordering) so `recordHash` /
      signatures are reproducible; fuzz canonicalization for ordering/Unicode edge cases.
- [ ] `verifyRecord` checks BOTH the Ed25519 signature AND `recordHash` against
      content AND `prevHash` linkage; append-only DB triggers are present and tested.
- [ ] Cross-org isolation: `orgId` scoping is enforced server-side on every read/write.

### 5.6 CSP & web hardening

- [ ] Strict Content-Security-Policy (no `unsafe-inline`/`unsafe-eval` for
      scripts; same-origin connect-src); review Caddy/headers config.
- [ ] No `{@html}` / raw HTML injection (Semgrep rule); inputs rendered as text.
- [ ] Subresource Integrity / pinned reproducible build so a hostile server cannot
      silently swap the bundle (mitigates 3.1/3.2).
- [ ] TLS hardening: HSTS, modern ciphers, certificate monitoring.

### 5.7 Dependency / supply chain

- [ ] CI security gates green (crypto-lint, privacy-lint, plus the repo's
      semgrep/gitleaks/osv/trivy configs); review the SBOM.
- [ ] libsodium-wrappers(-sumo) version pinned; algorithm change requires an
      `ENVELOPE_VERSION` bump + migration (CODEOWNER-protected per SECURITY.md).

### 5.8 Rate-limiting & abuse

- [ ] Auth/redeem/recovery endpoints are rate-limited (brute-force on invitation
      codes and on the PoP challenge); confirm limits + lockout behaviour.
- [ ] Blob-ticket / upload scoping prevents cross-deployment or unbounded writes.

### 5.9 Secrets handling (operator)

- [ ] `SESSION_SECRET`, VAPID keys, the archival-anchor HMAC key, and DB/MinIO
      credentials are loaded from secret config (not committed); gitleaks gate green.
- [ ] Key rotation/revocation plan for compromised helper keys and operator secrets.

### 5.10 Logging hygiene

- [ ] pino `redact.paths` is configured and **non-empty** (enforced by
      `privacy-lint.mjs` `checkPinoRedaction`); covers password, secretKey, dek,
      payload, token, wrappedSecret, ciphertext, authorization/cookie headers.
- [ ] No `req.body` or sensitive identifier is logged anywhere in `apps/api`
      (privacy-lint log rules); metadata retention is minimised per `TOM.md`.

---

## 6. Current maturity

This repository is a professionally-built **foundation, not a certified
product.** No independent security audit and no formal DPIA sign-off has been
performed on this scaffold, consistent with the repo's own framing in
[`SECURITY.md`](../SECURITY.md), [`THREAT_MODEL.md`](./THREAT_MODEL.md) §9, and
[`PRE_PRODUCTION_CHECKLIST.md`](./PRE_PRODUCTION_CHECKLIST.md). **Do not process
real patient data** until at least the cryptographic review (§5.1–§5.5) and the
DPIA sign-off (`docs/datenschutz/DSFA-Vorlage.md`) are complete and documented.
