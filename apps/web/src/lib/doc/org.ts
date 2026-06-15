/**
 * doc/org.ts — obtain the ORG public identity so DEKs can be sealed to the org.
 *
 * The record builder ALWAYS seals the per-record DEK to the organisation's
 * X25519 box key. We must therefore know the org `PublicIdentity`.
 *
 * Resolution order:
 *   1. The session/store layer (owned by the core agent) MAY expose a cached
 *      org `PublicIdentity`. We probe for it without a hard dependency so we
 *      don't break if the shape differs (`getOrgPublicIdentity()` on the store
 *      module, or `orgPublicIdentity` on the unlocked session).
 *   2. Otherwise fetch it from `ROUTES.orgInfo` (GET, returns OrgPublicInfo)
 *      through an authenticated fetch that reuses the shared api client's bearer
 *      token (we do NOT edit api.ts; we only read its token).
 *
 * We do NOT seal to self as a placeholder. If the org identity cannot be
 * resolved, finalize fails loudly so we never produce a record only the author
 * can read.
 *
 * SECURITY: only PUBLIC key material is handled here. Nothing secret is fetched,
 * cached or persisted.
 */
import { ROUTES, type OrgPublicInfo, type PublicIdentity } from '@aidlog/contracts';
import { api } from '$lib/api';
import { getApiBase } from '$lib/config/serverUrl';
import * as store from '$lib/store';
import { getSession } from '$lib/crypto';

let cached: PublicIdentity | null = null;

/** Reset the in-memory cache (e.g. on lock/logout). */
export function clearOrgIdentityCache(): void {
  cached = null;
}

/**
 * Best-effort: read a cached org identity the core/store layer may expose.
 * Tolerant of several shapes so we integrate with whatever the core agent ships.
 */
function fromStoreOrSession(): PublicIdentity | null {
  const s = store as unknown as Record<string, unknown>;
  // The core agent exposes `getOrgIdentity()` (PublicIdentity) and
  // `getOrgInfo()` (OrgPublicInfo) from $lib/store. Probe those first, then a
  // few tolerant fallbacks so we stay resilient to naming.
  const getter =
    s['getOrgIdentity'] ?? s['getOrgPublicIdentity'] ?? s['orgPublicIdentity'] ?? s['orgIdentity'];
  if (typeof getter === 'function') {
    try {
      const v = (getter as () => unknown)();
      if (isPublicIdentity(v)) return v;
    } catch {
      /* ignore — fall through */
    }
  }
  if (isPublicIdentity(getter)) return getter;

  // `getOrgInfo()` -> { orgId, orgName, identity }
  const infoGetter = s['getOrgInfo'];
  if (typeof infoGetter === 'function') {
    try {
      const info = (infoGetter as () => unknown)() as { identity?: unknown } | null;
      if (info && isPublicIdentity(info.identity)) return info.identity;
    } catch {
      /* ignore — fall through to fetch */
    }
  }

  const sess = getSession() as unknown as Record<string, unknown> | null;
  const onSession = sess?.['orgPublicIdentity'] ?? sess?.['orgIdentity'];
  if (isPublicIdentity(onSession)) return onSession;
  return null;
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

/** Authenticated GET that reuses the shared api client's bearer token. */
async function authedGet<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = api.getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const base = getApiBase();
  const res = await fetch(base + path, { method: 'GET', headers });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Resolve the org `PublicIdentity`, sealing target for every record DEK.
 * Throws if it cannot be obtained (we must never silently seal to self).
 */
export async function getOrgPublicIdentity(): Promise<PublicIdentity> {
  if (cached) return cached;

  const local = fromStoreOrSession();
  if (local) {
    cached = local;
    return local;
  }

  const info = await authedGet<OrgPublicInfo>(ROUTES.orgInfo);
  if (!isPublicIdentity(info?.identity)) {
    throw new Error('Org public identity unavailable.');
  }
  cached = info.identity;
  return info.identity;
}
