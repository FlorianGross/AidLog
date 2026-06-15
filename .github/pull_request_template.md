<!--
  Aidlog handles GDPR Art. 9 special-category health data with a zero-knowledge
  server. Every PR is a data-protection decision. Fill this out honestly — the
  reviewer relies on it.
-->

## What & why

<!-- Short description of the change and the motivation. Link any issue. -->

Closes #

## Security & data-protection self-review

- [ ] The **server stays blind**: this change does not send plaintext payloads, DEKs, passwords, or unwrapped secret keys to the server, nor log them.
- [ ] **No crypto primitive** (`libsodium`, `tweetnacl`, `crypto-js`, `bcrypt`, `node:crypto` for content) is imported outside `packages/crypto-core`.
- [ ] No **PII / health data** is written to logs, `localStorage`, analytics, or any third-party service.
- [ ] No **secrets** (keys, tokens, passwords) are committed (checked example/test files too).
- [ ] Cookies/tokens set by this change are **TLS-only** (`secure`, `httpOnly`, `sameSite`) where applicable.
- [ ] User-facing decrypted content is **rendered as text** (no `{@html}` / `dangerouslySetInnerHTML` on untrusted input).

## Compliance gate

- [ ] `pnpm run compliance:check` passes locally (crypto-lint + privacy-lint).
- [ ] `pnpm -r typecheck && pnpm -r build && pnpm -r test` pass.
- [ ] `pnpm run format:check` passes.

## Allowlist pragmas (if any)

<!--
  Did you add a `// crypto-lint-allow:` or `// privacy-lint-allow:` pragma?
  List each one here WITH its justification. Every pragma requires reviewer
  sign-off (see docs/CI_AND_COMPLIANCE.md). Leave "none" if not applicable.
-->

- none

## ⚠️ Touches crypto / key handling? → needs dedicated review

- [ ] This PR modifies `packages/crypto-core/**`, `apps/api/src/auth.ts`, key handling, the wire contract (`@aidlog/contracts`), or a compliance linter.
  - If checked: a **CODEOWNER review is required** and the change must reference the relevant `ARCHITECTURE.md` section it preserves or updates.
