/**
 * push/index.ts — client helper for WEB PUSH NOTIFICATIONS.
 *
 * Operational/administrative alerts ONLY. Notifications carry generic,
 * content-free text + a route (rendered by src/sw.ts). No patient data, record
 * content, or names ever flow through this channel.
 *
 * Flow:
 *   subscribe()   → request Notification permission
 *                 → GET the server VAPID public key (ROUTES.pushVapidKey)
 *                 → registration.pushManager.subscribe(...)
 *                 → POST the subscription (ROUTES.pushSubscribe)
 *   unsubscribe() → unsubscribe locally + POST removal (ROUTES.pushUnsubscribe)
 *   getStatus()   → support + permission + whether a subscription exists
 *
 * Everything is graceful: unsupported browsers and an unconfigured server
 * (VAPID absent → publicKey null) both yield a clear, non-throwing status.
 */
import { api } from '$lib/api';

export type PushPermission = NotificationPermission; // 'default' | 'granted' | 'denied'

export interface PushStatus {
  /** Browser exposes Service Worker + Push + Notification APIs. */
  supported: boolean;
  /** Server has VAPID configured (a public key is available). */
  serverConfigured: boolean;
  /** Current Notification permission. */
  permission: PushPermission;
  /** A push subscription currently exists for this browser. */
  subscribed: boolean;
}

/** Feature-detect: all three APIs must be present. */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Convert a base64url VAPID key to the Uint8Array the PushManager expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** Current support/permission/subscription status (never throws). */
export async function getStatus(): Promise<PushStatus> {
  const supported = isPushSupported();
  const status: PushStatus = {
    supported,
    serverConfigured: false,
    permission: supported ? Notification.permission : 'denied',
    subscribed: false,
  };
  if (!supported) return status;

  try {
    const { publicKey } = await api.pushVapidKey();
    status.serverConfigured = Boolean(publicKey);
  } catch {
    status.serverConfigured = false;
  }

  const reg = await getRegistration();
  if (reg) {
    try {
      status.subscribed = (await reg.pushManager.getSubscription()) !== null;
    } catch {
      status.subscribed = false;
    }
  }
  return status;
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'not-configured' | 'denied' | 'error' };

/**
 * Request permission, subscribe via the server VAPID key, and register the
 * subscription with the server. Idempotent: reuses an existing subscription.
 */
export async function subscribe(label?: string): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  // Server must have VAPID configured to mint a usable application server key.
  let publicKey: string | null = null;
  try {
    publicKey = (await api.pushVapidKey()).publicKey;
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (!publicKey) return { ok: false, reason: 'not-configured' };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await getRegistration();
  if (!reg) return { ok: false, reason: 'error' };

  try {
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Copy into a fresh ArrayBuffer-backed view so the type is a clean
        // BufferSource (avoids the SharedArrayBuffer union in lib.dom).
        applicationServerKey: urlBase64ToUint8Array(publicKey).slice().buffer,
      }));

    // `toJSON()` yields { endpoint, keys: { p256dh, auth } } — exactly the DTO.
    const json = sub.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, reason: 'error' };
    }

    await api.pushSubscribe({
      subscription: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      },
      ...(label ? { label } : {}),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Unsubscribe this browser locally and remove it server-side (best-effort). */
export async function unsubscribe(): Promise<{ ok: boolean }> {
  const reg = await getRegistration();
  if (!reg) return { ok: false };
  try {
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    try {
      await api.pushUnsubscribe(endpoint);
    } catch {
      // server removal is best-effort; the local unsubscribe already happened.
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
