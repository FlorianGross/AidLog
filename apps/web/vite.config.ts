import { createRequire } from 'node:module';
import { resolve as resolvePath } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';
import { branding } from './src/lib/branding';

// Vitest sets NODE_ENV/mode to 'test'. We use that to apply the `browser`
// resolve condition ONLY for tests, so component tests get Svelte's client
// build (`mount`) without changing how the production app is built/prerendered.
const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

// ---------------------------------------------------------------------------
// libsodium ESM workaround (BUILD NOTE from the task brief).
//
// The published ESM build of `libsodium-wrappers-sumo@0.7.16` is BROKEN: its
// `dist/modules-sumo-esm/libsodium-wrappers.mjs` imports a sibling
// `./libsodium-sumo.mjs` that the package does NOT ship (only the CommonJS
// build is complete). Vite would otherwise try to load the ESM entry and fail
// at dev/build time. We mirror what `packages/crypto-core/vitest.config.ts`
// does: alias the bare specifier to the working CJS entry.
//
// `crypto-core` is the only package that imports this primitive, but the alias
// must live wherever the bundler resolves the dependency graph — i.e. here in
// the app that bundles crypto-core. The library is import-style-agnostic at
// runtime, so pointing at the CJS file is safe.
// ---------------------------------------------------------------------------
const require = createRequire(import.meta.url);
// `require.resolve` honours the package `exports` map and lands on the
// `require`/`default` condition -> the complete CJS file.
const sumoCjs = resolvePath(require.resolve('libsodium-wrappers-sumo'));

export default defineConfig({
  optimizeDeps: {
    // Pre-bundle the CJS build so the WASM init works in the dev server too.
    include: ['libsodium-wrappers-sumo'],
  },
  ssr: {
    // crypto-core pulls in the libsodium CJS bundle; keep it bundled rather
    // than treated as an external ESM import during SSR/prerender.
    noExternal: ['@aidlog/crypto-core', 'libsodium-wrappers-sumo'],
  },
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      // We switched from `generateSW` to `injectManifest` so the service worker
      // can handle `push` + `notificationclick` for WEB PUSH NOTIFICATIONS
      // (operational/administrative alerts only — never patient data; see
      // src/service-worker.ts and apps/api/src/push.ts). The custom worker KEEPS the
      // offline-first precache via `precacheAndRoute(self.__WB_MANIFEST)`, so
      // the app shell + libsodium WASM still boot with no connectivity.
      strategies: 'injectManifest',
      // The SW source is SvelteKit's reserved `src/service-worker.ts`, which
      // SvelteKit compiles to `service-worker.js` in the client output. The PWA
      // plugin then injects the workbox precache manifest into that file.
      srcDir: 'src',
      filename: 'service-worker.ts',
      // Offline-first: precache the app shell so the field client boots with
      // no connectivity. Runtime data lives encrypted in IndexedDB (see
      // src/lib/store), never in the SW cache as plaintext. Same globs as the
      // previous generateSW config so the precache (incl. WASM) is unchanged.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        // libsodium WASM can be large; lift the precache size ceiling.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: branding.appName,
        short_name: branding.appShortName,
        description: branding.appDescription,
        // Neutral, vendor-agnostic theming — see src/lib/branding.ts.
        theme_color: branding.themeColor,
        background_color: branding.backgroundColor,
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          // Placeholder neutral icons — replace with real assets in static/.
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        // Allow testing the SW in `vite dev` without a production build.
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,js}'],
    server: {
      deps: {
        // Svelte 5 ships separate server/client builds; testing-library/svelte
        // must resolve the CLIENT build (`mount` is unavailable server-side).
        inline: ['@testing-library/svelte'],
      },
    },
  },
  resolve: {
    alias: {
      'libsodium-wrappers-sumo': sumoCjs,
    },
    ...(isTest ? { conditions: ['browser'] } : {}),
  },
});
