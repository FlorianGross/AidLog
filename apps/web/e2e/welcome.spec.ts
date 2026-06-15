/**
 * welcome.spec.ts — backend-less E2E for the onboarding chooser and the
 * invitation-redeem screen, plus the placeholder specs for the flows that need
 * the full docker stack (API + Postgres + MinIO).
 *
 * Like smoke.spec.ts, everything that ACTUALLY runs here hits the static
 * `vite preview` build with NO API (see playwright.config.ts): the welcome
 * chooser, the `?code=` prefill, and redeem's client-side validation all execute
 * entirely in the browser before any network call. The backend-coupled flows are
 * written as `test.skip(...)` so they are discovered by `--list` and ready to be
 * enabled in a full-stack CI job (E2E_BASE_URL → a seeded `docker compose`), but
 * never fail or hang the offline smoke run. See e2e/README.md §"Planned: full-stack".
 *
 * Selectors prefer accessible anchors (getByRole / labelled fields) over CSS.
 */
import { test, expect } from '@playwright/test';

test.describe('/welcome — onboarding chooser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/welcome/');
  });

  test('renders the heading and all three onboarding paths', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The three device-local onboarding routes are offered as links: join with an
    // invitation, add this device, create a new organisation. Assert by href so
    // the test is independent of the (German) link copy.
    await expect(page.locator('a[href="/redeem/"]')).toBeVisible();
    await expect(page.locator('a[href="/device-add/"]')).toBeVisible();
    await expect(page.locator('a[href="/setup/"]')).toBeVisible();

    // And the "already have an account" → unlock link.
    await expect(page.locator('a[href="/login/"]')).toBeVisible();
  });

  test('the join-with-invitation path routes to /redeem (SPA navigation)', async ({ page }) => {
    await page.locator('a[href="/redeem/"]').first().click();
    await expect(page).toHaveURL(/\/redeem\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#code')).toBeVisible();
  });

  test('the create-organisation path routes to /setup (SPA navigation)', async ({ page }) => {
    await page.locator('a[href="/setup/"]').first().click();
    await expect(page).toHaveURL(/\/setup\/?$/);
    await expect(page.locator('#org-name')).toBeVisible();
  });
});

test.describe('/redeem — invitation redemption (client-side portions only)', () => {
  test('prefills the invitation code from the ?code= query parameter', async ({ page }) => {
    // onMount reads $page.url.searchParams.get('code') and fills the field.
    await page.goto('/redeem/?code=INVITE-12345');
    await expect(page.locator('#code')).toHaveValue('INVITE-12345');
  });

  test('renders the redeem form with a password-type password field', async ({ page }) => {
    await page.goto('/redeem/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#code')).toBeVisible();
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#pw')).toHaveAttribute('type', 'password');
    await expect(page.locator('#pw2')).toHaveAttribute('type', 'password');
  });

  test('client-side validation catches a too-short password before any network call', async ({
    page,
  }) => {
    await page.goto('/redeem/?code=INVITE-12345');
    await page.locator('#name').fill('Helfer');
    // < 10 chars trips the component validate() (auth.passwordTooShort) which
    // returns BEFORE crypto.ready()/api.redeemInvitation — so no backend needed.
    await page.locator('#pw').fill('short');
    await page.locator('#pw2').fill('short');
    await page.getByRole('button', { name: /.+/ }).click();

    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/redeem\/?(\?.*)?$/);
  });

  test('client-side validation catches mismatched passwords before any network call', async ({
    page,
  }) => {
    await page.goto('/redeem/?code=INVITE-12345');
    await page.locator('#name').fill('Helfer');
    // Long enough to pass the length check, but mismatched → auth.passwordMismatch,
    // again returned before any api call.
    await page.locator('#pw').fill('correct-horse-battery');
    await page.locator('#pw2').fill('correct-horse-different');
    await page.getByRole('button', { name: /.+/ }).click();

    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/redeem\/?(\?.*)?$/);
  });
});

/**
 * BACKEND-DEPENDENT flows — discovered by `--list` but SKIPPED in the offline
 * smoke run. Enable them in a full-stack job that boots `docker compose` and
 * seeds a known org, then points Playwright at it via E2E_BASE_URL (see
 * e2e/README.md §"Planned: full-stack E2E"). Each `expect`/step is sketched so the
 * spec is ready to flesh out against a real, seeded deployment.
 *
 * They are gated on `!process.env.E2E_BASE_URL`: with no external stack URL set,
 * `vite preview` serves a backend-less SPA where these POSTs cannot succeed, so we
 * skip rather than fail. Set E2E_BASE_URL=https://localhost (seeded stack) to run.
 */
const NO_STACK = !process.env.E2E_BASE_URL;

test.describe('full-stack flows (need API + Postgres + MinIO — skipped offline)', () => {
  test('setup: create org + admin, then unlock', async () => {
    test.skip(NO_STACK, 'Needs the docker stack + a clean DB (registerOrg). Set E2E_BASE_URL.');
    // 1. /setup → fill org-name/admin-name/org-pw/admin-pw → submit.
    // 2. Server stores the public identity + wrapped secrets (no plaintext).
    // 3. Land on the dashboard; lock; /login → unlock with the org password.
  });

  test('redeem: an admin-issued invitation creates a helper account', async () => {
    test.skip(NO_STACK, 'Needs a server-issued single-use invitation code (redeemInvitation).');
    // Precondition: a seeded invitation code (global-setup creates it via /admin/users).
    // 1. /redeem?code=<seeded> → fill name + a strong password → submit.
    // 2. api.redeemInvitation returns the new account + org public info.
    // 3. Land on the dashboard as a helper; the helper appears in /admin/users.
  });

  test('authenticate: challenge/response proof-of-possession issues a session', async () => {
    test.skip(NO_STACK, 'Needs api.authenticate (Ed25519 challenge/response). Set E2E_BASE_URL.');
    // The server issues a challenge, the client signs it with its Ed25519 key,
    // the server verifies against the registered public key and returns a session.
    // No password is transmitted (ARCHITECTURE.md §7).
  });

  test('sync + integrity: a finalized record syncs and the hash-chain verifies', async () => {
    test.skip(NO_STACK, 'Needs sync endpoints + a seeded deployment. Set E2E_BASE_URL.');
    // Open a deployment, fill the ABCDE tabs, finalize a signed record, confirm it
    // syncs (ciphertext only) and the integrity panel validates prevHash/recordHash.
  });

  test('statistik: org analytics decrypt client-side to aggregates only', async () => {
    test.skip(NO_STACK, 'Needs seeded encrypted records to aggregate. Set E2E_BASE_URL.');
    // /admin/auswertung or deployment/[id]/statistik: the org-key holder decrypts
    // records in-browser; assert only whitelisted aggregates render (no free-text
    // / identifiers leak), per analytics/types.ts.
  });
});
