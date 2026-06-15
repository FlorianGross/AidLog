/**
 * Active protocol schema service.
 *
 * The documentation editor renders from whatever `DocSchema` is active here. By
 * default that's the built-in ABCDE template; an admin can replace it via the
 * in-app schema editor, which persists it to the server (ROUTES.orgSchema). The
 * schema is FIELD DEFINITIONS only (no patient data), so it's cached in
 * localStorage and stored in clear server-side.
 *
 * Self-contained transport (reuses the api client's bearer token) so it does not
 * depend on api.ts gaining new methods — both the editor (read) and the schema
 * editor (write) go through here.
 */
import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { ROUTES, type OrgSchemaDocument, type SetOrgSchemaRequest } from '@aidlog/contracts';
import { api } from '$lib/api';
import { abcdeSchema } from './abcde';
import { handoverSchema } from './handover';
import type { DocSchema } from './types';

/**
 * Built-in protocol templates an admin can pick as the active schema (or use as
 * a starting point in the schema editor). The first entry is the default. New
 * vendor-neutral templates are registered here so they become selectable without
 * touching the load chain or the editor.
 */
export const builtinSchemas: readonly DocSchema[] = [abcdeSchema, handoverSchema];

const CACHE_KEY = 'aidlog-active-schema';

const store = writable<DocSchema>(abcdeSchema);
export const activeSchema: Readable<DocSchema> = store;

function isDocSchema(v: unknown): v is DocSchema {
  return (
    !!v &&
    typeof v === 'object' &&
    Array.isArray((v as DocSchema).sections) &&
    typeof (v as DocSchema).schemaId === 'string'
  );
}

function apiBase(): string {
  return (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? '';
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  const token = api.getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Load the active schema: localStorage cache first (instant, offline), then the
 * server (authoritative) if reachable. Falls back to the ABCDE default. Safe to
 * call repeatedly.
 */
export async function loadActiveSchema(): Promise<DocSchema> {
  if (browser) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as unknown;
        if (isDocSchema(cached)) store.set(cached);
      }
    } catch {
      /* ignore malformed cache */
    }
  }
  try {
    const res = await fetch(apiBase() + ROUTES.orgSchema, { headers: authHeaders() });
    if (res.ok) {
      const doc = (await res.json()) as OrgSchemaDocument | null;
      if (doc && isDocSchema(doc.schema)) {
        store.set(doc.schema);
        if (browser) localStorage.setItem(CACHE_KEY, JSON.stringify(doc.schema));
        return doc.schema;
      }
    }
  } catch {
    /* offline or not configured — keep cache/default */
  }
  return abcdeSchema;
}

/** Admin: persist a new active schema to the server and update the cache. */
export async function saveActiveSchema(schema: DocSchema): Promise<void> {
  const body: SetOrgSchemaRequest = { schema };
  const res = await fetch(apiBase() + ROUTES.orgSchema, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Schema speichern fehlgeschlagen (${res.status})`);
  store.set(schema);
  if (browser) localStorage.setItem(CACHE_KEY, JSON.stringify(schema));
}

/** The built-in default, for "reset to template" in the editor. */
export { abcdeSchema as defaultSchema };
