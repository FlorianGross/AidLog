# Aidlog End-to-End Tests (Playwright)

This directory holds the **Playwright** end-to-end tests for the web client. It
is deliberately separate from the **Vitest** unit/component tests under
`src/**` — the two runners never overlap (see "Isolation" below).

## What runs today: backend-less smoke tests

Two spec files exercise the **static client build with no API**. Because Aidlog
is an offline-first PWA, every pre-unlock screen renders fully from the static
bundle, so these tests are fast and deterministic.

**`smoke.spec.ts`** — app shell + the core pre-unlock auth screens:

- the app shell boots and an unauthenticated visitor is routed to an auth screen;
- `/setup` renders the organisation-creation form (org + admin password fields)
  and its **client-side** validation rejects weak/mismatched passwords with no
  network call;
- `/login` with no stored identity forwards to `/setup` (as the component does);
- `/redeem`, `/recover`, `/device-add` each render their heading + a control;
- the theme preference contract (`aidlog-theme` → `<html data-theme>`) works
  across reloads (light / dark / system);
- client-side navigation between auth routes works (SPA routing + redirects).

**`welcome.spec.ts`** — the onboarding chooser + redeem client-side portions:

- `/welcome` renders its heading and routes to all three onboarding paths
  (`/redeem`, `/device-add`, `/setup`) plus the unlock link;
- `/redeem` prefills the invitation code from `?code=` and its **client-side**
  validation catches too-short / mismatched passwords before any network call;
- it also holds the **skipped** placeholder specs for the backend-coupled flows
  (setup→register, redeem, authenticate, sync/integrity, statistik) so they show
  up in `--list` and are ready to enable against the full stack — see below.

### Run the smoke tests

```bash
# from the repo root
corepack pnpm --filter @aidlog/web exec playwright install --with-deps chromium
corepack pnpm --filter @aidlog/web test:e2e
```

The Playwright config (`../playwright.config.ts`) builds the app and serves it
with `vite preview` via the `webServer` block — you do **not** need to start
anything by hand. Locally it reuses an already-running preview if present.

> If browser binaries cannot be installed in your environment (sandbox / no
> network), the config and specs are still valid; install Chromium on a machine
> that allows it and re-run. Nothing in the smoke suite needs the API, MinIO, or
> Postgres.

## Isolation from Vitest

| Runner     | Collects                       | Command                              |
| ---------- | ------------------------------ | ------------------------------------ |
| Vitest     | `src/**/*.{test,spec}.{ts,js}` | `pnpm --filter @aidlog/web test`     |
| Playwright | `e2e/**/*.spec.ts`             | `pnpm --filter @aidlog/web test:e2e` |

- Vitest's `test.include` (in `vite.config.ts`) is scoped to `src/**`, so it
  never picks up anything in `e2e/`.
- Playwright's `testDir: './e2e'` + `testMatch: /.*\.spec\.ts$/` keeps it inside
  this directory.
- **Do not** put a Vitest `*.test.ts` here, and **do not** put a Playwright
  `*.spec.ts` under `src/` — the naming split is what keeps the two from
  colliding. (Vitest would happily match `*.spec.ts` if one appeared in `src/`.)

---

## Planned: full-stack E2E against `docker compose` (NOT run in the smoke suite)

The smoke suite stops at the trust boundary on purpose: anything that needs a
live server (org registration, login challenge/response, sync, co-signature,
recovery, push) belongs in a **full-stack** suite run against a real, seeded
deployment. That suite is intentionally **not** wired into `test:e2e` yet because
it requires Docker services and a seeded organisation; this is the plan for
standing it up.

### 1. Bring up the stack

```bash
cp infra/.env.example infra/.env          # fill POSTGRES_*, MINIO_*, SESSION_SECRET
# (optional) generate VAPID keys to also cover the push path:
#   npx web-push generate-vapid-keys  → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
# wait for: postgres healthy, minio-init done, migrate exited 0, api up, caddy up
```

Point Playwright at the deployed origin instead of `vite preview`:

```bash
E2E_BASE_URL=https://localhost  corepack pnpm --filter @aidlog/web test:e2e
```

(A `fullstack.config.ts` would set `use.baseURL = process.env.E2E_BASE_URL` and
**drop** the `webServer` block, since the stack is already running. Accept the
local Caddy cert with `use.ignoreHTTPSErrors = true` for self-signed dev certs.)

### 2. Seed a known organisation

Because the server is zero-knowledge, seeding must happen **through the client
crypto path** — you cannot insert decryptable rows directly. Two supported
approaches:

- **UI-driven seed (preferred, end-to-end true):** a `global-setup.ts` drives a
  headless browser once to run `/setup` (create org + admin), then create an
  invitation in `/admin/users`, redeem it in a second context as a helper, and
  save both storage states (`storageState`) for reuse by the specs.
- **Scripted seed:** a small Node seeding script that imports `@aidlog/crypto-core`
  to generate identities, wrap secrets, and POST `registerOrg` / `redeemInvitation`
  exactly like the client does. Store the resulting passwords as test secrets.

### 3. Scenarios to cover (full-stack)

1. **Onboarding:** setup org → unlock → create invitation → redeem as helper →
   helper appears in `/admin/users`.
2. **Document + finalize:** open a deployment, fill ABCDE tabs, finalize a
   signed record; verify it syncs and the integrity panel validates the chain.
3. **Co-signature:** lead requests a counter-signature; signer reads + signs in
   `/cosign`; status flips to complete.
4. **Soft revocation:** close a shift; confirm the helper can no longer decrypt
   that deployment after re-login (helper-sealed key removed server-side).
5. **Recovery drill:** configure Shamir trustees, then reconstruct from ≥ T
   shares in `/recover` and re-wrap under a new org password.
6. **Multi-device:** export a transfer code + PIN on device A; adopt on device B
   via `/device-add`; unlock with the account password.
7. **Analytics:** admin runs `/admin/auswertung`; assert only aggregates render
   (no free-text / identifiers leak into the export).
8. **Audit log:** disable a user; confirm the action appears in `/admin/audit`.
9. **Push (if VAPID set):** subscribe in settings; assert a content-free
   notification body (never patient data).

### 4. CI shape (future)

Run the smoke suite on every PR (fast, no services). Run the full-stack suite on
a nightly / pre-release job that spins up `docker compose`, seeds, runs, and
tears down — keeping PR latency low while still covering the server-coupled
flows before a release.
