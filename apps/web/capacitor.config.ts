import type { CapacitorConfig } from '@capacitor/cli';

import { branding } from './src/lib/branding';

/**
 * Capacitor config — wraps the existing SvelteKit (adapter-static) PWA into
 * native Android + iOS shells WITHOUT changing the web build.
 *
 * Design notes (read before editing):
 *
 *  - `webDir: 'build'` is the adapter-static output (`vite build`). Capacitor
 *    bundles those static assets INTO the app, so the native shell runs fully
 *    offline from a LOCAL origin — Android `https://localhost`, iOS
 *    `capacitor://localhost`. Both are SECURE CONTEXTS, which libsodium's WASM
 *    module requires (alongside CSP `wasm-unsafe-eval`, set in svelte.config.js).
 *
 *  - We deliberately DO NOT set `server.url`. The app does not load remote HTML;
 *    it serves the bundled static shell and talks to the remote API
 *    CROSS-ORIGIN. The remote API base URL is configured at BUILD TIME via the
 *    `VITE_API_BASE_URL` env var (see apps/web/src/lib/api.ts), NOT here. That
 *    same env var also auto-extends the CSP `connect-src` (svelte.config.js) so
 *    the cross-origin API calls are permitted from the native WebView.
 *
 *  - `appId` is vendor-neutral. An organisation publishing its own build MUST
 *    change this to its own reverse-DNS id (e.g. `org.example.aidlog`) before
 *    submitting to the Play Store / App Store. `appName` flows from the single
 *    branding source of truth (src/lib/branding.ts).
 *
 *  See docs/MOBILE.md for the full native build + publish workflow.
 */
const config: CapacitorConfig = {
  appId: 'org.aidlog.app',
  appName: branding.appName,
  webDir: 'build',
  android: {
    // Run the Android WebView from `https://localhost` (default scheme is
    // `http`). `https` makes it a SECURE CONTEXT so libsodium's WebAssembly +
    // crypto.subtle work exactly as they do in the browser PWA.
    scheme: 'https',
  },
  // iOS already serves from `capacitor://localhost` (a secure context) by
  // default — no extra config needed.
};

export default config;
