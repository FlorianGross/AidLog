-- 0013_author_recipient.sql
-- Adds the 'author' recipient type to sealed_keys.
-- See packages/contracts/src/index.ts (RecipientType), the author-retention seal
-- in apps/web/src/lib/crypto/record.ts (buildRecord), the self-scope delivery in
-- apps/api/src/routes/sync.ts, and the "Meine Einsätze" feature
-- (apps/api/src/routes/my.ts + apps/web/src/routes/meine-einsaetze/).
--
-- WHY: so a helper retains read access to records THEY documented PERMANENTLY and
-- across devices, NEW records are additionally sealed (client-side) to the
-- author's OWN public identity with recipientType 'author'. Unlike the transient
-- 'helper' wrapper (deleted at shift close), the 'author' wrapper is NEVER
-- deleted by shift-close (apps/api/src/routes/shifts.ts only targets 'helper'),
-- so the author keeps decryption capability after the shift ends. The DEK wrapper
-- is opaque crypto_box_seal ciphertext — exactly like the existing 'org'/'helper'/
-- 'cosigner'/'supervisor' wrappers — so this is NOT patient data and NOT a secret
-- the server can read. We only RELAX the recipient_type CHECK to admit the new
-- member; no new table, and the append-only `records` table is UNTOUCHED.
--
-- Mirrors 0008's pattern (which added 'supervisor'): drop the existing CHECK IF
-- EXISTS and re-add it with the full 5-member set.

ALTER TABLE sealed_keys DROP CONSTRAINT IF EXISTS sealed_keys_recipient_type_check;
ALTER TABLE sealed_keys
  ADD CONSTRAINT sealed_keys_recipient_type_check
  CHECK (recipient_type IN ('org', 'helper', 'cosigner', 'supervisor', 'author'));
