# Threat Model

> **Status:** Draft for an _unaudited_ scaffold. This document describes the
> intended security posture of Aidlog as designed in
> [`ARCHITECTURE.md`](./ARCHITECTURE.md). It is **not** a statement that the
> implementation has been independently verified. Before Aidlog processes real
> patient data, both the cryptography and the GDPR posture **must** pass an
> independent security and data-protection review (see §9).

> **Kurzfassung (DE):** Dieses Dokument beschreibt das Bedrohungsmodell von
> Aidlog: welche Werte geschützt werden, gegen welche Angreifer, mit welchen
> Maßnahmen — und welche Restrisiken bleiben. Zentrale ehrliche Grenzen: Verlust
> des Organisations-Passworts macht Daten unwiederbringlich, **sofern nicht
> vorher eine Shamir-Wiederherstellung eingerichtet wurde** — diese verlagert
> das Vertrauen aber auf die Anteils-Treuhänder (T von N können alles lesen); die
> "Soft Revocation" am Schichtende kann bereits Gesehenes/Kopiertes nicht
> löschen; ein kompromittierter Client/Browser hebt die
> Ende-zu-Ende-Verschlüsselung auf; Metadaten (Zeitpunkte, Größen, Urheberschaft,
> Admin-/Audit-Ereignisse, Wiederherstellungs-Konfiguration, Push-Endpunkte) sind
> für den Server sichtbar; Push und Auswertung tragen **nie** Patientendaten;
> dieses Gerüst ist **nicht** unabhängig auditiert.

---

## 1. Scope and method

This threat model covers the Aidlog system as described in `ARCHITECTURE.md` and
typed in [`@aidlog/contracts`](../packages/contracts/src/index.ts): a SvelteKit
PWA client, a Fastify "blind sync" API, Postgres for records, MinIO for
encrypted blobs, fronted by Caddy (TLS). Cryptography is performed **only** on
the client by [`crypto-core`](../packages/crypto-core/src/interface.ts).

Pinned primitives (see `ALGORITHMS` in contracts):

| Purpose                 | Primitive                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Payload + blob AEAD     | XChaCha20-Poly1305 (IETF), secretstream for blobs                                     |
| DEK wrapping (envelope) | `crypto_box_seal` — X25519 sealed box                                                 |
| Password → key (KDF)    | Argon2id (`crypto_pwhash`)                                                            |
| Secret key at rest      | XChaCha20-Poly1305 under the Argon2id key                                             |
| Signatures              | Ed25519                                                                               |
| Hashing / chaining      | BLAKE2b-256 (`crypto_generichash`)                                                    |
| Org-key recovery        | Shamir secret sharing (T-of-N) over the org secret, client-side                       |
| Passkey unlock          | WebAuthn + PRF extension → 32-byte key → AEAD wrap of the identity                    |
| Device transfer         | one-time PIN (BLAKE2b-keyed AEAD) over the _password-wrapped_ secret                  |
| Push authentication     | VAPID (web-push); RFC 8291 message encryption by the browser — **not** content crypto |

We use a STRIDE-informed analysis (§7) plus an adversary-by-adversary walk (§5),
each with an explicit **residual risk**.

---

## 2. Assets

