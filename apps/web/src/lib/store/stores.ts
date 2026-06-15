/**
 * store/stores.ts — reactive Svelte stores for UI state.
 *
 * Three concerns:
 *   - connectivity: online/offline + pending outbox count + last sync.
 *   - session     : a reactive mirror of the in-memory crypto session
 *                   (lock state, role, keyId) — NO secret key material.
 *   - deployments : the list of locally-known deployments for the home screen.
 *
 * These hold only NON-sensitive state. The actual secret keys live solely in
 * `lib/crypto/session` (memory) and are never copied into a store/localStorage.
 */
import { writable, derived, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import type { OrgPublicInfo, Qualification } from '@aidlog/contracts';
import { onSessionChange, onOrgInfoChange, type UnlockedSession } from '../crypto/session';
import { setOwnQualification } from '../qualifications';
import { pendingCount, flush } from './outbox';
import { pull } from './sync';
import { getDB, type DeploymentMeta } from './db';
import { newProtocolId } from '../protocols/marker';
import { api } from '../api';

// --- connectivity -----------------------------------------------------------

export interface Connectivity {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

const connectivityStore = writable<Connectivity>({
  online: browser ? navigator.onLine : true,
  pending: 0,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
});

export const connectivity: Readable<Connectivity> = connectivityStore;

async function refreshPending(): Promise<void> {
  if (!browser) return;
  const pending = await pendingCount();
  connectivityStore.update((c) => ({ ...c, pending }));
}

/**
 * Flush the outbox and pull new records. Safe to call repeatedly; guards
 * against overlap with a `syncing` flag. Requires an authenticated session.
 */
export async function syncNow(): Promise<void> {
  if (!browser) return;
  let busy = false;
  connectivityStore.update((c) => {
    busy = c.syncing;
    return c.syncing ? c : { ...c, syncing: true, lastError: null };
  });
  if (busy) return;

  try {
    if (navigator.onLine) {
      await flush(api);
      await pull(api);
      await loadDeployments();
    }
    connectivityStore.update((c) => ({
      ...c,
      syncing: false,
      lastSyncAt: new Date().toISOString(),
    }));
  } catch (err) {
    connectivityStore.update((c) => ({
      ...c,
      syncing: false,
      lastError: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await refreshPending();
  }
}

/** Wire up online/offline listeners and an initial pending count. Call once. */
export function initConnectivity(): () => void {
  if (!browser) return () => {};
  const goOnline = () => {
    connectivityStore.update((c) => ({ ...c, online: true }));
    void syncNow();
  };
  const goOffline = () => connectivityStore.update((c) => ({ ...c, online: false }));
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  void refreshPending();
  return () => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
  };
}

// --- session ----------------------------------------------------------------

/** Reactive, NON-sensitive view of the lock state. */
export interface SessionView {
  unlocked: boolean;
  role: UnlockedSession['role'] | null;
  keyId: string | null;
  orgId: string | null;
  helperId: string | null;
}

const sessionStore = writable<SessionView>({
  unlocked: false,
  role: null,
  keyId: null,
  orgId: null,
  helperId: null,
});

export const session: Readable<SessionView> = sessionStore;

// Mirror the crypto session lock state into the reactive store WITHOUT copying
// any secret material (only role/keyId/ids).
onSessionChange((s) => {
  sessionStore.set(
    s
      ? {
          unlocked: true,
          role: s.role,
          keyId: s.keyId,
          orgId: s.orgId,
          helperId: s.helperId ?? null,
        }
      : { unlocked: false, role: null, keyId: null, orgId: null, helperId: null },
  );
  // Wipe the cached own-qualification on lock (re-seeded on the next account load).
  if (!s) setOwnQualification(null);
});

export const isUnlocked = derived(session, ($s) => $s.unlocked);

/** Derived role helpers for role-aware UI (drawer items, route guards). */
export const isAdmin = derived(session, ($s) => $s.role === 'admin');
/** Lead OR admin — i.e. may VIEW user management & org-wide deployments. */
export const isLeadOrAdmin = derived(session, ($s) => $s.role === 'admin' || $s.role === 'lead');

// --- org public identity ----------------------------------------------------

/**
 * Reactive mirror of the cached org PUBLIC info (public keys only). Exposed so
 * the documentation editor can read the org identity to seal DEKs to the org.
 * Non-secret; wiped on lock.
 */
const orgInfoStore = writable<OrgPublicInfo | null>(null);
export const orgInfo: Readable<OrgPublicInfo | null> = orgInfoStore;
onOrgInfoChange((info) => orgInfoStore.set(info));

// --- deployments ------------------------------------------------------------

const deploymentsStore = writable<DeploymentMeta[]>([]);
export const deployments: Readable<DeploymentMeta[]> = deploymentsStore;

export async function loadDeployments(): Promise<void> {
  if (!browser) return;
  const db = await getDB();
  const all = await db.getAll('deployments');
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  deploymentsStore.set(all);
}

export async function createDeployment(
  title: string,
  categoryId?: string,
  training?: boolean,
  kind?: 'event' | 'single',
): Promise<DeploymentMeta> {
  const db = await getDB();
  const meta: DeploymentMeta = {
    deploymentId: globalThis.crypto.randomUUID(),
    title,
    createdAt: new Date().toISOString(),
    status: 'open',
    recordCount: 0,
    ...(categoryId ? { categoryId } : {}),
    ...(training ? { training: true } : {}),
    ...(kind ? { kind } : {}),
  };
  await db.put('deployments', meta);
  await loadDeployments();
  return meta;
}

export async function getDeployment(id: string): Promise<DeploymentMeta | undefined> {
  const db = await getDB();
  return db.get('deployments', id);
}

/**
 * Create a `kind:'single'` deployment that holds exactly ONE standalone patient
 * protocol (Einzelprotokoll ohne Veranstaltung) and mint that protocol's id, so
 * the caller can route straight to its capture page. The deployment still uses
 * the normal record chain + draft model — only the UI is decluttered (the hub is
 * skipped for single deployments). Returns both ids.
 */
export async function startSingleProtocol(
  title: string,
  categoryId?: string,
  training?: boolean,
): Promise<{ deploymentId: string; protocolId: string }> {
  const meta = await createDeployment(title, categoryId, training, 'single');
  return { deploymentId: meta.deploymentId, protocolId: newProtocolId() };
}

/**
 * Merge a partial patch into a deployment's local meta, persist it, and reload
 * the reactive list. Used for the optional VERANSTALTUNGS-STAMMDATEN (Ort,
 * Zeitraum, Art, Besucher, Veranstalter, Einsatzleiter) which live LOCALLY PER
 * DEVICE on the DeploymentMeta — non-sensitive operational metadata only.
 * No-ops if the deployment is unknown. Returns the updated meta (or undefined).
 */
export async function updateDeploymentMeta(
  id: string,
  patch: Partial<DeploymentMeta>,
): Promise<DeploymentMeta | undefined> {
  const db = await getDB();
  const meta = await db.get('deployments', id);
  if (!meta) return undefined;
  // Never let a patch rewrite the identity/chain-relevant fields.
  const next: DeploymentMeta = {
    ...meta,
    ...patch,
    deploymentId: meta.deploymentId,
    createdAt: meta.createdAt,
  };
  await db.put('deployments', next);
  await loadDeployments();
  return next;
}

export async function bumpDeploymentCount(id: string): Promise<void> {
  const db = await getDB();
  const meta = await db.get('deployments', id);
  if (meta) {
    await db.put('deployments', { ...meta, recordCount: meta.recordCount + 1 });
    await loadDeployments();
  }
}

// --- org info fetch/cache ----------------------------------------------------

/**
 * Fetch the org PUBLIC info from the server and cache it in the in-memory
 * session (and persist the public copy alongside the stored identity so it
 * survives an offline relaunch). Best-effort: silently no-ops when offline.
 */
export async function fetchAndCacheOrgInfo(): Promise<OrgPublicInfo | null> {
  if (!browser || !navigator.onLine) return null;
  try {
    const info = await api.orgInfo();
    cacheOrgInfo(info);
    // Persist the public copy next to the local identity (public keys only).
    const { loadIdentity, saveIdentity } = await import('./identity');
    const stored = await loadIdentity();
    if (stored) await saveIdentity({ ...stored, orgInfo: info });
    return info;
  } catch {
    return null;
  }
}

/**
 * Seed the cached OWN qualification from a locally-stored value (offline path),
 * then best-effort refresh it from the server (ROUTES.account) and persist it
 * next to the local identity. Call right after unlock. Operational metadata only.
 */
export async function loadOwnQualification(seed?: Qualification | null): Promise<void> {
  if (!browser) return;
  if (seed !== undefined) setOwnQualification(seed ?? null);
  if (!navigator.onLine) return;
  try {
    const account = await api.getOwnAccount();
    setOwnQualification(account.qualification);
    // Persist the public copy next to the local identity so it survives offline.
    const { loadIdentity, saveIdentity } = await import('./identity');
    const stored = await loadIdentity();
    if (stored) await saveIdentity({ ...stored, qualification: account.qualification });
  } catch {
    /* offline or unreachable — the seeded value (if any) stands */
  }
}

/** Push a known org info into the in-memory cache + reactive store. */
export function cacheOrgInfo(info: OrgPublicInfo): void {
  // Lazy import to avoid a static cycle with the crypto session module.
  void import('../crypto/session').then((m) => m.setOrgInfo(info));
}

/**
 * The cached org PUBLIC identity, or null if not yet known. Synchronous accessor
 * for the documentation editor to seal per-record DEKs to the org:
 *
 *   import { getOrgIdentity } from '$lib/store';
 *   const org = getOrgIdentity() ?? session.publicIdentity; // fallback to self
 *
 * Re-exported from the crypto session (single source of truth, memory only).
 */
export { getOrgIdentity, getOrgInfo } from '../crypto/session';

// --- dashboard counts --------------------------------------------------------

export interface DashboardStats {
  openDeployments: number;
  totalDeployments: number;
  recordsToday: number;
  /** Server count of cosign requests awaiting MY signature (null if offline). */
  pendingCosign: number | null;
}

/**
 * Compute dashboard stats. Local counts come from IndexedDB; the pending-cosign
 * count needs the server (ROUTES.cosignRequests) and is null when offline.
 */
export async function loadDashboardStats(): Promise<DashboardStats> {
  const db = await getDB();
  const all = await db.getAll('deployments');
  const today = new Date().toISOString().slice(0, 10);
  const records = await db.getAll('records');
  const recordsToday = records.filter((r) => r.createdAt?.slice(0, 10) === today).length;

  let pendingCosign: number | null = null;
  if (browser && navigator.onLine) {
    try {
      const reqs = await api.myCosignRequests();
      pendingCosign = reqs.length;
    } catch {
      pendingCosign = null;
    }
  }

  return {
    openDeployments: all.filter((d) => d.status === 'open').length,
    totalDeployments: all.length,
    recordsToday,
    pendingCosign,
  };
}
