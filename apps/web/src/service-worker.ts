/**
 * sw.ts — custom service worker (injectManifest strategy).
 *
 * Built by `@vite-pwa/sveltekit` in `injectManifest` mode (see vite.config.ts).
 * It KEEPS the existing offline-first behaviour — the workbox precache of the
 * app shell is restored verbatim via `precacheAndRoute(self.__WB_MANIFEST)` —
 * and ADDS web push handlers on top:
 *
 *   - `push`:            show a GENERIC, content-free notification.
 *   - `notificationclick`: focus an existing client or open the carried route.
 *
 * PRIVACY: this worker renders ONLY what the server sent, which is by contract
 * generic operational text + a route (see apps/api/src/push.ts). It never reads
 * or displays patient/record data — there is none in the payload. Runtime data
 * stays encrypted in IndexedDB; nothing sensitive is cached by this SW.
 *
 * The libsodium WASM precache is unaffected: it is matched by the same
 * `globPatterns` (the wasm glob) and lands in `self.__WB_MANIFEST` exactly as
 * before; we do not change caching behaviour, only add push.
 */
/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/info" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// --- offline precache (unchanged behaviour vs. generateSW) -----------------
// `self.__WB_MANIFEST` is injected at build time by workbox-build with the same
// `globPatterns` the previous generateSW config used. This restores the
// app-shell + WASM precache one-to-one.
precacheAndRoute(self.__WB_MANIFEST);

// Take control as soon as possible so push works after the first load, matching
// the previous `registerType: 'autoUpdate'` semantics.
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Generic, content-free notification payload (mirrors apps/api/src/push.ts). */
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

// --- push: render a generic notification -----------------------------------
self.addEventListener('push', (event: PushEvent) => {
  let data: PushPayload = {};
  try {
    if (event.data) data = event.data.json() as PushPayload;
  } catch {
    // Non-JSON or empty payload — fall back to a neutral default below.
  }
  const title = data.title || 'Aidlog';
  const body = data.body || '';
  const url = data.url || '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // Neutral tag so repeated operational alerts collapse rather than stack.
      tag: 'aidlog-operational',
      data: { url },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});

// --- notificationclick: focus an open tab or open the route ----------------
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string };
  const targetPath = data.url || '/';

  event.waitUntil(
    (async () => {
      const targetUrl = new URL(targetPath, self.location.origin).href;
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Prefer focusing an already-open app window and navigating it.
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && new URL(client.url).pathname !== targetPath) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // navigation may be blocked cross-origin in some browsers — ignore.
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })(),
  );
});