| #   | Asset                                                                                                               | Sensitivity                                                                  | Where it lives                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | **Patient health data** (protocol payloads)                                                                         | GDPR Art. 9 special category                                                 | Ciphertext only on server (`EncryptedPayload`); plaintext only transiently in client memory                                                                                                                                          |
| A2  | **Attachments / images** (photos, scans, signatures)                                                                | Art. 9                                                                       | Ciphertext in MinIO (`EncryptedBlobRef` + secretstream); plaintext only in client memory                                                                                                                                             |
| A3  | **Identities & keys** — org X25519/Ed25519 secret keys, helper secret keys, per-record DEKs, org & helper passwords | Critical: compromise breaks confidentiality                                  | Org/helper _secret_ keys: only as Argon2id-wrapped ciphertext (`WrappedSecretKey`). DEKs: only sealed (`SealedKey`) or transient in client memory. Passwords: only in the user's head / client memory — **never** sent to the server |
| A4  | **Audit chain integrity** — append-only, Ed25519-signed, BLAKE2b hash-chained records                               | High: tampering must be detectable                                           | `ProtocolRecord.{prevHash,recordHash,signature,seq}` in Postgres                                                                                                                                                                     |
| A5  | **Availability** of records & blobs                                                                                 | High for legal/medical continuity                                            | Postgres + MinIO + operator backups                                                                                                                                                                                                  |
| A6  | **Metadata** — record timestamps, sequence numbers, deployment sizes, author key ids, blob sizes/types              | Lower but **not** zero (re-identification risk)                              | Plaintext routing fields on the server (see §4)                                                                                                                                                                                      |
| A7  | **Org-key recovery shares** (Shamir T-of-N) — each share is a fragment of the org _secret_                          | Critical: ≥ T shares reconstruct the org key (= read everything)             | Human trustees only (printed/exported). **Never** on the server: only non-secret metadata (T/N, trustee labels, `orgKeyCheck`) is stored (`RecoveryConfig`)                                                                          |
| A8  | **Passkey / PRF wrappers** — a passkey-derived 32-byte key wraps the identity secret for biometric/PIN unlock       | Critical (a second wrapper of A3)                                            | Ciphertext `prfWrappedSecret` in device IndexedDB; the PRF secret itself never leaves the authenticator and is zeroed after wrap/unwrap                                                                                              |
| A9  | **Multi-device transfer payload** — a PIN-encrypted bundle of the _password-wrapped_ secret + public identity/role  | High: a leaked code **and** PIN **and** account password together unlock     | QR/text code is ciphertext; PIN is out-of-band and one-time; the account password is still required to actually unwrap                                                                                                               |
| A10 | **Push subscriptions** — browser push endpoint + the browser's own RFC 8291 encryption keys + optional device label | Lower; operational metadata, but an _endpoint at a third-party push service_ | `push_subscriptions` in Postgres; payloads sent are content-free (see §4 / §5.8)                                                                                                                                                     |
| A11 | **Administrative audit log** — who/what/when of user-management, recovery-config and shift-close events             | Lower (no patient data) but reveals org structure & staffing actions         | `audit_log` in Postgres (plaintext administrative events)                                                                                                                                                                            |
| A12 | **Client-side org analytics** — admin/lead decrypts org-wide records to compute aggregates                          | Critical _transiently_: a full org decryption happens in the admin's browser | Plaintext + org secret in admin memory only during a run; export carries **only** whitelisted aggregates, never raw payloads (`analytics/types.ts`)                                                                                  |

---

## 3. Trust boundaries

```
 TB1  User device / browser  ┃  everything outside it
 TB2  Client (crypto-core)   ┃  network (TLS/Caddy)
 TB3  Network                ┃  server (api)
 TB4  api process            ┃  data stores (Postgres / MinIO)
 TB5  Org-password holder    ┃  helpers and the server operator
```

- **TB1** is the strongest and the most fragile boundary at once: all plaintext
  exists only inside it. A breach here (malware, malicious extension, XSS)
  defeats end-to-end encryption — see Adversary §5.3.
- **TB3** is crossed only by ciphertext + routing metadata. The server is
  _inside_ the threat model as a potential adversary (§5.1), not a trusted party.
- **TB5** is the confidentiality root: only the org-password holder can read
  archived data. Helpers can _write_ (seal to the org public key) and _read back
  their own entries until shift close_, but never hold an org secret.

---

## 4. What the server operator can and cannot see

This is the central claim of the design and is stated here without
embellishment.

**CANNOT see (confidentiality holds as long as TB1/TB3/TB5 hold):**

