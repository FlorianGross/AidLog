/**
 * cosign/cosignApi.ts — minimal authenticated API for the co-signature flow.
 *
 * The shared `api` client (lib/api.ts) does not expose co-signature / user-list
 * routes and we must NOT edit it. We therefore implement a small authenticated
 * fetch HERE that reuses the shared client's in-memory bearer token (read-only,
 * via `api.getToken()`), so auth stays single-sourced.
 *
 * Everything sent is the typed contract from @aidlog/contracts. No secret key /
 * password / DEK is ever sent — only PUBLIC keys, sealed (ciphertext) DEKs and
 * signatures.
 *
 * Backend endpoints may not be deployed yet; callers should degrade gracefully
 * (catch and surface) — these functions compile against the typed contract.
 */
import {
  ROUTES,
  type CreateCosignatureRequest,
  type CosignatureRequest,
  type SubmitCosignatureRequest,
  type UserAccount,
  type UserListResponse,
} from '@aidlog/contracts';
import { api } from '$lib/api';

function baseUrl(): string {
  return (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? '';
}

async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = api.getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(baseUrl() + path, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? (body as { error: string }).error
        : res.statusText;
    throw new Error(`${path} → ${res.status}: ${msg}`);
  }
  return body as T;
}

/** GET the org user list (for choosing co-signers). */
export async function listUsers(): Promise<UserAccount[]> {
  const res = await authed<UserListResponse>(ROUTES.users, { method: 'GET' });
  return res.users ?? [];
}

/** POST a co-signature request (incl. the cosigner SealedKey[]). */
export function createCosignRequest(req: CreateCosignatureRequest): Promise<CosignatureRequest> {
  return authed<CosignatureRequest>(ROUTES.cosignRequests, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** GET co-signature requests awaiting MY signature. */
export async function listMyCosignRequests(): Promise<CosignatureRequest[]> {
  const res = await authed<{ requests: CosignatureRequest[] } | CosignatureRequest[]>(
    ROUTES.cosignRequests,
    { method: 'GET' },
  );
  return Array.isArray(res) ? res : (res.requests ?? []);
}

/** POST my signature (or rejection) for a request. */
export function submitCosign(req: SubmitCosignatureRequest): Promise<{ ok: boolean }> {
  return authed<{ ok: boolean }>(ROUTES.cosignSubmit, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}
