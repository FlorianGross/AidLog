# Contributing to Aidlog

Thank you for contributing. Aidlog is a self-hosted, zero-knowledge
documentation app that processes **GDPR Art. 9 special-category health data**.
Because of that, contributions are held to a higher security and
data-protection bar than a typical app — the CI pipeline is also the
data-protection gate (see [`docs/CI_AND_COMPLIANCE.md`](docs/CI_AND_COMPLIANCE.md)).

> **Kurzfassung (DE):** Entwicklungsumgebung mit corepack/pnpm; Build-Reihenfolge
> `contracts` → `crypto-core` → `api`/`web`. Krypto-Primitive **ausschließlich**
> in `crypto-core`; niemals Klartext/Schlüssel an den Server. Vor dem PR
> `pnpm run compliance:check` lokal grün bekommen. Änderungen an
> `packages/crypto-core` erfordern eine zusätzliche Sicherheitsprüfung.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Prerequisites: Node 20 or 22, and `corepack` (ships with Node) to provide the
pinned `pnpm`.

```bash
corepack enable          # provides the pinned pnpm
pnpm install             # install workspace deps (use --frozen-lockfile in CI)
pnpm -r build            # build all packages in dependency order
```

Bring up the full stack locally:

```bash
docker compose -f infra/docker-compose.yml up --build   # Caddy + Postgres + MinIO + api + web
```

### Build order

The workspace builds in dependency order; build **`contracts` → `crypto-core` →
`api`/`web`**:

1. `packages/contracts` — shared wire types & pinned algorithm IDs (no deps).
2. `packages/crypto-core` — depends on `contracts`; the only crypto surface.
3. `apps/api` and `apps/web` — depend on both; never re-declare wire shapes.

`pnpm -r build` respects this ordering. If you change a cross-cutting wire shape,
update `@aidlog/contracts` **and** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
in the same change.

## Architectural boundaries (non-negotiable)

These are enforced by CI gates — see `ARCHITECTURE.md` §8 and
`docs/CI_AND_COMPLIANCE.md`:

- **Only `packages/crypto-core` may import a crypto-primitive library**
  (`libsodium*`, `tweetnacl`, `@noble/*`, `node:crypto` for content crypto, …).
  `api` and `web` call `crypto-core`; they must never touch primitives directly.
  The crypto-lint gate hard-fails on violations — you **cannot** pragma this
  away.
- **The server must never receive plaintext payloads, DEKs, passwords, or
  unwrapped secret keys.** The privacy-lint gate scans for leaks (logging of
  sensitive fields, secret persistence in storage, trackers). Encryption and
  decryption happen **only on the client**.
- **All packages depend on `@aidlog/contracts` for types**; none re-declare wire
  shapes. Breaking the envelope/record shape requires bumping
  `ENVELOPE_VERSION` with a documented migration.

## Run the compliance gate locally

Run this **before opening a PR** — it is the core data-protection gate and is
blocking in CI:

```bash
pnpm run compliance:check        # crypto-lint + privacy-lint

# CI-equivalent full local run:
corepack pnpm install --frozen-lockfile
pnpm -r typecheck && pnpm -r build && pnpm -r test
pnpm run format:check
pnpm run compliance:check
```

If you must allowlist a genuine false positive, do it **inline with a reason
pragma** (`// crypto-lint-allow: …` / `// privacy-lint-allow: …`). Every pragma
requires CODEOWNER sign-off and must be listed in the PR template. You **cannot**
pragma away a primitive import outside crypto-core, a weak hash, AES-ECB, or
`Math.random()` for secrets — fix the code. Full details:
[`docs/CI_AND_COMPLIANCE.md`](docs/CI_AND_COMPLIANCE.md).

## Commit & PR conventions

- **Branch** off `main`; do not commit directly to the protected branch.
- **Conventional Commits** for messages: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`, `ci:` (+ optional scope, e.g. `fix(crypto-core): …`).
- Keep PRs focused and small; describe the change and its security/privacy
  impact.
- Fill in the **PR template** (`.github/pull_request_template.md`), including
  the security/data-protection self-review and any pragmas added.
- All **required status checks must be green** before merge (compliance,
  build-test on Node 20 & 22, CodeQL, gitleaks, dependency-audit, Trivy,
  license-check, Semgrep). Code-owner review is required.
- Update docs (`ARCHITECTURE.md`, `docs/COMPLIANCE.md`, threat model) when
  behaviour changes.

## Changes to `packages/crypto-core` need extra review

`packages/crypto-core/**`, `packages/contracts/**`, the linters
(`scripts/*-lint.mjs`), `apps/api/src/auth.ts`, and `.github/**` are
**CODEOWNER-protected**. Any change to cryptographic behaviour requires sign-off
from the security team and, where relevant, a coordinated update to the threat
model and `ENVELOPE_VERSION`. When in doubt, open an issue to discuss the design
before writing code. See also [`SECURITY.md`](SECURITY.md).
