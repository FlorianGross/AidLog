import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

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
        'connect-src': ['self'],
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
