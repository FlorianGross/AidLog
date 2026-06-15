/**
 * supervisors/store.ts — fetch + cache the org's SUPERVISOR public identities.
 *
 * So that an Einsatzleiter (lead) or Admin can later read a deployment's
 * statistics, NEW records are additionally sealed to every active supervisor
 * (admin + lead). This module fetches those PUBLIC identities from
 * `GET ROUTES.orgSupervisors` and caches them so offline record-creation still
 * has the list. Public keys ONLY — nothing secret is fetched/cached/persisted.
 *
 * Transport is self-contained (reuses the api client's bearer token), mirroring
 * `$lib/schemas/store` and `$lib/categories/store`, so this module does not
 * require new methods on api.ts. Forward-only: it never re-seals old records.
 *
 * GRACEFUL DEGRADATION: if the endpoint is unavailable (offline, not deployed)
 * and no cache exists, `getCachedSupervisors()` returns []. `finalize.ts` then
 * seals to org (+helper) only — the record is still valid, just not yet readable
 * by supervisors. The next record created online will pick the list up.
 */
import { browser } from '$app/environment';
import {
  ROUTES,
  type PublicIdentity,
  type Role,
  type SupervisorListResponse,
  type SupervisorRecipient,
} from '@aidlog/contracts';
import { api } from '$lib/api';
import { getApiBase } from '$lib/config/serverUrl';

const CACHE_KEY = 'aidlog-org-supervisors';

let cache: SupervisorRecipient[] = [];

function apiBase(): string {
  return getApiBase();
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = api.getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function isPublicIdentity(v: unknown): v is PublicIdentity {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as PublicIdentity).keyId === 'string' &&
    typeof (v as PublicIdentity).boxPublicKey === 'string' &&
    typeof (v as PublicIdentity).signPublicKey === 'string'
  );
}

function isSupervisor(v: unknown): v is SupervisorRecipient {
  return (
    !!v &&
    typeof v === 'object' &&
    isPublicIdentity((v as SupervisorRecipient).identity) &&
    typeof (v as SupervisorRecipient).role === 'string'
  );
}

function readCache(): SupervisorRecipient[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isSupervisor) : [];
  } catch {
    return [];
  }
}

function writeCache(list: SupervisorRecipient[]): void {
  cache = list;
  if (!browser) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — non-fatal, the in-memory cache still holds it */
  }
}

/**
 * Load supervisors: localStorage cache first (instant, offline), then the server
 * (authoritative) if reachable. Safe to call repeatedly. Returns the freshest
 * list it could obtain (cache on failure). Any authenticated user may call this.
 */
export async function loadSupervisors(): Promise<SupervisorRecipient[]> {
  if (cache.length === 0) cache = readCache();
  try {
    const res = await fetch(apiBase() + ROUTES.orgSupervisors, { headers: authHeaders() });
    if (res.ok) {
      const body = (await res.json()) as SupervisorListResponse | null;
      const list = body?.supervisors?.filter(isSupervisor) ?? [];
      writeCache(list);
      return list;
    }
  } catch {
    /* offline or endpoint not deployed — keep cache */
  }
  return cache;
}

/**
 * The cached supervisor list (in-memory, hydrated from localStorage on first
 * access). Synchronous — used by `finalize.ts` so record-creation never blocks
 * on the network. Empty when the list has never been fetched/cached.
 */
export function getCachedSupervisors(): SupervisorRecipient[] {
  if (cache.length === 0) cache = readCache();
  return cache;
}

/** Drop the in-memory + persisted supervisor cache (e.g. on lock/logout). */
export function clearSupervisorCache(): void {
  cache = [];
  if (browser) {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export type { SupervisorRecipient, Role };
