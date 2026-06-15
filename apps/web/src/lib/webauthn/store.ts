/**
 * webauthn/store.ts — device-local persistence of passkey unlock wrappers.
 *
 * SECURITY: the only thing stored here is CIPHERTEXT — a {@link WrappedSecretKey}
 * produced by `crypto.wrapIdentityWithKey(identity, prfSecret)` where the
 * 32-byte key is the WebAuthn PRF output. The PRF secret itself is NEVER
 * persisted (it lives in memory only and is zeroed after wrap/unwrap). Without
 * the authenticator (which re-derives the PRF secret on `get`), the stored
 * wrapper is useless. We keep the credentialId so we can scope a later
 * `navigator.credentials.get` to exactly the passkeys registered on this device.
 *
 * This is a SEPARATE IndexedDB database from `aidlog-identity` so a passkey can
 * be added/removed without touching the primary identity record.
 */
import { openDB, type DBSchema } from 'idb';
import type { WrappedSecretKey } from '@aidlog/contracts';

export interface StoredPasskey {
  /** base64url of the raw WebAuthn credential id (also the IDB primary key). */
  credentialId: string;
  /** Human label for the UI (e.g. the device/browser at registration time). */
  label: string;
  /** PRF-key-wrapped identity secret (ciphertext only — never the PRF secret). */
  prfWrappedSecret: WrappedSecretKey;
  /** ISO 8601 registration timestamp. */
  createdAt: string;
}

interface PasskeyDB extends DBSchema {
  passkeys: { key: string; value: StoredPasskey };
}

const DB_NAME = 'aidlog-passkeys';

function db() {
  return openDB<PasskeyDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('passkeys', { keyPath: 'credentialId' });
    },
  });
}

export async function savePasskey(pk: StoredPasskey): Promise<void> {
  const d = await db();
  await d.put('passkeys', pk);
}

export async function listPasskeys(): Promise<StoredPasskey[]> {
  const d = await db();
  return d.getAll('passkeys');
}

export async function getPasskey(credentialId: string): Promise<StoredPasskey | undefined> {
  const d = await db();
  return d.get('passkeys', credentialId);
}

export async function deletePasskey(credentialId: string): Promise<void> {
  const d = await db();
  await d.delete('passkeys', credentialId);
}

export async function hasAnyPasskey(): Promise<boolean> {
  const d = await db();
  return (await d.count('passkeys')) > 0;
}
