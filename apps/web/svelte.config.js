import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * CSP `connect-src` for the API.
 *
 * The WEB/PWA build is same-origin: the API lives at `/api` on the same host,
 * so `'self'` is sufficient and the directive stays EXACTLY `['self']`.
 *
 * A NATIVE (Capacitor) build is different: the WebView serves the bundled
 * static shell from a LOCAL origin (Android `https://localhost`, iOS
 * `capacitor://localhost`) while the API lives on a REMOTE host. That remote
 * host is therefore CROSS-ORIGIN, and the browser would block every `fetch`
 * unless its origin is in `connect-src`. The native build sets the remote API
 * via `VITE_API_BASE_URL` (same var the app uses to point `fetch` at the API),
 * so we read it here and append ONLY that origin.
 *
 * RUNTIME server configuration (VITE_RUNTIME_API_CONFIG): a build can instead
 * let the USER pick the API server on first start (so a SINGLE native binary can
 * point at any self-hosted host without a rebuild). That origin is unknown here,
 * so we widen `connect-src` to accept ANY `https:` origin (TLS enforced; a native
 * WebView runs from a secure context and blocks plain-http cross-origin anyway).
 *
 * When NEITHER var is set (the normal web/PWA build) `connect-src` is byte-for-
 * byte unchanged: just `['self']`. The parse is defensive — invalid values are
 * ignored rather than breaking the build.
 */
const connectSrc = ['self'];
const apiBaseUrl = process.env.VITE_API_BASE_URL;
if (apiBaseUrl) {
  try {
    connectSrc.push(new URL(apiBaseUrl).origin);
  } catch {
    // Invalid VITE_API_BASE_URL — ignore and keep connect-src at 'self'.
  }
}
const runtimeApiConfig = process.env.VITE_RUNTIME_API_CONFIG;
if (runtimeApiConfig === '1' || runtimeApiConfig === 'true') {
  // The server origin is chosen at runtime; allow any HTTPS origin.
  connectSrc.push('https:');
}

/**
 * SvelteKit config.
 *
 * We use `adapter-static` because Aidlog is an offline-first PWA: the whole app
 * shell is a static bundle that the service worker precaches, and ALL dynamic
 * data flows through the client-side crypto + IndexedDB layer (never SSR — the
 * server is a blind sync store and must never see plaintext). `fallback`
 * enables SPA routing for dynamic routes like /deployment/[id].
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // Distinct fallback name so the SPA fallback does not overwrite the
      // prerendered home `index.html`. Configure the host to serve this for
      // unknown client-side routes (e.g. /deployment/[id]).
      fallback: '200.html',
      precompress: false,
      strict: false,
    }),
    // Web push: the SW lives in src/service-worker.ts and is compiled by
    // SvelteKit, but REGISTRATION is delegated to @vite-pwa/sveltekit (which
    // injects the workbox precache manifest and emits registerSW). Disabling
    // SvelteKit's own auto-registration avoids registering the worker twice.
    serviceWorker: {
      register: false,
    },
    // Content-Security-Policy is owned HERE, not by Caddy, because SvelteKit
    // emits a small inline bootstrap <script> (kit.start). `mode: 'hash'` makes
    // SvelteKit compute that script's SHA-256 each build and add it to
    // script-src automatically (injected via a <meta> tag on the prerendered
    // pages). A static Caddy header cannot do this — its hash would go stale on
    // every rebuild. Caddy keeps the non-CSP security headers + frame-ancestors
    // coverage via X-Frame-Options. `wasm-unsafe-eval` is required for the
    // libsodium WebAssembly module.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self', 'wasm-unsafe-eval'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'blob:', 'data:'],
        'font-src': ['self'],
        // 'self' for the same-origin web/PWA build; a native/cross-origin build
        // appends either the fixed VITE_API_BASE_URL origin or — for runtime
        // server configuration — any `https:` origin (see derivation above).
        'connect-src': connectSrc,
        'worker-src': ['self', 'blob:'],
        'manifest-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
      },
    },
  },
};

export default config;
