# Aidlog

**Open, end-to-end-encrypted documentation for emergency-medical and first-aid
deployments.** Self-hosted. Zero-knowledge. Vendor-neutral.

> Working title — branding lives in one config file (`apps/web/src/lib/branding.ts`)
> and is **not** tied to any specific aid organisation.

Aidlog lets first responders document patient contacts on a phone, tablet or
laptop (installable PWA, works offline in the field) while guaranteeing that the
server — and anyone who might steal its database — sees nothing but ciphertext.
Only the organisation lead, holding the organisation password, can decrypt
deployment data.

## Why this exists

Patient documentation on aid-service shifts is still largely done on paper.
Going digital means handling **special-category health data** (GDPR Art. 9),
which raises the bar for security and privacy enormously. Aidlog's answer is to
make the data **technically unreadable** to the server operator: encryption and
decryption happen exclusively on the client.

## Core security properties

| Property                                         | How                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Server sees only ciphertext                      | All payloads + images encrypted client-side before upload                                                 |
| Only the org lead can read                       | Per-record data key sealed to the **org public key**; org secret key is protected by the **org password** |
| Helpers can document without reading the archive | They seal to the org's _public_ key — no org secret needed to write                                       |
| Helper read-back until shift end                 | Data key additionally sealed to the helper; that wrapper is deleted on shift close                        |
| Tamper-evident & immutable                       | Append-only, Ed25519-signed, BLAKE2b hash-chained records                                                 |
| Org-key recovery                                 | **Shamir T-of-N** recovery — shares held by human trustees, never the server                              |
| Passwordless unlock                              | **WebAuthn/passkey (PRF)** unlock + offline **multi-device transfer** (QR + one-time PIN)                 |
| Hardware-key ready                               | Architecture also supports additional recovery wrappers (backup key)                                      |

## What you can do with it

Built on the zero-knowledge core above:

- **Document** patient contacts with a tabbed **ABCDE/SAMPLER** editor driven by a
  configurable schema (**in-app schema editor**), plus **vital trends**, a
  **photo + body-map**, **live scores**, a **resuscitation assistant** (metronome),
  and **ECG** strips.
- **Sign & counter-sign**: hand-drawn **signatures** and **co-signature**
  (Gegenzeichnung) where the counter-signer can read what they sign.
- **Digital consent / refusal** (Einwilligung) and a multilingual patient
  **self-intake** kiosk (de/en/tr/ar/ru/uk/fr, **Arabic RTL**).
- **Onboard** helpers via **admin invitations**; manage **roles** (admin/lead/helper),
  **offboarding**, and an **administrative audit log**.
- **Recover** the org key (Shamir) and **add devices** (QR + PIN).
- **Analyse** org-wide activity **client-side** — export carries only anonymised
  aggregates, never raw payloads.
- **Harden** field devices: auto-lock, lock-on-background, device wipe, **EXIF/GPS
  stripping** of every photo.
- **Export PDF**, view the **change-history / integrity** panel, and verify the
  archival **Merkle anchoring** (notarization) — all without decrypting on the server.
- **Web push** (optional): content-free operational notifications only.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the full design and its limits.

> ⚠️ **Before processing real patient data**, the cryptography and the GDPR
> posture must pass an independent security and data-protection review. This
> repository is a professionally-built foundation, not a certified product.

## Monorepo layout

```
packages/
  contracts/     Shared wire types & pinned algorithm IDs (no deps)
  crypto-core/   Isomorphic E2E crypto (libsodium) — the only place primitives live
apps/
  api/           Fastify server: thin authenticated append-only sync + blob store
  web/           SvelteKit PWA: offline-first, dynamic schema-driven forms
infra/           Docker Compose self-hosting (Caddy, Postgres, MinIO)
scripts/         Compliance linters (crypto-lint, privacy-lint)
docs/            Architecture, threat model, compliance & DSGVO templates, handbook
.github/         CI/CD with security & GDPR gates (merge blocked unless green)
```

## Documentation index

| Document                                                               | Purpose                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                         | System design & cryptographic contract                  |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)                         | Assets, adversaries, mitigations, honest residual risks |
| [`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md)                   | Review summary + auditor checklist & residual risks     |
| [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md)                             | DSGVO/GDPR overview & feature-to-measure mapping        |
| [`docs/PRE_PRODUCTION_CHECKLIST.md`](docs/PRE_PRODUCTION_CHECKLIST.md) | Concrete go-live gate before real patient data (DE)     |
| [`docs/HANDBUCH.md`](docs/HANDBUCH.md)                                 | User + admin handbook (DE)                              |
| [`docs/ACCESSIBILITY_AUDIT.md`](docs/ACCESSIBILITY_AUDIT.md)           | WCAG-oriented audit with prioritised findings           |
| [`docs/CI_AND_COMPLIANCE.md`](docs/CI_AND_COMPLIANCE.md)               | CI security/GDPR gates & how to run them                |
| [`docs/datenschutz/`](docs/datenschutz/)                               | TOM, VVT, DSFA & Betroffenenrechte templates (DE)       |
| [`apps/web/e2e/README.md`](apps/web/e2e/README.md)                     | Playwright E2E: smoke tests + full-stack plan           |

## Configurable protocol fields

The actual protocol fields (vitals, measures, patient data, …) are **not**
hard-coded. They are defined as a versioned JSON-Schema document
(`SchemaDefinition` in `@aidlog/contracts`). The web client renders the form
dynamically; extending or modifying fields means editing a schema, not the code.

## Quick start (development)

```bash
corepack enable                 # provides pnpm
pnpm install
pnpm -r build
# bring up Postgres + MinIO + api + web:
docker compose -f infra/docker-compose.yml up --build
```

## Mobile / Native app (Android & iOS)

The same zero-knowledge web client can be shipped as a native **Android** and
**iOS** app via a thin [Capacitor](https://capacitorjs.com/) shell — no second
codebase. The static PWA assets are bundled into the app (offline-capable) and
talk to the same self-hosted API. Set `VITE_API_BASE_URL` at build time to point
the app at your server (this also auto-extends the CSP). See
[`docs/MOBILE.md`](docs/MOBILE.md) for the full build + publish workflow and the
honest caveats (web push, QR scanning, storage durability).

## License

[AGPL-3.0-or-later](LICENSE) — chosen so self-hosted forks stay open. Discuss in
an issue if your organisation needs a different arrangement.
