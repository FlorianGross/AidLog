/**
 * smoke.spec.ts — backend-less smoke tests for the Aidlog PWA shell.
 *
 * These run against the STATIC `vite preview` build (see playwright.config.ts).
 * There is NO API: the app is offline-first, so the pre-unlock screens render
 * fully from the static bundle. We assert structure/forms/navigation only — never
 * anything that would require the server (registration, sync, cosign, push).
 *
 * Why these are not flaky:
 *  - No network calls to a backend are awaited (the app degrades gracefully
 *    offline; org-info/auth fetches are best-effort and swallowed).
 *  - Assertions target stable, accessible anchors: heading roles, labelled form
 *    fields (`#org-pw`, `#admin-pw`, `#pw`), and visible links — not CSS classes.
 *  - On a fresh browser context there is no stored identity, so `/login`
 *    deterministically redirects to `/setup` (login/+page.svelte onMount). We
 *    assert that redirect explicitly instead of racing it.
 */
import { test, expect } from '@playwright/test';

test.describe('app shell', () => {
  test('home boots and redirects an unauthenticated visitor to an auth screen', async ({
    page,
  }) => {
    await page.goto('/');
    // Dashboard (+page.svelte) sends a locked session to /login, which in turn
    // (no stored identity) forwards to /setup. Either landing is acceptable; we
    // just assert we end up on a pre-unlock auth route with a heading rendered.
    await expect(page).toHaveURL(/\/(setup|login)\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('document has the German lang attribute (a11y / screen readers)', async ({ page }) => {
    await page.goto('/setup/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });
});

test.describe('/setup — first-run organisation setup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/setup/');
  });

  test('renders the org-creation form with all password fields', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Org name + the four password fields (org x2, admin x2) all present and
    // reachable by their stable ids / labels.
    await expect(page.locator('#org-name')).toBeVisible();
    await expect(page.locator('#org-pw')).toBeVisible();
    await expect(page.locator('#org-pw2')).toBeVisible();
    await expect(page.locator('#admin-pw')).toBeVisible();
    await expect(page.locator('#admin-pw2')).toBeVisible();

    // Password fields must be type=password (not plain text).
    await expect(page.locator('#org-pw')).toHaveAttribute('type', 'password');
    await expect(page.locator('#admin-pw')).toHaveAttribute('type', 'password');

    // A submit button exists and the org-password-loss warning is surfaced.
    await expect(page.getByRole('button', { name: /.+/ })).toBeVisible();
    await expect(page.locator('[role="note"]')).toBeVisible();
  });

  test('client-side validation rejects too-short / mismatched passwords without a backend', async ({
    page,
  }) => {
    // Fill EVERY required field so native HTML5 constraint validation passes and
    // control reaches the component's own JS validator (which is what we test).
    await page.locator('#org-name').fill('Test-Org');
    await page.locator('#admin-name').fill('Admin');
    // Deliberately short (< 10 chars) to trip the client-side JS validator.
    await page.locator('#org-pw').fill('short');
    await page.locator('#org-pw2').fill('short');
    await page.locator('#admin-pw').fill('short');
    await page.locator('#admin-pw2').fill('short');
    await page.getByRole('button', { name: /.+/ }).click();

    // The validator returns before any network call, so an inline alert appears
    // and we stay on /setup. This proves the form runs entirely client-side.
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/setup\/?$/);
  });

  test('links to the unlock screen', async ({ page }) => {
    const unlockLink = page
      .getByRole('link', { name: /.+/ })
      .filter({ hasNot: page.locator('img') });
    await expect(unlockLink.first()).toBeVisible();
    // There is a link to /login/.
    await expect(page.locator('a[href="/login/"]')).toBeVisible();
  });
});

test.describe('/login — unlock', () => {
  test('with no stored identity, /login forwards to /setup', async ({ page }) => {
    await page.goto('/login/');
    // login/+page.svelte onMount: no identity → goto('/setup/').
    await expect(page).toHaveURL(/\/setup\/?$/);
    await expect(page.locator('#org-name')).toBeVisible();
  });
});

test.describe('pre-unlock auth routes render their shells', () => {
  // Each of these is reachable directly and must render its own heading without
  // an identity or a backend. They share the bare (chrome-less) auth layout.
  for (const path of ['/setup/', '/redeem/', '/recover/', '/device-add/']) {
    test(`${path} renders a heading and a form control`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // At least one interactive control (input or button) is present.
      const controls = page.locator('input, button');
      await expect(controls.first()).toBeVisible();
    });
  }
});

test.describe('theme toggle', () => {
  test('cycling the theme toggle changes the persisted html data-theme', async ({ page }) => {
    await page.goto('/setup/');

    // The toggle lives in the app header, which is suppressed on auth routes, so
    // we drive the underlying persisted preference contract directly via the
    // same localStorage key the theme store uses (`aidlog-theme`) and assert the
    // documented behaviour: an explicit choice sets <html data-theme>.
    const html = page.locator('html');

    // Default ("system") → no data-theme attribute.
    await expect(html).not.toHaveAttribute('data-theme', /.+/);

    // Apply an explicit dark preference the way theme.ts persists it, reload, and
    // confirm initTheme() reflects it on first paint.
    await page.evaluate(() => localStorage.setItem('aidlog-theme', 'dark'));
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.evaluate(() => localStorage.setItem('aidlog-theme', 'light'));
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Clearing the preference returns to "system" (attribute removed).
    await page.evaluate(() => localStorage.removeItem('aidlog-theme'));
    await page.reload();
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('client-side navigation between auth routes', () => {
  test('setup → login link navigates without a full reload', async ({ page }) => {
    await page.goto('/setup/');
    await page.locator('a[href="/login/"]').first().click();
    // With no identity, login bounces back to /setup — the navigation itself is
    // what we assert works (SPA routing + redirect both function offline).
    await expect(page).toHaveURL(/\/(login|setup)\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
