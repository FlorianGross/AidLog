-- 0005_push.sql
-- Web push subscriptions for OPERATIONAL / ADMINISTRATIVE notifications only.
--
-- See packages/contracts/src/index.ts (PushSubscriptionDTO, RegisterPushRequest)
-- and apps/api/src/routes/push.ts.
--
-- PRIVACY invariants preserved:
--   * A row is OPERATIONAL METADATA: the browser's push endpoint URL plus the
--     public keys the BROWSER published so the push service can encrypt the
--     message. It is NOT patient data, a DEK, a password, or a secret key of
--     ours. The server NEVER decrypts content and NEVER sends content-bearing
--     payloads — only generic, content-free text + a route (enforced in the
--     route/helper code, which builds fixed strings, not record data).
--   * `records` stays append-only and is UNTOUCHED by this migration.
--
-- The app role gets SELECT/INSERT/DELETE (subscribe stores, unsubscribe and
-- pruning of dead endpoints delete). No UPDATE is needed.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- KeyId of the subscribing user — who receives the notification.
  key_id       text NOT NULL,
  org_id       uuid NOT NULL REFERENCES orgs(org_id) ON DELETE RESTRICT,
  -- Push service endpoint URL — globally unique per browser subscription.
  endpoint     text NOT NULL UNIQUE,
  -- base64url P-256 ECDH public key published by the browser.
  p256dh       text NOT NULL,
  -- base64url auth secret published by the browser (RFC 8291).
  auth         text NOT NULL,
  -- optional human-readable device label.
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_key_idx ON push_subscriptions(key_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_org_idx ON push_subscriptions(org_id);

-- ---------------------------------------------------------------------------
-- Least-privilege grants for the application role.
--   SELECT  — look up subscriptions when sending.
--   INSERT  — store a new subscription on subscribe.
--   DELETE  — remove on unsubscribe and prune dead (404/410) endpoints.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aidlog_app') THEN
    GRANT SELECT, INSERT, DELETE ON push_subscriptions TO aidlog_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aidlog_app;
  END IF;
END
$$;
