/**
 * store/identity.ts — persist the LOCAL identity descriptor for unlock.
 *
 * Stored at rest (IndexedDB, NOT localStorage): only the password-WRAPPED
 * secret key (ciphertext) plus non-sensitive routing ids and the public
 * identity. The plaintext secret key is NEVER persisted — it exists only in the
 * in-memory crypto session after unlock.
 *
 * This is intentionally a small, separate IDB database so identity survives a
 * data-store version bump independently.
 */
import { openDB, type DBSchema } from 'idb';
import type {
  OrgPublicInfo,
  PublicIdentity,
  Qualification,
  Role,
  WrappedSecretKey,
} from '@aidlog/contracts';

export interface StoredIdentity {
  /** singleton key — one local identity per device profile in this scaffold. */
  id: 'self';
  /** Contract role: 'admin' | 'lead' | 'helper'. */
  role: Role;
  orgId: string;
  helperId?: string;
  publicIdentity: PublicIdentity;
  /** password-wrapped secret key (ciphertext only). */
  wrappedSecret: WrappedSecretKey;
  displayName: string;
  /**
   * The account's own Sanitätsdienst qualification (OPERATIONAL, non-health;
   * null/unset = none). Cached here so the documentation editor can gate
   * sections offline. Refreshed from ROUTES.account on login.
   */
  qualification?: Qualification | null;
  /**
   * Cached PUBLIC org identity (public keys only — no secret material) so the
   * documentation editor can seal DEKs to the org even before the first online
   * sync. Refreshed from ROUTES.orgInfo on login.
   */
  orgInfo?: OrgPublicInfo;
}

interface IdentityDB extends DBSchema {
  identity: { key: string; value: StoredIdentity };
}

const DB_NAME = 'aidlog-identity';

function db() {
  return openDB<IdentityDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('identity', { keyPath: 'id' });
    },
  });
}

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  const d = await db();
  await d.put('identity', identity);
}

export async function loadIdentity(): Promise<StoredIdentity | undefined> {
  const d = await db();
  return d.get('identity', 'self');
}

export async function clearIdentity(): Promise<void> {
  const d = await db();
  await d.delete('identity', 'self');
}