- Protocol payload plaintext (A1) — stored as `EncryptedPayload` ciphertext.
- Attachment/image plaintext (A2) — stored as secretstream ciphertext in MinIO.
- Org or helper **secret** keys (A3) — only `WrappedSecretKey` (Argon2id-wrapped)
  ciphertext is stored; the server cannot derive them without a password.
- Org or helper **passwords** — by design they never reach the server
  (`ARCHITECTURE.md` §7: challenge/response auth, no password transmitted).
- Per-record **DEKs** in usable form — only `crypto_box_seal` ciphertext sealed
  to recipient public keys.

**CAN see (metadata, A6 — this is an honest limitation, not a leak to be fixed
trivially):**

- Existence, count, and **sequence** of records per deployment (`seq`,
  `DeploymentSummary.recordCount`).
- **Timing**: client `createdAt` _and_ independent server receipt time — usable
  for activity-pattern / shift-pattern analysis.
- **Deployment sizes** and **blob sizes/media types** (`EncryptedBlobRef.size`,
  `mediaType`) — size side-channels can hint at content type.
- **Authorship**: which helper signing identity (`authorKeyId`) wrote which
  record, and the org/helper public identities.
- **Routing**: `deploymentId`, `orgId`, IP addresses, TLS SNI, session activity.
- Integrity facts: signatures and the hash chain (verifiable _without_
  decryption).
- **User & org administration**: roles, account status, invitations
  (existence/lifecycle, never the single-use code in clear), and the full
  **administrative audit log** (A11) — who invited/disabled whom, when a shift
  closed, when recovery was configured.
- **Recovery configuration** (A7) — the _fact_ that Shamir recovery is set up,
  the threshold/share count, trustee **labels**, and `orgKeyCheck`. **Never** a
  share or any secret fragment.
- **Push subscriptions** (A10) — push endpoints + the browser-published
  encryption keys + optional device labels, for the keyIds that subscribed.
- **Co-signature graph** — which keyIds were asked to counter-sign which record
  and the resulting decisions/signatures (the _content_ stays sealed to them).

