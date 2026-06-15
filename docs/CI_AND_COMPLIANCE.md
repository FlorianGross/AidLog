# CI & Compliance Gate

Aidlog is a self-hosted, zero-knowledge documentation app for emergency-medical
deployments. It processes **GDPR Art. 9 special-category health data**, so the
CI pipeline is also the data-protection gate: code merges to the protected
branch **only when the security & privacy checks are green**.

This document explains what each gate checks, how to run them locally, how to
allowlist a finding (and why that needs reviewer sign-off), and the exact
required-status-check names to configure in GitHub branch protection.

---

## 1. The gates at a glance

| Gate                              | Workflow / job                     | What it enforces                                                       | Blocking?                |
| --------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| Compliance linters                | `ci` → `compliance`                | crypto-boundary (ARCHITECTURE §8) + PII/secret leakage                 | **Blocking**             |
| Build / typecheck / test / format | `ci` → `build-test` (Node 20 & 22) | the code compiles, tests pass, formatting is clean, compliance re-runs | **Blocking**             |
| CodeQL                            | `security` → `codeql`              | static analysis (security-and-quality) for JS/TS                       | **Blocking**             |
| Secret scanning                   | `security` → `gitleaks`            | no committed credentials (full history)                                | **Blocking**             |
| Dependency vulns                  | `security` → `dependency-audit`    | OSV-Scanner on the lockfile (pnpm audit fallback)                      | **Blocking**             |
| Filesystem + IaC scan             | `security` → `trivy`               | HIGH/CRITICAL vulns, secrets, Dockerfile/compose misconfig             | **Blocking**             |
| License policy                    | `security` → `license-check`       | only OSI / GPL-compatible licenses (AGPL/MIT/Apache/BSD/ISC…)          | **Blocking**             |
| SBOM                              | `security` → `sbom`                | CycloneDX SBOM uploaded as an artifact                                 | Advisory (artifact only) |
| Semgrep SAST                      | `semgrep` → `semgrep`              | community packs + Aidlog invariant rules                               | **Blocking**             |

> The SBOM job is **advisory**: it produces an audit artifact and should not, by
> itself, block a merge. Everything else above is intended to be **required**.

---

## 2. Run it locally

```bash
# The two custom compliance linters (this is the core data-protection gate):
pnpm run compliance:check          # = node scripts/crypto-lint.mjs && node scripts/privacy-lint.mjs

# Individually, with machine-readable output:
node scripts/crypto-lint.mjs       # human report
node scripts/crypto-lint.mjs --json
node scripts/privacy-lint.mjs
node scripts/privacy-lint.mjs --json

# The full CI-equivalent local run:
corepack pnpm install --frozen-lockfile
pnpm -r typecheck && pnpm -r build && pnpm -r test
pnpm run format:check
pnpm run compliance:check
```

Both linters are **pure Node, zero-dependency, cross-platform** (Windows + Linux)
and exit `0` on a clean tree, non-zero with a clear `file:line / rule / fix`
report on a violation.

### What the custom linters check

`scripts/crypto-lint.mjs`

- Crypto-primitive libraries (`libsodium*`, `tweetnacl`, `crypto-js`, `bcrypt`,
  `@noble/*`, `node-forge`, `sjcl`, `argon2`, `scrypt`) imported **outside**
  `packages/crypto-core` → hard fail (ARCHITECTURE §8). A pragma **cannot**
  override this architectural boundary.
- `node:crypto` / `crypto` imported outside crypto-core **without** an allow
  pragma. Legitimate non-content uses (session-token HMAC, random ids/challenges
  in `apps/api`) are allowed **with** `// crypto-lint-allow: <reason>`.
- Weak primitives anywhere: `md5`, `sha1`, the keyless `createCipher(`, AES-ECB,
  `Math.random()` used to make keys/tokens/ids/nonces, and hardcoded base64/hex
  key/IV literals near crypto calls.

`scripts/privacy-lint.mjs`

- `console.*` / logger calls in `apps/api` that log `req.body` or a sensitive
  identifier (`password`, `secretKey`, `dek`, `payload`, `plaintext`, `token`,
  `wrappedSecret`, …).
