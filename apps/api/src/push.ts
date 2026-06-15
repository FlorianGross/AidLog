/**
 * Web push helper (OPERATIONAL / ADMINISTRATIVE notifications only).
 *
 * PRIVACY-CRITICAL: payloads sent from here carry ONLY generic, content-free
 * text plus a route to open. NEVER patient data, record/deployment content,
 * names, or any identifier that reveals content. Callers pass a fixed
 * `{ title, body, url }` — they MUST NOT thread record data through it.
 *
 * web-push uses VAPID (an Ed25519/ECDSA JWT) only to AUTHENTICATE this
 * application server to the push service; the keys here cannot decrypt any
 * Aidlog content (that is `@aidlog/crypto-core`'s exclusive job). This module
 * therefore lives outside the content-crypto boundary by design.
 *
 * Sending is BEST-EFFORT: a failure never propagates to the action that
 * triggered it. Subscriptions whose endpoint reports 404/410 (gone) are pruned.
 */
import webpush from 'web-push';
import { inArray } from 'drizzle-orm';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { pushSubscriptions } from './db/schema.js';

/** Generic, content-free notification. NO patient/record data may appear here. */
export interface PushMessage {
  title: string;
  body: string;
  /** in-app route to focus/open on click, e.g. "/cosign/". */
  url: string;
}

/** True when all three VAPID values are present (push is enabled). */
export function isPushConfigured(config: AppConfig): boolean {
  return Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT);
}

let vapidConfigured = false;

/** Configure web-push with the VAPID details once per process. */
function ensureVapid(config: AppConfig): boolean {
  if (!isPushConfigured(config)) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(
      config.VAPID_SUBJECT!,
      config.VAPID_PUBLIC_KEY!,
      config.VAPID_PRIVATE_KEY!,
    );
    vapidConfigured = true;
  }
  return true;
}

/**
 * Send a generic, content-free push to every subscription of the given keyIds.
 *
 * Best-effort: returns the number of messages dispatched; never throws into the
 * caller. Dead endpoints (404/410) are pruned from `push_subscriptions`.
 */
export async function sendPushToKeyIds(
  db: Db,
  config: AppConfig,
  keyIds: string[],
  message: PushMessage,
): Promise<number> {
  if (!ensureVapid(config) || keyIds.length === 0) return 0;

  let subs: { id: string; endpoint: string; p256dh: string; auth: string }[];
  try {
    subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.keyId, keyIds));
  } catch {
    return 0;
  }
  if (subs.length === 0) return 0;

  // Fixed, content-free payload. Built here from the caller's generic strings —
  // never from record/patient data.
  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url,
  });

  const deadIds: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) deadIds.push(s.id);
        // Any other error is swallowed — push is best-effort.
      }
    }),
  );

  if (deadIds.length > 0) {
    try {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, deadIds));
    } catch {
      // ignore — pruning is opportunistic.
    }
  }
  return sent;
}
