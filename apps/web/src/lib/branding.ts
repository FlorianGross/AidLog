/**
 * branding.ts — the SINGLE source of truth for app branding.
 *
 * IMPORTANT: Aidlog is intentionally NEUTRAL and vendor-agnostic. It is NOT
 * tied to any specific aid organisation (no DRK / Johanniter / Malteser / ASB /
 * Red Cross / St John, etc. branding, colors, or wording). Everything visual —
 * the app name, palette, and logo — flows from this file so a self-hoster can
 * re-skin the whole client by editing ONE module.
 *
 * Consumed by:
 *   - tailwind.config.js  (color palette)
 *   - vite.config.ts      (PWA manifest: name, theme/background color)
 *   - app.html / layout   (titles, theme-color meta)
 *
 * Keep this file framework-free (plain TS values) so both the Vite/Tailwind
 * Node config and the Svelte runtime can import it.
 */

export interface Branding {
  appName: string;
  appShortName: string;
  appDescription: string;
  /** PWA + browser chrome color. */
  themeColor: string;
  backgroundColor: string;
  /** Path (under static/) to the neutral logo placeholder. */
  logoPath: string;
}

export const branding: Branding = {
  appName: 'Aidlog',
  appShortName: 'Aidlog',
  appDescription:
    'Offline-first, zero-knowledge documentation for first-aid and emergency-medical deployments.',
  // A calm, neutral teal — deliberately NOT any aid organisation's signature
  // red/blue/orange. Re-skin freely.
  themeColor: '#0f766e',
  backgroundColor: '#0b1220',
  logoPath: '/icons/icon-512.png',
};

/**
 * Tailwind-facing color tokens derived from the neutral brand. Exposed
 * separately so `tailwind.config.js` (plain JS) can consume a stable shape.
 */
export const brandingTailwind = {
  colors: {
    brand: {
      50: '#f0fdfa',
      100: '#ccfbf1',
      200: '#99f6e4',
      300: '#5eead4',
      400: '#2dd4bf',
      500: '#14b8a6',
      600: '#0d9488',
      700: '#0f766e',
      800: '#115e59',
      900: '#134e4a',
    },
    // Status colors for the offline/online and validity indicators. Neutral,
    // not org-specific.
    danger: '#dc2626',
    warning: '#d97706',
    ok: '#16a34a',
  },
} as const;
