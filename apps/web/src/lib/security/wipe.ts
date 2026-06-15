/**
 * security/wipe.ts — local device wipe ("panic" / offboarding-on-device).
 *
 * Removes ALL app data at rest from this device and wipes the in-memory crypto
 * session, then returns so the caller can redirect to a clean entry route.
 *
 * Resilience: every step is best-effort and isolated — one failing deletion
 * (e.g. a locked IndexedDB connection) never aborts the rest of the wipe. The
 * function NEVER throws.
 *
 * Completeness: the IndexedDB database names and storage keys below are
 * enumerated from the store modules that own them. Keep this list in sync if a
 * new persistence site is added:
 *   - IndexedDB 'aidlog'           → store/db.ts          (outbox, records, chainHeads, deployments)
 *   - IndexedDB 'aidlog-identity'  → store/identity.ts    (wrapped secret key + public identity)
 *   - IndexedDB 'aidlog-passkeys'  → webauthn/store.ts    (PRF-wrapped unlock wrappers)
 *   - IndexedDB 'aidlog-drafts'    → doc/draftStore.ts    (in-progress documentation drafts)
 *   - localStorage 'aidlog-active-schema' → schemas/store.ts (field-definition cache)
 *   - localStorage 'aidlog-security'      → security/settings.ts (this device's prefs)
 *   - sessionStorage 'aidlog.session-token' → api.ts (cleared via api.setToken(null))
 *
 * NOTE: the theme preference ('aidlog-theme') is intentionally LEFT in place —
 * it is purely cosmetic and not account data.
 */
import { lock } from '$lib/crypto';
import { api } from '$lib/api';
import { SECURITY_SETTINGS_KEY } from './settings';

/** All app IndexedDB databases that hold account/offline data. */
const IDB_DATABASES = ['aidlog', 'aidlog-identity', 'aidlog-passkeys', 'aidlog-drafts'] as const;

/** App localStorage keys to remove. The theme key is deliberately excluded. */
const LOCAL_STORAGE_KEYS = ['aidlog-active-schema', SECURITY_SETTINGS_KEY] as const;

/** Delete a single IndexedDB database, resolving even if it is blocked. */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    let settled = false;
    const done = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = done;
      req.onerror = done;
      // `blocked` fires when another tab holds an open connection; resolve so
      // the wipe completes — the OS clears the DB once connections close.
      req.onblocked = done;
    } catch {
      done();
    }
  });
}

/** Best-effort: remove every cache and unregister all service workers. */
async function clearCachesAndServiceWorkers(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }
  } catch {
    /* Cache Storage unavailable — ignore. */
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch {
    /* No SW registrations — ignore. */
  }
}

/**
 * Wipe this device: lock the session, clear the auth token, delete all app
 * IndexedDB databases, remove app localStorage keys, and clear Cache Storage /
 * service workers. Best-effort and resilient; never throws.
 *
 * The caller is responsible for the subsequent navigation (e.g. to '/login/' or
 * '/setup/') once this resolves.
 */
export async function wipeDevice(): Promise<void> {
  // 1. Wipe in-memory secret material FIRST so a mid-wipe failure still leaves
  //    no decrypted keys around.
  try {
    lock();
  } catch {
    /* ignore */
  }
  try {
    api.setToken(null);
  } catch {
    /* ignore */
  }

  // 2. Delete all app IndexedDB databases (best-effort, in parallel).
  await Promise.all(IDB_DATABASES.map((name) => deleteDatabase(name)));

  // 3. Remove app localStorage keys (theme intentionally retained).
  try {
    if (typeof localStorage !== 'undefined') {
      for (const key of LOCAL_STORAGE_KEYS) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore individual key */
        }
      }
    }
  } catch {
    /* localStorage unavailable — ignore */
  }

  // 4. Belt-and-braces: clear any tab-scoped session token storage.
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  } catch {
    /* ignore */
  }

  // 5. Clear Cache Storage + unregister service workers.
  await clearCachesAndServiceWorkers();
}

/** The IndexedDB database names this wipe deletes (for diagnostics/tests). */
export const WIPED_IDB_DATABASES = IDB_DATABASES;
/** The localStorage keys this wipe removes (for diagnostics/tests). */
export const WIPED_LOCAL_STORAGE_KEYS = LOCAL_STORAGE_KEYS;