- Third-party trackers/analytics in `apps/web` deps or code (Google Analytics,
  gtag, Segment, Sentry, Facebook Pixel, Hotjar, Mixpanel, PostHog, Amplitude).
- Missing pino redaction config in the api server (a non-empty `REDACT_PATHS`
  wired to `redact.paths`).
- Plaintext writes of secrets to `localStorage` / `sessionStorage` in `apps/web`.

Heuristics live in a documented `CONFIG` block at the top of each script and are
tunable there.

---

## 3. Allowlisting a finding (requires reviewer sign-off)

Some findings are legitimate false positives. Allowlist them **inline, on the
offending line**, with a mandatory reason:

```ts
import { createHmac, randomBytes } from 'node:crypto'; // crypto-lint-allow: session-token HMAC, not content crypto
sessionStorage.setItem(TOKEN_KEY, token); // privacy-lint-allow: opaque short-lived session token, no key material
```

- The pragma reason is **printed in audits**, so it is part of the record.
- A pragma weakens a data-protection gate by exactly one line, which is why
  **every pragma requires CODEOWNER sign-off.** `scripts/*-lint.mjs`,
  `packages/crypto-core/**`, `packages/contracts/**`, `apps/api/src/auth.ts`,
  and `.github/**` are CODEOWNER-protected (`.github/CODEOWNERS`), so a reviewer
  on the security team must approve.
- **You cannot pragma away** a crypto-primitive import outside crypto-core, a
  weak hash, AES-ECB, or `Math.random()` for secrets — those are hard architectural
  failures. Fix the code instead.

The PR template (`.github/pull_request_template.md`) requires you to list every
pragma you added and its justification.

---

## 4. Branch protection — required status checks

Configure the protected branch (`main`) in
**Settings → Branches → Branch protection rules** with:

- ✅ Require a pull request before merging
- ✅ Require review from **Code Owners**
- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging

Add these **exact status-check names** as required (they are the job `name:`
values, parameterised jobs include the matrix value):

```
compliance (crypto-lint + privacy-lint)
build-test (node 20)
build-test (node 22)
codeql
gitleaks
dependency-audit
trivy
license-check
semgrep
```

Notes:

- `sbom` is intentionally **left out** of the required list — it is advisory and
  only publishes an artifact.
- The job names come from `name:` in the workflows; matrix jobs render as
  `build-test (node 20)` / `build-test (node 22)`. If you rename a job, update
  this list and branch protection together.
- The weekly scheduled runs of `security` and `semgrep` (cron) provide drift
  detection for new CVEs in unchanged dependencies; they don't gate PRs but
  should be monitored.

---

## 5. Where each config lives

| File                               | Purpose                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`         | build/typecheck/test/format + compliance, Node 20 & 22                                                                                  |
| `.github/workflows/security.yml`   | CodeQL, gitleaks, OSV-Scanner, Trivy, license, SBOM (+ weekly cron)                                                                     |
| `.github/workflows/semgrep.yml`    | Semgrep community packs + custom rules (+ weekly cron)                                                                                  |
| `.github/codeql-config.yml`        | CodeQL query suite + path filters                                                                                                       |
| `.gitleaks.toml`                   | secret-scan rules + allowlist (example/test files)                                                                                      |
| `.trivyignore`                     | reviewer-approved Trivy risk acceptances (empty by default)                                                                             |
| `osv-scanner.toml`                 | OSV advisory acceptances (empty by default)                                                                                             |
| `.semgrep/aidlog.yml`              | custom invariant rules (no primitive outside core, no plaintext in responses, no `{@html}`/`dangerouslySetInnerHTML`, TLS-only cookies) |
| `.github/dependabot.yml`           | weekly npm + github-actions + docker updates                                                                                            |
| `.github/CODEOWNERS`               | mandatory review on crypto-core, contracts, linters, auth, CI config                                                                    |
| `.github/pull_request_template.md` | security/data-protection self-review checklist                                                                                          |
| `scripts/crypto-lint.mjs`          | crypto boundary & weak-primitive linter                                                                                                 |
| `scripts/privacy-lint.mjs`         | PII/secret-leakage & data-protection linter                                                                                             |
