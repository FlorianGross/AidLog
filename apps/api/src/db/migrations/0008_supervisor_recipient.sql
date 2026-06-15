-- 0008_supervisor_recipient.sql
-- Adds the 'supervisor' recipient type to sealed_keys.
-- See packages/contracts/src/index.ts (RecipientType, SupervisorRecipient,
-- SupervisorListResponse, ROUTES.orgSupervisors) and
-- apps/api/src/routes/supervisors.ts + the scope=org sync path in
-- apps/api/src/routes/sync.ts.
--
-- WHY: so that an Einsatzleiter/Admin can read a deployment's statistics, NEW
-- records are additionally sealed (client-side) to every active supervisor
-- (admin + lead) with recipientType 'supervisor'. The DEK wrapper is opaque
-- crypto_box_seal ciphertext — exactly like the existing 'org'/'helper'/
-- 'cosigner' wrappers — so this is NOT patient data and NOT a secret the server
-- can read. We only RELAX the recipient_type CHECK to admit the new member; no
-- new table, and the append-only `records` table is UNTOUCHED.
--
-- Mirrors 0002's pattern (which added 'cosigner'): drop the existing CHECK IF
-- EXISTS and re-add it with the full 4-member set.

ALTER TABLE sealed_keys DROP CONSTRAINT IF EXISTS sealed_keys_recipient_type_check;
ALTER TABLE sealed_keys
  ADD CONSTRAINT sealed_keys_recipient_type_check
  CHECK (recipient_type IN ('org', 'helper', 'cosigner', 'supervisor'));
