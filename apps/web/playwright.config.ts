/**
 * Playwright configuration — END-TO-END SMOKE TESTS for the Aidlog PWA.
 *
 * SCOPE (see e2e/README.md): these tests exercise the STATIC client build with
 * NO backend. They confirm the app shell renders, the pre-unlock auth flows
 * (`/setup`, `/login`, `/redeem`, `/recover`, `/device-add`) render their forms,
 * the theme toggle cycles, and client-side navigation between auth routes works.
 * Anything that needs a live API (org registration, sync, cosign, push, …) is
 * documented as a separate "full-stack E2E" plan in e2e/README.md and is NOT run
 * here, so the smoke suite stays deterministic and offline-runnable.
 *
 * ISOLATION FROM VITEST: Playwright only collects `*.spec.ts` under `./e2e`
 * (`testDir` + `testMatch`). Vitest (vite.config.ts → `test.include`) only
 * collects test files under `src/` (its `.test.`/`.spec.` glob). The two never
 * overlap: no Vitest file lives under e2e/, and no Playwright spec lives under
 * src/. Running
 * `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) are fully independent.
 *
 * The web server is the production static build served by `vite preview`
 * (adapter-static output). Playwright builds + boots it via `webServer` and
 * reuses an already-running instance locally.
 */
import { defineConfig, devices } from '@playwright/test';

/** Port for the `vite preview` server the smoke tests hit. */
const PORT = Number(process.env.E2E_PORT ?? 4173);
// Default to the local `vite preview` origin; the full-stack plan overrides this
// with E2E_BASE_URL to target a running `docker compose` deployment.
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Only *.spec.ts files are Playwright tests. Vitest uses *.test.ts in src/.
  testMatch: /.*\.spec\.ts$/,
  // Fail the CI build if a test was accidentally committed with test.only.
  forbidOnly: !!process.env.CI,
  // The smoke tests are independent and self-contained — run them in parallel.
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    // Deterministic locale for label assertions (the UI is German).
    locale: 'de-DE',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile profile: the app is a field-first PWA. Smoke the small viewport so
    // the mobile chrome (hamburger menu, off-canvas drawer) at least mounts.
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Build the static client and serve it with `vite preview`. No API is started:
  // the smoke tests never call the backend, so an unreachable `/api/*` is fine.
  //
  // We invoke the local `vite` binary directly (resolved via npm's script PATH,
  // which prepends node_modules/.bin) so the server does not depend on `pnpm`
  // being on PATH inside the Playwright worker. `npm` ships with Node, so this is
  // portable across the dev box and CI. The build runs first, then preview serves
  // the adapter-static output. (`E2E_BASE_URL` lets the full-stack plan point at
  // a running deployment instead — see e2e/README.md.)
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
