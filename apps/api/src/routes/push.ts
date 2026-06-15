/**
 * Web push subscription management (OPERATIONAL notifications only).
 *
 *   GET  /api/push/vapid        public VAPID key   (auth) → { publicKey }
 *   POST /api/push/subscribe    store subscription (auth) → { ok }
 *   POST /api/push/unsubscribe  remove subscription(auth) → { ok }
 *
 * PRIVACY: a subscription is operational metadata (browser endpoint + the public
 * keys the browser itself published). The server stores no patient data here and
 * only ever sends generic, content-free payloads (see ../push.ts). When VAPID is
 * not configured, the endpoints degrade gracefully: vapid returns
 * { publicKey: null } and subscribe/unsubscribe report "not configured".
 */
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ROUTES, type PushVapidKeyResponse } from '@aidlog/contracts';
import { registerPushSchema, unsubscribePushSchema } from '../validation.js';
import { pushSubscriptions } from '../db/schema.js';
import { isPushConfigured } from '../push.js';
import { badRequest, sendError } from '../errors.js';

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;

  // --- public VAPID key (null when push is disabled) ----------------------
  app.get(ROUTES.pushVapidKey, { preHandler: app.requireAuth }, async () => {
    const body: PushVapidKeyResponse = {
      publicKey: isPushConfigured(config) ? config.VAPID_PUBLIC_KEY! : null,
    };
    return body;
  });

  // --- store the caller's subscription ------------------------------------
  app.post(ROUTES.pushSubscribe, { preHandler: app.requireAuth }, async (req, reply) => {
    if (!isPushConfigured(config)) {
      return reply
        .code(503)
        .send({ error: 'push notifications are not configured', code: 'push_not_configured' });
    }
    const parsed = registerPushSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid push subscription', parsed.error.issues));
    const { subscription, label } = parsed.data;
    const session = req.session!;

    // Upsert by endpoint: re-subscribing the same browser updates ownership +
    // keys rather than erroring on the unique endpoint constraint.
    await db
      .insert(pushSubscriptions)
      .values({
        keyId: session.keyId,
        orgId: session.orgId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        label: label ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          keyId: session.keyId,
          orgId: session.orgId,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          label: label ?? null,
        },
      });

    return reply.code(201).send({ ok: true });
  });

  // --- remove a subscription (this caller's, by endpoint) -----------------
  app.post(ROUTES.pushUnsubscribe, { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = unsubscribePushSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid unsubscribe request', parsed.error.issues));
    const session = req.session!;
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, parsed.data.endpoint),
          eq(pushSubscriptions.keyId, session.keyId),
        ),
      );
    return reply.send({ ok: true });
  });
}