**Still CANNOT see**, even with all of the above: any patient payload, any
recovery share, any passkey/PRF secret, the org/helper passwords, or the
analytics input/output (computed and kept entirely in the admin's browser).

> Consequence for DPIA: metadata alone can, in a small organisation, allow
> re-identification or behavioural inference (who was on shift, when, how busy).
> Treat A6 as personal data; minimise logging and retention (see TOM.md).

---

## 5. Adversaries, mitigations, residual risk

### 5.1 Compromised / curious server operator (honest-but-curious or malicious host)

- **Goal:** read patient data; or tamper with records.
- **Mitigation:** end-to-end encryption — the server only ever holds ciphertext
  - wrapped/sealed keys (§4). Append-only enforced by DB privileges + triggers
    (`ARCHITECTURE.md` §4); any tampering breaks signatures or the hash chain and
    is detectable on offline verification (`verifyRecord`).
- **Residual risk:** (a) **Metadata** (A6) is fully visible. (b) A malicious
  operator can **withhold or delete** records / refuse service — confidentiality
  holds but **availability and completeness are not guaranteed** by crypto; only
  chain-gap detection (`seq`/`prevHash`) reveals _missing_ records to a verifier
  who already holds an earlier chain state. (c) A malicious operator can serve
  **tampered client code** to the browser → see §5.3. This is the most important
  residual risk for a web-delivered E2E app.

### 5.2 Database / blob-store thief (stolen Postgres dump or MinIO bucket)

- **Goal:** read patient data from exfiltrated storage at rest.
- **Mitigation:** storage contains only ciphertext + wrapped keys. Without an
  org/helper password (Argon2id, never stored), the thief cannot derive keys.
- **Residual risk:** offline **password guessing** against `WrappedSecretKey` if
  the org password is weak — Argon2id raises cost but does not eliminate it.
  Metadata (A6) is exposed in the dump. Use strong org passwords and tune
  `opsLimit`/`memLimit` (KdfParams) to the deployment hardware.

### 5.3 Client / browser compromise (malware, malicious extension, XSS, supply-chain in served assets)

- **Goal:** capture plaintext or passwords at the only place they exist.
- **Mitigation:** strict CSP, no third-party trackers/analytics (privacy-lint
  gate), no `{@html}`/`dangerouslySetInnerHTML` (Semgrep rule), Subresource
  Integrity / pinned builds, PWA served same-origin over TLS. crypto-core is the
  sole crypto surface, reducing audit area.
- **Residual risk:** **fundamental and unmitigable by cryptography.** If the
  client is compromised, E2E is defeated for data handled on that device while
  compromised. A hostile _server_ delivering hostile JS (§5.1c) is a form of
  this. Mitigation is operational: code signing, reproducible builds,
  independent review of served bundles, and ultimately moving sensitive unlock
  to hardware (WebAuthn-PRF, tracked but not implemented).

### 5.4 Malicious / careless helper (insider with valid helper credentials)

- **Goal:** read or copy data beyond their need; exfiltrate during a shift.
- **Mitigation:** helpers seal to the **org public key** and can read **only
  their own entries**, and only **until shift close**, after which the
  helper-sealed `SealedKey` wrapper is deleted server-side (`ARCHITECTURE.md`
  §5) and the local cache is wiped.
- **Residual risk:** **soft revocation cannot erase what a helper already saw or
  copied** during the open shift (screenshots, photos of the screen, local
  copies). It removes _future_ decryption capability, not _past_ knowledge. This
  is inherent to client-side decryption. Operators must address insiders
  organisationally (need-to-know, training, device policy — see TOM.md).

### 5.5 Network attacker (passive eavesdropper or active MITM)

- **Goal:** read or alter data in transit; downgrade.
- **Mitigation:** TLS everywhere (Caddy, automatic certs). Even absent TLS,
  payloads are already E2E ciphertext and records are signed/hash-chained, so a
  network attacker cannot read content or forge accepted records (no signing
  key).
- **Residual risk:** TLS metadata (SNI, IPs, sizes, timing) is observable;
  traffic-analysis re-identification risk in small orgs. A MITM with a hostile
  CA could attempt to deliver tampered client code (→ §5.3); SRI/pinning helps.

### 5.6 Lost / stolen device (unlocked or extractable)

- **Goal:** read cached plaintext / keys from a field device.
- **Mitigation:** secret keys at rest are Argon2id-wrapped; DEK/plaintext caches
  are wiped on shift close; no secrets in `localStorage`/`sessionStorage`
  (privacy-lint gate). Offline-first PWA minimises but does not eliminate
  client-side persistence.
- **Residual risk:** a device **lost while a shift is open and unlocked** can
  expose currently-cached plaintext/DEKs. Mitigation is operational: device
  full-disk encryption, screen lock, short shift windows, remote wipe (MDM).

### 5.7 Lost org password

- **Goal:** (not an attacker — a continuity failure) recover data after the org
  password is forgotten/lost.
- **Mitigation:** **Shamir T-of-N org-key recovery is now implemented**
  (`$lib/recovery`, `crypto-core` split/combine, `RecoveryConfig`). The org
  secret is split into N human-held shares; any T reconstruct it **client-side**
  and re-wrap it under a **new** org password (PUT `ROUTES.orgKeyset`). A
  reconstructed key is verified against `orgKeyCheck` before the re-wrap, so an
  insufficient/foreign share set fails closed. `OrgKeyset.recoveryWrappers` (a
  separate backup-key wrapper) remains available too.
- **Residual risk:** Recovery only works **if it was configured beforehand**; an
  org that never set up shares (or destroyed/lost ≥ N−T+1 of them) still has
  **permanent data loss** — the zero-knowledge trade-off is unchanged. Recovery
  also **shifts the trust model**: see §5.9 — anyone who gathers T shares can
  read everything, so share custody is now a first-class control. A deliberately
  destroyed org key (and all shares) remains a valid **crypto-shredding** erasure
  mechanism (see Betroffenenrechte.md).

### 5.8 Push service / push subscription exposure

- **Goal:** learn patient/record content via the notification channel, or via a
  stolen `push_subscriptions` table / a curious third-party push service.
- **Mitigation:** push is **content-free by construction**. The API builds a
  fixed `{ title, body, url }` from generic strings and **never** threads record
  or patient data through it (`apps/api/src/push.ts`, contract comment on
  `PushSubscriptionDTO`). VAPID keys only _authenticate_ the app server to the
  push service; they cannot decrypt Aidlog content. Push lives **outside** the
  content-crypto boundary by design. Dead endpoints (404/410) are pruned.
- **Residual risk:** the push service (and anyone reading the subscription rows)
  learns **metadata**: that a given keyId’s device is reachable and _when_ it is
  pinged (e.g. "a co-signature is pending"). In a small org this is a timing/
  activity side-channel (A10). Push is **optional** (disabled unless all three
  VAPID values are set) — orgs with a stricter posture can leave it off.

### 5.9 Recovery-share holder / share theft (Shamir trustees)

- **Goal:** reconstruct the org key from shares without authorisation.
- **Mitigation:** shares are split with threshold **T**; **fewer than T reveal
  nothing** (information-theoretic property of Shamir). Shares are distributed to
  named human trustees and never touch the server (§4). The UI surfaces the
  T-of-N semantics so operators choose a threshold that resists single-trustee
  compromise.
- **Residual risk:** **collusion of T trustees (or theft of T shares) fully
  breaks confidentiality** — they reconstruct the org secret and can read all
  archived data. This is inherent to escrowed recovery and is the price of
  surviving a lost org password (§5.7). Mitigate organisationally: choose T ≥ 3,
  store shares separately (sealed envelopes/safes/different people), log the
  configuration (audit, A11), and re-issue shares + rotate the org password after
  any suspected exposure or trustee offboarding.

### 5.10 Stolen device with a registered passkey (WebAuthn-PRF unlock)

- **Goal:** unlock the identity on a lost/stolen device using its passkey.
- **Mitigation:** the PRF secret is bound to the platform authenticator and
  gated by **user verification** (biometric/PIN, `userVerification: 'required'`);
  the identity secret is stored only as `prfWrappedSecret` ciphertext and the
  32-byte PRF secret is `fill(0)`-ed immediately after each wrap/unwrap. A passkey
  cannot be exported off the device.
- **Residual risk:** if the device is unlocked **and** the local OS user
  verification is satisfiable by the thief (shoulder-surfed PIN, coerced
  biometric), the passkey unlocks the identity — equivalent to §5.6 for an
  unlocked device. Passkey unlock also **widens** the unlock surface from "one
  password" to "password **or** any registered passkey": a passkey is as strong
  as the device’s user-verification. Mitigate with auto-lock/auto-wipe
  (`$lib/security`), FDE, and removing passkeys on offboarding (`deletePasskey`).

### 5.11 Intercepted multi-device transfer (QR/code + PIN)

- **Goal:** adopt the identity on an attacker device from a captured transfer
  code.
- **Mitigation:** **two secrets gate adoption** — the one-time **PIN**
  (out-of-band, BLAKE2b-keyed AEAD over the payload) decrypts the bundle, and the
  **account password** is still required to unwrap the password-wrapped secret
  inside it. The code itself is pure ciphertext; PIN and password are memory-only
  and zeroed. The PIN is single-use and short-lived (documented choice not to run
  Argon2 on it, since the underlying secret stays password-protected).
- **Residual risk:** an attacker who captures **the code, the PIN, and the
  account password** can adopt the identity — but that is three independent
  secrets across two out-of-band channels. A captured code + PIN **without** the
  password only yields more ciphertext (the inner `wrappedSecret`), enabling at
  most an offline guess against the account password (Argon2-hardened). Treat the
  PIN as spoken/shown separately and never log it.

### 5.12 Malicious admin/lead via client-side analytics

- **Goal:** an authorised admin/lead exfiltrates org-wide patient data under the
  cover of "analytics".
- **Mitigation:** analytics run **client-side** for a holder of the org key, who
  _already_ can read everything by design — analytics grant no new capability.
  The aggregation reads an explicit **code-level whitelist** of non-identifying
  categorical/numeric fields; free-text and direct identifiers (names, location,
  notes, signatures, photos) are **never** read into an aggregate, and the export
  contains only aggregates (`analytics/types.ts`). Decrypted payloads and the org
  secret are memory-only for the run and zeroed afterwards.
- **Residual risk:** the org key necessarily lets its holder read raw records
  outside the analytics path, so analytics do not _create_ an exfiltration risk —
  they bound the _export_. A malicious key-holder remains an organisational
  (need-to-know, vetting, audit) problem, not a cryptographic one. Verify the
  whitelist stays free of identifiers when the schema changes (it is asserted in
  `analytics/aggregate.test.ts`).

### 5.13 Archival notarization / Merkle anchoring metadata

- **Goal:** learn content from, or forge, the archival anchor; or use the anchor
  to re-identify.
- **Mitigation:** the anchor is a **Merkle root over public `recordHash`es only**
  (ordered by `(deploymentId, seq)`), built with the same BLAKE2b primitive and
  **without decrypting anything** (`apps/api/src/anchor.ts`,
  `$lib/archive/merkle.ts`). The root is HMAC-signed by a dedicated **non-content**
  server secret (allow-pragma’d), optionally RFC 3161 timestamped. A client can
  **independently recompute** the root from the public sync metadata, so the
  server cannot forge a root for records it does not hold, and later tampering
  changes the recomputed root.
- **Residual risk:** the anchor **confirms existence/ordering/count** of records
  and their timestamps — i.e. it _attests to_ the metadata of A6, it does not add
  new content exposure. It does **not** by itself prove _completeness_ against a
  host that withheld records before anchoring (§5.1). The HMAC key protects the
  root signature, not confidentiality; treat it as an integrity secret (rotate on
  exposure). In a small org the anchored counts/timestamps remain a
  re-identification side-channel like the rest of A6.

---

## 6. Cross-cutting honest limitations

1. **Org password loss = permanent data loss _unless_ Shamir recovery was
   configured beforehand.** Recovery shifts trust to the share-holders. §5.7/§5.9.
2. **Soft revocation ≠ erasure of past knowledge.** §5.4, `ARCHITECTURE.md` §5.
3. **Client/browser compromise defeats E2E.** §5.3.
4. **Metadata (timing, sizes, authorship, routing, admin/audit events, recovery
   config, push endpoints, cosign graph) is visible to the server.** §4 / A6,
   A7, A10, A11.
5. **This scaffold is not independently audited.** §9.
6. **Availability/completeness are not cryptographically guaranteed** against a
   malicious host (withholding/deletion is detectable only as chain gaps). §5.1.
7. **Recovery is escrow:** T colluding/compromised trustees read everything.
   §5.9.
8. **Passkey unlock widens the unlock surface** to the device’s user
   verification, and **multi-device transfer** adds an out-of-band code+PIN
   channel — both are only as strong as their operational handling. §5.10/§5.11.
9. **Push and analytics never carry patient data**, but push leaks _timing_
   metadata to a third-party push service (A10). §5.8.

---

## 7. STRIDE mapping

| STRIDE                     | Threat in Aidlog                                     | Primary control                                                                                                               | Residual                                                                                |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **S**poofing               | Fake helper/org or impersonated author               | Ed25519 challenge/response auth (PoP of signing key, `ARCHITECTURE.md` §7); `authorKeyId` binds records to a signing identity | Stolen helper key until rotation; no key revocation list yet                            |
| **T**ampering              | Alter/insert/reorder records                         | BLAKE2b-256 hash chain + Ed25519 signatures + append-only DB triggers; `verifyRecord`                                         | Malicious host can delete (detectable as gap), not silently alter                       |
| **R**epudiation            | Author denies writing a record                       | Per-record Ed25519 signature over `recordHash`; independent server receipt time                                               | Shared device / shared password weakens attribution                                     |
| **I**nformation disclosure | Read patient data                                    | E2E AEAD + sealed DEKs; nothing readable server-side (§4)                                                                     | Metadata (A6); client compromise (§5.3); offline guessing (§5.2)                        |
| **D**enial of service      | Block documentation or reads                         | TLS, append-only sync, operator infra (backups, rate limits)                                                                  | Malicious/failed host; no built-in HA — operator responsibility                         |
| **E**levation of privilege | Helper gains org-read / org gains another org's data | Key hierarchy: org-read needs org secret (org password); per-org `orgId` scoping; role in `AuthSession`                       | Server-side authz bugs (must be tested); cross-org isolation is code-enforced, audit it |

---

## 8. "Before production" hardening checklist

> The full, concrete go-live gate now lives in
> [`docs/PRE_PRODUCTION_CHECKLIST.md`](./PRE_PRODUCTION_CHECKLIST.md) (German).
> This section keeps the threat-model-anchored essentials.

- [ ] **Independent cryptographic review** of `crypto-core` (primitive usage,
      nonce handling, KDF params, sealed-box and secretstream usage, **Shamir
      split/combine**, **passkey/PRF wrapping**, **transfer PIN derivation**).
- [ ] **Independent data-protection review / DPIA sign-off** (see
      `docs/datenschutz/DSFA-Vorlage.md`).
- [ ] **Org recovery drill**: configure Shamir T-of-N, distribute shares to
      trustees, then **actually reconstruct** from T shares and re-wrap under a
      new org password in a test org (§5.7/§5.9). Choose T ≥ 3 and document share
      custody + offboarding (re-issue on trustee change).
- [ ] **Push posture decision**: leave VAPID unset to disable push, or set it and
      confirm payloads stay content-free (§5.8). Document the push service as a
      processor (see VVT/TOM).
- [ ] **Passkey/transfer policy**: decide whether passkey unlock and device
      transfer are permitted, and pair them with auto-lock/auto-wipe + FDE
      (§5.10/§5.11).
- [ ] **Analytics whitelist review**: confirm the categorical/vital whitelist in
      `analytics/types.ts` contains no identifiers after any schema change
      (§5.12).
- [ ] **Argon2id parameters** tuned to deployment hardware and re-benchmarked
      (`opsLimit`/`memLimit` in `KdfParams`); enforce a strong org-password
      policy.
- [ ] **CSP + Subresource Integrity + reproducible builds**; verify the served
      client bundle matches a reviewed build (mitigates §5.1c/§5.3).
- [ ] **Server authz tests**: cross-org isolation, role enforcement, append-only
      triggers, blob-ticket scoping.
- [ ] **TLS hardening** (HSTS, modern ciphers) and certificate monitoring.
- [ ] **Logging review**: confirm pino redaction (`REDACT_PATHS`) and that no
      payload/PII/secret is logged (privacy-lint); minimise metadata retention.
- [ ] **Backup & restore** for Postgres + MinIO tested end-to-end; backups
      contain only ciphertext but still hold metadata — protect and retain per
      policy.
- [ ] **Device policy** for field devices: FDE, screen lock, MDM/remote wipe,
      short shift windows.
- [ ] **Key rotation / revocation** plan for compromised helper keys.
- [ ] **Dependency & supply-chain** posture: keep CI security gates green (see
      [`CI_AND_COMPLIANCE.md`](./CI_AND_COMPLIANCE.md)), review SBOM.
- [ ] **Incident response / breach-notification** runbook (Art. 33/34) — see
      `docs/COMPLIANCE.md`.

---

## 9. Audit status

This repository is a professionally-built **foundation, not a certified
product**. No independent security audit and no formal DPIA sign-off has been
performed on this scaffold. **Do not process real patient data** until the items
in §8 — at minimum the cryptographic review and the DPIA sign-off — are
complete and documented.
