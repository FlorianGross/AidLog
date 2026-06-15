/**
 * categories/store.ts — protocol-category service (load + cache + admin CRUD).
 *
 * An admin defines protocol CATEGORIES (Sanitätsdienst / HvO / EGB …); each
 * carries its OWN protocol schema (a `DocSchema`, opaque JSON) and a permission
 * deciding who may create a deployment ("Veranstaltung"/"Einsatz") under it.
 *
 * Like `$lib/schemas/store`, categories are FIELD DEFINITIONS + org config (no
 * patient data), so they are cached in localStorage for instant/offline reads
 * and stored in clear server-side. Transport is self-contained (reuses the api
 * client's bearer token) so this module does not depend on api.ts.
 */
import { writable, get, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import {
  ROUTES,
  type CategoryCreatePermission,
  type CategoryListResponse,
  type ProtocolCategory,
  type Role,
  type UpsertCategoryRequest,
} from '@aidlog/contracts';
import { api } from '$lib/api';
import { getApiBase } from '$lib/config/serverUrl';
import type { DocSchema } from '$lib/schemas/types';
import { activeSchema } from '$lib/schemas/store';
import {
  categoriesForRole as pickForRole,
  categoryById as findById,
  schemaForCategory as resolveSchema,
  sortCategories,
} from './helpers';

const CACHE_KEY = 'aidlog-protocol-categories';

const store = writable<ProtocolCategory[]>([]);
/** Reactive list of all known categories (active + inactive), in display order. */
export const categories: Readable<ProtocolCategory[]> = store;

function isCategory(v: unknown): v is ProtocolCategory {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ProtocolCategory).id === 'string' &&
    typeof (v as ProtocolCategory).name === 'string'
  );
}

function apiBase(): string {
  return getApiBase();
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  const token = api.getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function commit(list: ProtocolCategory[]): void {
  const sorted = sortCategories(list);
  store.set(sorted);
  if (browser) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(sorted));
    } catch {
      /* quota / private mode — non-fatal, the store still holds the list */
    }
  }
}

/**
 * Load categories: localStorage cache first (instant, offline), then the server
 * (authoritative) if reachable. Safe to call repeatedly.
 */
export async function loadCategories(): Promise<ProtocolCategory[]> {
  if (browser) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as unknown;
        if (Array.isArray(cached)) store.set(sortCategories(cached.filter(isCategory)));
      }
    } catch {
      /* ignore malformed cache */
    }
  }
  try {
    const res = await fetch(apiBase() + ROUTES.orgCategories, { headers: authHeaders() });
    if (res.ok) {
      const body = (await res.json()) as CategoryListResponse | null;
      const list = body?.categories?.filter(isCategory) ?? [];
      commit(list);
      return list;
    }
  } catch {
    /* offline or not configured — keep cache */
  }
  return get(store);
}

/** Filter the current categories by the create permission a role satisfies. */
export function categoriesForRole(role: Role | null | undefined): ProtocolCategory[] {
  return pickForRole(get(store), role);
}

/** Look up a category by id from the current list. */
export function categoryById(id: string | null | undefined): ProtocolCategory | undefined {
  return findById(get(store), id);
}

/**
 * The `DocSchema` to use for a category, falling back to the org-active schema
 * then the ABCDE default when the category's schema is null/empty. Pass the
 * category itself (resolve it via {@link categoryById} first). `orgActive` may be
 * supplied (e.g. a reactive `$activeSchema` so a Svelte derived tracks it);
 * otherwise the current cached org-active schema is used.
 */
export function schemaForCategory(
  category: ProtocolCategory | null | undefined,
  orgActive?: DocSchema | null,
): DocSchema {
  return resolveSchema(category, orgActive ?? get(activeSchema));
}

/**
 * Admin: create (omit `id`) or update (set `id`) a category. Returns the saved
 * category and refreshes the cache. Used by the admin UI, including the
 * "Schema bearbeiten" action which calls `upsertCategory({ id, schema })`.
 */
export async function upsertCategory(req: UpsertCategoryRequest): Promise<ProtocolCategory> {
  const res = await fetch(apiBase() + ROUTES.orgCategories, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Kategorie speichern fehlgeschlagen (${res.status})`);
  const saved = (await res.json()) as ProtocolCategory;
  const next = get(store).filter((c) => c.id !== saved.id);
  commit([...next, saved]);
  return saved;
}

/** Admin: soft-delete / hard-delete a category by id (DELETE ?id=). */
export async function deleteCategory(id: string): Promise<void> {
  const url = `${apiBase()}${ROUTES.orgCategories}?id=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(`Kategorie löschen fehlgeschlagen (${res.status})`);
  commit(get(store).filter((c) => c.id !== id));
}

export type { CategoryCreatePermission, ProtocolCategory };
