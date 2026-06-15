# Security Policy

> **Kurzfassung (DE):** Sicherheitslücken bitte **vertraulich** an
> `security@example.org` melden — nicht über öffentliche Issues. Aidlog
> verarbeitet besondere Kategorien personenbezogener Daten (Gesundheitsdaten,
> Art. 9 DSGVO); Krypto-Änderungen erfordern eine gesonderte Prüfung. Dieses
> Gerüst ist **nicht** unabhängig auditiert.

Aidlog is a self-hosted, zero-knowledge documentation app that processes
**GDPR Art. 9 special-category health data**. We take security reports
seriously and ask you to disclose responsibly.

> ⚠️ This repository is a professionally-built **foundation, not an audited
> product.** Independent security and data-protection review is required before
> processing real patient data (see [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)).

## Reporting a vulnerability

**Please report privately. Do not open a public issue, PR, or discussion for a
suspected vulnerability.**

- **Contact:** `security@example.org` _(placeholder — operators MUST replace
  this with a monitored security contact, ideally with a PGP key, before
  deployment)._
- Encrypt sensitive details if a PGP key is published.
- Include: affected component/version or commit, a description, reproduction
  steps or PoC, impact assessment, and any suggested remediation.

### What to expect

- **Acknowledgement** within a few business days.
- A **triage** assessment with severity and an initial remediation plan.
- **Coordinated disclosure:** we will agree a disclosure timeline with you and
  credit reporters who wish to be named.

Please give us reasonable time to remediate before public disclosure. Do not
access, modify, or exfiltrate data that is not yours, and do not run tests
against deployments you do not own.

## Supported versions

This is a pre-1.0 scaffold. Until a stable release line exists, only the
**latest `main`** is supported with security fixes.

| Version               | Supported               |
| --------------------- | ----------------------- |
| `main` (latest)       | ✅                      |
| Older commits / forks | ❌ (rebase onto latest) |

Operators are responsible for keeping their self-hosted deployment current and
for monitoring the CI security gates (see
[`docs/CI_AND_COMPLIANCE.md`](docs/CI_AND_COMPLIANCE.md)).

## Scope

**In scope** (this repository): the API (`apps/api`), web client (`apps/web`),
`packages/crypto-core`, `packages/contracts`, the self-hosting infra
(`infra/`), and the CI/compliance gates.

Of particular interest:

- Any way to make the server obtain plaintext, DEKs, passwords, or unwrapped
  secret keys (violates the core invariant — `ARCHITECTURE.md` §8).
- Cryptographic flaws in `crypto-core` (nonce reuse, weak KDF params, sealed-box
  or secretstream misuse, signature/hash-chain bypass).
- Append-only / hash-chain integrity bypass; cross-org data access; auth
  (challenge/response) weaknesses.
- Client-side leakage (XSS, secret persistence, third-party exfiltration).

**Out of scope:** vulnerabilities in third-party hosting, an operator's
misconfiguration of their own deployment, social engineering, physical attacks,
and the placeholder contact/branding values. Report dependency vulnerabilities
that are not yet caught by the CI gates.

## Cryptography changes require review

Any change touching cryptographic behaviour — `packages/crypto-core/**`,
`packages/contracts/**` (algorithm IDs / envelope shape), or
`apps/api/src/auth.ts` — is **CODEOWNER-protected** and requires sign-off from
the security team. Pinned algorithms (XChaCha20-Poly1305, Argon2id,
X25519 sealed box, Ed25519, BLAKE2b-256) must not change without bumping
`ENVELOPE_VERSION` and a documented migration. See
[`docs/CI_AND_COMPLIANCE.md`](docs/CI_AND_COMPLIANCE.md) for the enforced gates.
