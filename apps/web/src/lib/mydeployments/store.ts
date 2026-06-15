/**
 * mydeployments/store.ts — small reactive store backing the "Meine Einsätze"
 * page. Triggers a sync first (so the cross-device records + the server list are
 * up to date), fetches the server summaries, then merges them with local meta +
 * a best-effort record decrypt (see loader.ts). Holds only NON-secret display
 * state; the secret identity stays in the in-memory crypto session.
 */
import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { api } from '$lib/api';
import { getSession } from '$lib/crypto';
import { syncNow } from '$lib/store';
import { buildEntries, type MyDeploymentEntry } from './loader';

export interface MyDeploymentsState {
  loading: boolean;
  /** True once a load attempt has completed (success or handled error). */
  loaded: boolean;
  entries: MyDeploymentEntry[];
  /** True when the load failed because the device is offline / server unreachable. */
  offline: boolean;
  error: string | null;
}

const initial: MyDeploymentsState = {
  loading: false,
  loaded: false,
  entries: [],
  offline: false,
  error: null,
};

const store = writable<MyDeploymentsState>(initial);
export const myDeployments: Readable<MyDeploymentsState> = store;

/**
 * Load (or reload) the list. Pulls records first so the read-only views have
 * data and the decrypt-based label recovery has something to work with, then
 * fetches the server summaries and merges. Safe to call on mount.
 */
export async function loadMyDeployments(): Promise<void> {
  if (!browser) return;
  const session = getSession();
  if (!session) {
    store.set({ ...initial, loaded: true });
    return;
  }

  store.update((s) => ({ ...s, loading: true, error: null, offline: false }));

  // Best-effort sync first so the cross-device records (sealed to us via the
  // 'author' wrapper) are present locally. Failure here is non-fatal — we still
  // try the list endpoint and fall back to whatever is cached.
  try {
    await syncNow();
  } catch {
    /* offline / sync error — continue with cached data */
  }

  try {
    const res = await api.myDeployments();
    const entries = await buildEntries(res.deployments, session.identity);
    store.set({ loading: false, loaded: true, entries, offline: false, error: null });
  } catch (err) {
    const offline = browser && !navigator.onLine;
    store.set({
      loading: false,
      loaded: true,
      entries: [],
      offline,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
