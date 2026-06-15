# Accessibility (A11y) — Status & Manual Test Checklist

> **Honest scope:** This is **not** a certified WCAG audit and not an
> assistive-technology conformance test. It documents the concrete accessibility
> work shipped in the multilingual/A11y wave, the supporting features
> (glove/large-font mode, reduced-motion, RTL), the known gaps, and a manual
> checklist for ongoing verification. For the broader expert review and the full
> backlog, see [`ACCESSIBILITY_AUDIT.md`](./ACCESSIBILITY_AUDIT.md).

**App:** `apps/web` (SvelteKit PWA, Svelte 5 runes). **Default & source-of-truth
locale:** German (`de`).

---

## 1. What this wave addressed

### Internationalization & document language

- **7 UI locales** wired in: `de` (source of truth) + `en`, `tr`, `ar`, `ru`,
  `uk`, `fr`. Non-German locales use their own dictionary with **per-key
  fallback to German** for any missing/empty value, so a partial translation
  never surfaces a raw key (`apps/web/src/lib/i18n/index.ts`).
  - **Translations for `tr/ar/ru/uk/fr` are machine/model-generated and need
    native-speaker review before production use** (each file carries this notice
    at the top).
- **Dynamic `<html lang>`** now tracks the active locale (`+layout.svelte`), so
  screen readers announce content with the correct pronunciation instead of
  always assuming German. (Previously `app.html` hard-coded `lang="de"`; this
  closes audit item A11Y-03 at the document level.)
- A **language selector** with native names (Deutsch, English, Türkçe, العربية,
  Русский, Українська, Français) lives on the profile/settings page; the choice
  is persisted in `localStorage`.

### RTL (Arabic)

- Selecting Arabic sets `<html dir="rtl">` (`+layout.svelte`,
  `dirFor()` in `i18n/index.ts`).
- `app.css` adds pragmatic `[dir='rtl']` rules: the navigation drawer moves to
  and slides in from the **right**, the off-canvas transform is flipped, body /
  form fields / labels right-align, and directional chevrons flip via a
  `.rtl-flip` hook. This mirrors the **most visible** asymmetries; it is not an
  exhaustive bidi pass.

### Glove / large-font display mode (Handschuh-/Großschrift-Modus)

- A persisted setting (`apps/web/src/lib/display.ts`, mirroring `theme.ts`):
  `setDisplayMode('glove')` sets `<html data-display="glove">` and persists to
  `localStorage`; `initDisplayMode()` re-applies it on client start.
- Under `[data-display='glove']` (`app.css`) the **root font-size scales to
  125%** (so all rem-based type, spacing and the 3rem touch targets grow
  proportionally), and buttons / inputs / `.min-h-touch` controls get a larger
  **3.5rem** minimum height, larger control text, more tap spacing in menus, and
  enlarged checkboxes/switches. Normal mode is untouched.
- A labelled toggle is available in the profile/settings UI; it is initialized
  in `+layout.svelte` `onMount` like the theme.

### Concrete a11y fixes

- **Modal focus management** (`apps/web/src/lib/ui/Modal.svelte`): on open the
  dialog receives focus; on close focus is **restored** to the triggering
  element; `Escape` closes; the dialog is labelled via `aria-labelledby` (its
  heading) when a title is present, else `aria-label`. Its close-buttons now use
  the i18n `common.close` label and meet the touch-target minimum. (Addresses
  the focus-restore part of audit A11Y-08.)
- **Stronger, always-visible focus ring**: an explicit `:focus-visible` outline
  for links, buttons, `[role=button]`, inputs, selects and textareas is appended
  to `app.css` so keyboard focus is unmistakable and never suppressed.

### Already in place (retained, not regressed)

- `prefers-reduced-motion: reduce` block in `app.css` (neutralizes
  transitions/animations) — present before this wave.
- Touch targets via `min-h-touch`/`min-w-touch` = 48px tokens.
- Semantic landmarks (`<header>/<nav aria-label>/<main>/<footer>`),
  `aria-expanded` on the hamburger, `aria-live="polite"` for connectivity,
  `role="alert"` for errors, associated `<label for>` form fields, icons
  rendered with `aria-hidden="true"`.

---

## 2. Known gaps (documented, not fixed here)

These remain open; several are tracked in `ACCESSIBILITY_AUDIT.md`:

- **Native-speaker translation review** for `tr/ar/ru/uk/fr` (machine-drafted).
- **Color contrast** of the `--text-subtle` / `--text-muted` tokens vs. AA
  (audit A11Y-01) — token-level change, out of scope for this wave.
- **Full focus-trap** inside open Modal/Drawer (Tab does not yet cycle strictly
  within the dialog; focus _restore_ and Escape are done). Audit A11Y-08.
- **Field-level error association** (`aria-invalid` / `aria-describedby`) for
  form inputs (audit A11Y-07).
- **Theme/display toggle state** is not announced via a live region (audit
  A11Y-04).
- **Canvas alternatives** (body-map, ECG, trends, signature) lack textual
  summaries (audit A11Y-12).
- **Skip-to-content link** (audit A11Y-09) and a full **icon-only button** sweep
  across all feature panels (audit A11Y-06).
- **RTL** is pragmatic, not exhaustive — dense/custom-positioned widgets may
  still need per-component mirroring; numeric scales should stay LTR.
- No **automated** axe/contrast checks in CI yet (proposed in the audit).

---

## 3. Manual test checklist

Run per meaningful change to the shell, drawer, forms, or the new settings.

### Keyboard-only

- [ ] Tab order is logical through header → drawer → main → footer.
- [ ] Every interactive control is reachable and shows a visible focus ring.
- [ ] Hamburger opens the drawer; `Escape` closes it; focus is sensible.
- [ ] Opening a Modal moves focus into it; `Escape` closes it and focus returns
      to the button that opened it.
- [ ] Language selector and glove-mode toggle are operable by keyboard.

### Screen reader (NVDA / VoiceOver / TalkBack)

- [ ] Page title (`<h1>`), landmarks and the nav label are announced.
- [ ] Icon-only buttons announce a name (e.g. "Menü öffnen").
- [ ] Error messages (`role="alert"`) are announced when they appear.
- [ ] Switching language changes `<html lang>` and pronunciation follows.

### Right-to-left (Arabic)

- [ ] Selecting العربية sets `dir="rtl"`; the drawer is on the right and slides
      in from the right.
- [ ] Text and form fields are right-aligned; chevrons point the correct way.
- [ ] No major clipped/overlapping layout in header, drawer and forms.

### Glove / large-font mode

- [ ] Toggling it enlarges base font and controls; targets stay tappable with
      gloves; nothing critical is clipped or unreachable.
- [ ] The setting persists across reload.
- [ ] Normal mode is unchanged after toggling back.

### Zoom & motion

- [ ] At 200% browser zoom, content reflows and remains usable (no loss of
      function, minimal horizontal scrolling).
- [ ] With OS "reduce motion" enabled, transitions/animations are neutralized.

### Contrast

- [ ] Spot-check primary text, buttons and badges against their backgrounds in
      both light and dark themes (target AA 4.5:1 for normal text). Note: the
      `subtle`/`muted` tokens are a known gap (see §2).

---

## 4. Internationalization parity guard

`apps/web/src/lib/i18n/i18n.test.ts` asserts that every non-German locale
introduces **no keys German lacks**, that the fully-authored locales
(`tr/ar/ru/uk/fr`) provide **every** German key (structural parity), and that
the **per-key German fallback** resolves missing keys (so partial locales like
`en` never show a raw key). Keep this test green when adding keys.
